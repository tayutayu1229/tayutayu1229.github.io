#!/usr/bin/env python3
"""Create a verified, standalone history snapshot using a read-only source."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone

CONTAINER_SCRIPT = r'''
import pathlib, sqlite3, json, shutil, time, os, sys, hashlib
from datetime import datetime,timezone
from contextlib import closing
try:
 os.nice(10)
except OSError:
 pass
source=pathlib.Path(sys.argv[1])
target=pathlib.Path(sys.argv[2])
progress_file=target.parent/'progress.json'
started=time.monotonic();last_save=0
reserve=int(sys.argv[3])

def progress(state,remaining,total):
 global last_save
 if shutil.disk_usage(target.parent).free<reserve:
  raise RuntimeError('Reserved SSD free space would be exceeded')
 if time.monotonic()-last_save>10:
  progress_file.write_text(json.dumps({'remainingPages':remaining,'totalPages':total,'elapsedSeconds':int(time.monotonic()-started)}))
  last_save=time.monotonic()

with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=30)) as reader:
 reader.execute('PRAGMA query_only=ON')
 reader.execute('PRAGMA cache_size=-65536')
 reader.execute('BEGIN')
 reader.execute('SELECT count(*) FROM sqlite_schema').fetchone()
 page_size=reader.execute('PRAGMA page_size').fetchone()[0]
 pages=reader.execute('PRAGMA page_count').fetchone()[0]
 assert shutil.disk_usage(target.parent).free-pages*page_size>reserve
 snapshot_at=datetime.now(timezone.utc).isoformat()
 with closing(sqlite3.connect(target)) as writer:
  target.chmod(0o600)
  writer.execute('PRAGMA cache_size=-131072')
  writer.execute('PRAGMA journal_mode=DELETE')
  reader.backup(writer,pages=1024,progress=progress,sleep=0.05)
  writer.execute('PRAGMA journal_mode=DELETE')
 reader.rollback()
progress_file.write_text(json.dumps({'stage':'checking','elapsedSeconds':int(time.monotonic()-started)}))
with closing(sqlite3.connect(target.as_uri()+'?mode=ro',uri=True)) as verify:
 verify.execute('PRAGMA cache_size=-131072')
 result=verify.execute('PRAGMA quick_check').fetchall()
 tables=verify.execute("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").fetchall()
progress_file.write_text(json.dumps({'stage':'hashing','elapsedSeconds':int(time.monotonic()-started)}))
digest=hashlib.sha256()
with target.open('rb') as stream:
 while True:
  block=stream.read(8*1024**2)
  if not block:break
  digest.update(block)
out={'state':'passed' if result==[('ok',)] else 'failed','quickCheck':result,'bytes':target.stat().st_size,
     'snapshotAt':snapshot_at,'sqliteVersion':sqlite3.sqlite_version,'tables':[x[0] for x in tables],
     'elapsedSeconds':int(time.monotonic()-started),'sha256':digest.hexdigest()}
(target.parent/'result.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'state':out['state'],'bytes':out['bytes'],'elapsedSeconds':out['elapsedSeconds']}))
assert out['state']=='passed'
'''

SOURCE = Path('/mnt/hdd/atos-delay-history')
DEFAULT_ROOT = Path('/home/yoshi/.cache')
MINIMUM_FREE = 12 * 1024**3


def remove_snapshot(directory):
    root = Path(os.environ.get('TAYUNET_HISTORY_SNAPSHOT_ROOT', str(DEFAULT_ROOT))).resolve()
    path = Path(directory)
    if path.is_symlink() or path.resolve().parent != root or not path.name.startswith('tayunet-history-snapshot-'):
        raise ValueError('一時コピーの削除対象を確認できません')
    if path.exists():
        if path.stat().st_uid != os.getuid():
            raise ValueError('一時コピーの所有者を確認できません')
        shutil.rmtree(path)


def create_snapshot():
    root = Path(os.environ.get('TAYUNET_HISTORY_SNAPSHOT_ROOT', str(DEFAULT_ROOT)))
    root.mkdir(parents=True, exist_ok=True)
    if SOURCE.stat().st_uid != os.getuid():
        raise RuntimeError('履歴DBの保存先・所有者を確認してください')
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    available = int(memory['MemAvailable'].strip().split()[0]) * 1024
    if available < 3 * 1024**3:
        raise RuntimeError('利用可能メモリが少ないため履歴DBの整合コピーを開始できません。ほかの処理が落ち着いてから再実行してください')
    database = SOURCE / 'history.sqlite3'
    if shutil.disk_usage(root).free - database.stat().st_size < MINIMUM_FREE:
        raise RuntimeError('履歴DBの整合コピー用の空き容量が足りません。作業後も12GiB以上の空きを残せる保存先を指定してください')
    image = subprocess.check_output(['docker', 'inspect', 'atos-delay-history', '--format', '{{.Image}}'], text=True).strip()
    if not image.startswith('sha256:'):
        raise RuntimeError('履歴DBのSQLite実行環境を確認できません')
    directory = Path(tempfile.mkdtemp(prefix='tayunet-history-snapshot-', dir=root))
    name = 'tayunet-history-snapshot-' + uuid.uuid4().hex[:12]
    command = ['docker', 'run', '--rm', '--pull', 'never', '-i', '--name', name,
               '--label', 'tayunet.task=history-consistent-backup', '--network', 'none', '--read-only',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '--user', f'{os.getuid()}:{os.getgid()}', '--pids-limit', '64', '--memory', '2g', '--memory-swap', '2g', '--cpus', '1.0',
               '--mount', f'type=bind,source={SOURCE},target=/source,readonly',
               '--mount', f'type=bind,source={directory.resolve()},target=/snapshot',
               '--entrypoint', 'python3', image, '-', '/source/history.sqlite3', '/snapshot/history.sqlite3', str(MINIMUM_FREE)]
    try:
        try:
            completed = subprocess.run(command, input=CONTAINER_SCRIPT, text=True, capture_output=True, timeout=1800)
        except subprocess.TimeoutExpired as error:
            subprocess.run(['docker', 'stop', '--time', '5', name], capture_output=True, timeout=15)
            raise RuntimeError('履歴DBの整合コピーが30分以内に完了しませんでした') from error
        if completed.returncode:
            raise RuntimeError('履歴DBの整合コピー・内部検査に失敗しました: ' + completed.stderr[-1200:])
        result = json.loads((directory / 'result.json').read_text())
        if result.get('state') != 'passed' or result.get('quickCheck') != [['ok']]:
            raise RuntimeError('履歴DBのコピーの整合性を確認できません')
        result.update(directory=str(directory), path=str(directory / 'history.sqlite3'),
                      checkedAt=datetime.now(timezone.utc).isoformat(), sourceReadOnly=True)
        print(json.dumps(result, ensure_ascii=False))
    except BaseException:
        remove_snapshot(directory)
        raise


def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'cleanup':
        remove_snapshot(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == 'create':
        create_snapshot()
    else:
        raise ValueError('create または cleanup を指定してください')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
