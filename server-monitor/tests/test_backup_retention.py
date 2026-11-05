import json, os, shutil, subprocess, tempfile, unittest
from pathlib import Path
SOURCE = Path(__file__).resolve().parents[1] / 'backup.sh'

@unittest.skipUnless(shutil.which('flock'), 'Linux flock is required')
class Retention(unittest.TestCase):
    def run_backup(self, mode, fail_cleanup=False, fail_preclean=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / 'tools'
            tools.mkdir()
            restic = tools / 'restic'
            restic.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_LOG"\nif [ "$1" = forget ] && [ "$FAIL_CLEANUP" = 1 ]; then echo cleanup-failed >&2; exit 7; fi\nprintf "drive_trash=%s\\n" "${RCLONE_DRIVE_USE_TRASH:-unset}" >> "$MOCK_LOG"; if [ "$1" = prune ] && [ "$FAIL_PRECLEAN" = 1 ]; then echo preclean-failed >&2; exit 7; fi; echo snapshot-saved\n')
            docker = tools / 'docker'
            docker.write_text('#!/bin/sh\necho mock-container-archive\n')
            for executable in (restic, docker): executable.chmod(0o700)
            key = root / 'fake-password'
            key.write_text('test-only-not-a-real-key')
            script = root / 'backup.sh'
            source = SOURCE.read_text()
            original = 'export PATH="/home/yoshi/.local/bin:/usr/local/bin:/usr/bin:/bin"'
            self.assertEqual(source.count(original), 1)
            script.write_text(source.replace(original, 'export PATH="$TEST_TOOLS:/usr/bin:/bin"'))
            env = dict(os.environ, TEST_TOOLS=str(tools), MOCK_LOG=str(root / 'commands'),
                       FAIL_CLEANUP='1' if fail_cleanup else '0', FAIL_PRECLEAN='1' if fail_preclean else '0', RESTIC_PASSWORD_FILE=str(key),
                       TAYUNET_MONITOR_DATA=str(root / 'state'), LOCAL_REPOSITORY=str(root / 'local'),
                       CLOUD_REPOSITORY=str(root / 'cloud'))
            # Presence check only: no real remote/storage commands are invoked.
            rclone = tools / 'rclone'; rclone.write_text('#!/bin/sh\nexit 0\n'); rclone.chmod(0o700)
            result = subprocess.run(['bash', str(script), mode], env=env, capture_output=True, text=True)
            state = json.loads((root / 'state/backup-status.json').read_text())
            commands = (root / 'commands').read_text()
            return result.returncode, state, commands

    def test_cloud_keeps_two_per_source(self):
        code, state, commands = self.run_backup('cloud')
        self.assertEqual(code, 0)
        self.assertTrue(state['runs']['cloud']['ok'])
        self.assertIn('forget --tag cloud --group-by host,paths --keep-last 2 --prune', commands)
        self.assertNotIn('--keep-monthly', commands)
        self.assertIn('drive_trash=false', commands)
        self.assertLess(commands.index('prune --max-repack-size 0'), commands.index('backup --one-file-system'))

    def test_local_preserves_long_retention(self):
        code, state, commands = self.run_backup('local')
        self.assertEqual(code, 0)
        self.assertIn('--keep-daily 7 --keep-weekly 4 --keep-monthly 6', commands)

    def test_preclean_failure_prevents_new_upload(self):
        code, state, commands = self.run_backup('cloud', fail_preclean=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(state['ok'])
        self.assertIn('preclean-failed', state['detail'])
        self.assertNotIn('backup --one-file-system', commands)

    def test_cleanup_failure_is_recorded(self):
        code, state, commands = self.run_backup('cloud', fail_cleanup=True)
        self.assertNotEqual(code, 0)
        self.assertFalse(state['runs']['cloud']['ok'])
        self.assertIn('cleanup-failed', state['detail'])
        self.assertIn('保存後', state['detail'])

if __name__ == '__main__': unittest.main()
