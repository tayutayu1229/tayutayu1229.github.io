"""Validated, non-secret control settings and audit history for Discord operations."""
import copy
from contextlib import contextmanager
import json
import os
import re
import sqlite3
import tempfile
from datetime import datetime, timezone

COMMANDS = ('status', 'services', 'report', 'logs', 'github', 'events', 'help')
NOTICES = ('ubuntu', 'github_actions', 'github_deploy', 'github_pr', 'github_issue')
DEFAULT = {
    'revision': 1, 'enabled': True, 'allowLogs': True,
    'allowedRoleIds': ['1489628881135730852', '1489628881135730851', '1489628881135730850'],
    'allowedUserIds': [], 'allowedChannelIds': ['1499762805065388274'], 'cooldownSeconds': 15,
    'commands': {key: {'enabled': True, 'roleIds': [], 'userIds': [], 'channelIds': [], 'cooldownSeconds': None} for key in COMMANDS},
    'repositories': [{'name': 'tayutayu1229/tayutayu1229.github.io', 'branch': 'main', 'enabled': True}],
    'notifications': {'paused': False, 'channelId': '1499762805065388274', 'failureRoleIds': ['1489628881135730852'],
                      'types': {key: {'enabled': key == 'ubuntu', 'channelId': '', 'mentionRoleIds': []} for key in NOTICES}}
}


def stamp():
    return datetime.now(timezone.utc).isoformat()


def ids(value, allow_empty=True):
    if not isinstance(value, list) or len(value) > 20 or (not value and not allow_empty) or any(not isinstance(x, str) or not re.fullmatch(r'[0-9]{17,20}', x) for x in value):
        raise ValueError('ロール・ユーザー・チャンネルIDは17〜20桁の数字で、最大20件まで指定してください。')
    return list(dict.fromkeys(value))


def boolean(value):
    if type(value) is not bool:
        raise ValueError('有効・無効の指定が正しくありません。')
    return value


def cooldown(value):
    if type(value) is not int or not 5 <= value <= 3600:
        raise ValueError('クールダウンは5〜3600秒で指定してください。')
    return value


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('設定の形式が正しくありません。')
    result = {key: boolean(data.get(key)) for key in ('enabled', 'allowLogs')}
    for key in ('allowedRoleIds', 'allowedUserIds', 'allowedChannelIds'):
        result[key] = ids(data.get(key), key != 'allowedChannelIds')
    if not result['allowedRoleIds'] and not result['allowedUserIds']:
        raise ValueError('利用できるロールかユーザーを指定してください。')
    if '1489628881106243664' in result['allowedRoleIds']:
        raise ValueError('@everyoneは利用ロールに指定できません。')
    result['cooldownSeconds'] = cooldown(data.get('cooldownSeconds'))
    source = data.get('commands')
    if not isinstance(source, dict) or set(source) != set(COMMANDS):
        raise ValueError('コマンド設定の項目が不足しています。')
    result['commands'] = {}
    for name in COMMANDS:
        item = source[name]
        if not isinstance(item, dict):
            raise ValueError('コマンド設定が正しくありません。')
        command = {'enabled': boolean(item.get('enabled'))}
        for key in ('roleIds', 'userIds', 'channelIds'):
            command[key] = ids(item.get(key))
        if '1489628881106243664' in command['roleIds']:
            raise ValueError('@everyoneは利用ロールに指定できません。')
        command['cooldownSeconds'] = None if item.get('cooldownSeconds') is None else cooldown(item['cooldownSeconds'])
        result['commands'][name] = command
    repos = data.get('repositories')
    if not isinstance(repos, list) or not 1 <= len(repos) <= 10:
        raise ValueError('リポジトリを1〜10件登録してください。')
    result['repositories'] = []
    for repo in repos:
        if not isinstance(repo, dict) or not isinstance(repo.get('name'), str) or not isinstance(repo.get('branch'), str) or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo.get('name', '')) or not re.fullmatch(r'[A-Za-z0-9_./-]{1,128}', repo.get('branch', '')):
            raise ValueError('リポジトリはowner/name、ブランチは有効な名前で指定してください。')
        if any(x['name'].lower() == repo['name'].lower() for x in result['repositories']):
            raise ValueError('同じリポジトリが重複しています。')
        result['repositories'].append({'name': repo['name'], 'branch': repo['branch'], 'enabled': boolean(repo.get('enabled'))})
    notices = data.get('notifications')
    if not isinstance(notices, dict) or not isinstance(notices.get('types'), dict) or set(notices['types']) != set(NOTICES):
        raise ValueError('通知設定が不足しています。')
    ids([notices.get('channelId')], False)
    result['notifications'] = {'paused': boolean(notices.get('paused')), 'channelId': notices['channelId'], 'failureRoleIds': ids(notices.get('failureRoleIds')), 'types': {}}
    for key in NOTICES:
        item = notices['types'][key]
        if not isinstance(item, dict) or not isinstance(item.get('channelId', ''), str):
            raise ValueError('通知先の形式が正しくありません。')
        if item.get('channelId'):
            ids([item['channelId']], False)
        result['notifications']['types'][key] = {'enabled': boolean(item.get('enabled')), 'channelId': item.get('channelId', ''), 'mentionRoleIds': ids(item.get('mentionRoleIds'))}
    return result


def load(directory):
    path = directory / 'discord-command-config.json'
    if not path.exists():
        return copy.deepcopy(DEFAULT)
    raw = json.loads(path.read_text())
    result = validate(raw)
    result['revision'] = int(raw.get('revision', 1))
    result['updatedAt'] = raw.get('updatedAt')
    return result


def save(directory, data):
    result = validate(data)
    current = load(directory)
    if type(data.get('revision')) is not int or data.get('revision') != current['revision']:
        raise ValueError('他の管理者が設定を更新しました。再読込してから保存してください。')
    result.update(revision=current['revision'] + 1, updatedAt=stamp())
    directory.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='discord-config-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        os.replace(temporary, directory / 'discord-command-config.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return result


@contextmanager
def connect(db_path):
    db = sqlite3.connect(db_path, timeout=15)
    try:
        db.row_factory = sqlite3.Row
        db.executescript("""CREATE TABLE IF NOT EXISTS bot_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,command TEXT NOT NULL,ok INTEGER NOT NULL,detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_cache(key TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched_at TEXT,last_attempt TEXT,error TEXT,metadata TEXT NOT NULL DEFAULT '{}');""")
        with db:
            yield db
    finally:
        db.close()


def audit(db_path, kind, actor, command, ok, detail):
    with connect(db_path) as db:
        db.execute('INSERT INTO bot_audit(created_at,kind,actor,command,ok,detail) VALUES(?,?,?,?,?,?)', (stamp(), kind, str(actor)[:100], str(command)[:100], int(bool(ok)), str(detail)[:3000]))
        db.execute('DELETE FROM bot_audit WHERE id < (SELECT COALESCE(MAX(id),0)-3000 FROM bot_audit)')


def history(db_path):
    with connect(db_path) as db:
        return [dict(x) for x in db.execute('SELECT * FROM bot_audit ORDER BY id DESC LIMIT 150')]


def notice_policy(directory, category='ubuntu'):
    config = load(directory)
    root = config['notifications']
    kind = root['types'].get(category, root['types']['ubuntu'])
    return {'paused': root['paused'], 'enabled': kind['enabled'], 'channelId': kind['channelId'] or root['channelId'],
            'roleIds': kind['mentionRoleIds'] or root['failureRoleIds']}
