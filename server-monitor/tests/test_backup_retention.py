import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
SOURCE = Path(__file__).resolve().parents[1] / 'backup.sh'

@unittest.skipUnless(shutil.which('flock'), 'Linux flock is required')
class Retention(unittest.TestCase):
    def run_backup(self, mode, failure=''):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);tools=root/'tools';tools.mkdir()
            restic=tools/'restic'
            restic.write_text('''#!/bin/sh
printf "%s\\n" "$*" >> "$MOCK_LOG"
printf "drive_trash=%s\\n" "${RCLONE_DRIVE_USE_TRASH:-unset}" >> "$MOCK_LOG"
if [ "$1" = forget ] && [ "$FAILURE" = cleanup ]; then echo cleanup-failed >&2; exit 7; fi
if [ "$1" = prune ] && [ "$FAILURE" = preclean ]; then echo preclean-failed >&2; exit 7; fi
if [ "$1" = backup ] && [ "$2" = --stdin ]; then
 cat > "$MOCK_STREAM"
 if [ "$FAILURE" = history-upload ]; then echo history-upload-failed >&2; exit 7; fi
fi
echo snapshot-saved
''')
            docker=tools/'docker'
            docker.write_text('''#!/bin/sh
if [ "$FAILURE" = docker ]; then echo docker-copy-failed >&2; exit 7; fi
echo mock-container-archive
''')
            rclone=tools/'rclone';rclone.write_text('#!/bin/sh\nexit 0\n')
            for p in (restic,docker,rclone):p.chmod(0o700)
            helper=root/'sqlite_history_backup.py'
            helper.write_text('''import os,sys,json,pathlib
root=pathlib.Path(os.environ['TAYUNET_MONITOR_DATA'])/'mock-snapshot'
with open(os.environ['MOCK_LOG'],'a') as log:log.write('history-helper-'+sys.argv[1]+'\\n')
if sys.argv[1]=='cleanup':
 if os.environ['FAILURE']=='temp-cleanup':sys.exit(7)
 (root/'history.sqlite3').unlink();root.rmdir();sys.exit(0)
if os.environ['FAILURE']=='history-copy':sys.exit(7)
root.mkdir(parents=True);(root/'history.sqlite3').write_bytes(b'verified-consistent-database')
if os.environ['FAILURE']=='history-proof':print('invalid-result');sys.exit(0)
print(json.dumps(dict(state='passed',quickCheck=[['ok']],directory=str(root),sourceReadOnly=True)))
''')
            key=root/'fake-password';key.write_text('test-only-not-a-real-key')
            script=root/'backup.sh';source=SOURCE.read_text()
            original='export PATH="/home/yoshi/.local/bin:/usr/local/bin:/usr/bin:/bin"'
            self.assertEqual(source.count(original),1)
            script.write_text(source.replace(original,'export PATH="$TEST_TOOLS:/usr/bin:/bin"'))
            env=dict(os.environ,TEST_TOOLS=str(tools),MOCK_LOG=str(root/'commands'),MOCK_STREAM=str(root/'stream'),
                     FAILURE=failure,RESTIC_PASSWORD_FILE=str(key),TAYUNET_MONITOR_DATA=str(root/'state'),
                     LOCAL_REPOSITORY=str(root/'local'),CLOUD_REPOSITORY=str(root/'cloud'))
            result=subprocess.run(['bash',str(script),mode],env=env,capture_output=True,text=True)
            state=json.loads((root/'state/backup-status.json').read_text())
            commands=(root/'commands').read_text()
            streamed=(root/'stream').read_bytes() if (root/'stream').exists() else None
            temporary_exists=(root/'state/mock-snapshot').exists()
            return result.returncode,state,commands,streamed,temporary_exists

    def test_cloud_keeps_two_and_streams_verified_standalone_database(self):
        code,state,commands,data,temporary=self.run_backup('cloud')
        self.assertEqual(code,0);self.assertTrue(state['runs']['cloud']['ok'])
        self.assertIn('forget --tag cloud --group-by host,paths --keep-last 2 --prune',commands)
        self.assertNotIn('--keep-monthly',commands);self.assertIn('drive_trash=false',commands)
        self.assertLess(commands.index('prune --max-repack-size 0'),commands.index('history-helper-create'))
        self.assertIn('--exclude /mnt/hdd/atos-delay-history/history.sqlite3 ',commands)
        self.assertIn('--exclude /mnt/hdd/atos-delay-history/history.sqlite3-wal ',commands)
        self.assertIn('--exclude /mnt/hdd/atos-delay-history/history.sqlite3-shm',commands)
        self.assertIn('backup --stdin --stdin-filename /tayunet-history/history.sqlite3 --tag cloud',commands)
        self.assertEqual(data,b'verified-consistent-database');self.assertFalse(temporary)
        self.assertEqual(state['runs']['cloud']['historySnapshot']['quickCheck'],[['ok']])

    def test_local_preserves_long_retention(self):
        code,state,commands,_,temporary=self.run_backup('local')
        self.assertEqual(code,0);self.assertIn('--keep-daily 7 --keep-weekly 4 --keep-monthly 6',commands)
        self.assertFalse(temporary)

    def test_preclean_failure_prevents_copy_and_upload(self):
        code,state,commands,_,_=self.run_backup('cloud','preclean')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('preclean-failed',state['detail'])
        self.assertNotIn('history-helper-create',commands);self.assertNotIn('backup --one-file-system',commands)

    def test_cleanup_failure_is_recorded(self):
        code,state,commands,_,temporary=self.run_backup('cloud','cleanup')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('cleanup-failed',state['detail'])
        self.assertIn('保存後',state['detail']);self.assertFalse(temporary)

    def test_copy_failure_prevents_upload(self):
        code,state,commands,_,_=self.run_backup('cloud','history-copy')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('履歴DB',state['detail'])
        self.assertNotIn('backup --one-file-system',commands)

    def test_invalid_proof_is_a_recorded_failure(self):
        code,state,commands,_,_=self.run_backup('cloud','history-proof')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('検査結果を読み取れません',state['detail'])
        self.assertNotIn('backup --one-file-system',commands)

    def test_history_upload_failure_keeps_old_generations(self):
        code,state,commands,_,temporary=self.run_backup('cloud','history-upload')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('history-upload-failed',state['detail'])
        self.assertNotIn('forget --tag',commands);self.assertFalse(temporary)

    def test_docker_failure_keeps_cause_and_cleans_temporary_copy(self):
        code,state,commands,_,temporary=self.run_backup('local','docker')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('docker-copy-failed',state['detail'])
        self.assertNotIn('forget --tag',commands);self.assertFalse(temporary)

    def test_temporary_cleanup_failure_is_not_success(self):
        code,state,commands,_,temporary=self.run_backup('local','temp-cleanup')
        self.assertNotEqual(code,0);self.assertFalse(state['ok']);self.assertIn('一時コピーを整理できません',state['detail'])
        self.assertTrue(temporary)

if __name__=='__main__':unittest.main()
