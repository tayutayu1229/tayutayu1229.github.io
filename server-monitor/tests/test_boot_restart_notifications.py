import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ast
import json
import re
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE = Path(__file__).resolve().parents[1] / 'monitor_service.py'
BOOT_A = '11111111-1111-4111-8111-111111111111'
BOOT_B = '22222222-2222-4222-8222-222222222222'


class LifecycleNotifications(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        names = {'init_db', 'db_rows', 'db_execute', 'iso_now', 'redact_sensitive',
                 'record_event', 'observe_host_boot', 'restart_target', 'flush_notifications'}
        self.ns = dict(DB_PATH=Path(tmp.name) / 'test.db', sqlite3=sqlite3, datetime=datetime,
                       timezone=timezone, ZoneInfo=ZoneInfo, Path=Path, json=json, re=re,
                       time=type('Clock', (), {'sleep': staticmethod(lambda _: None), 'time': staticmethod(time.time)}),
                       db_lock=threading.Lock(), DOCKER_NAMES={'app'}, PM2_NAMES={'worker'}, PM2_BIN='pm2')
        tree = ast.parse(SOURCE.read_text())
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names],
                                type_ignores=[]), 'monitor', 'exec'), self.ns)
        self.ns['init_db']()
        self.snapshot = {'collectedAt': '2026-11-05T10:00:00+00:00', 'uptimeSeconds': 120, 'status': 'warning'}
        self.commands = []
        self.ns['run'] = lambda command, **kw: self.commands.append(command) or (0, 'done')
        self.ns['service_logs'] = lambda *a: 'service log'

    def rows(self, table):
        return self.ns['db_rows']('select * from ' + table)

    def deliver(self):
        result = []
        self.ns['send_discord'] = lambda *a, **kw: result.append((a[1], kw['mention'])) or True
        self.ns['db_execute']('update notification_outbox set next_attempt=0')
        self.ns['flush_notifications']()
        return result

    def test_first_install_and_monitor_restart_do_not_claim_os_reboot(self):
        self.ns['observe_host_boot'](self.snapshot, BOOT_A)
        self.ns['init_db']()
        self.ns['observe_host_boot'](self.snapshot, BOOT_A)
        self.assertEqual(self.rows('notification_outbox'), [])
        self.assertEqual(len(self.rows('host_boot_state')), 1)

    def test_new_boot_notifies_once_after_collection_and_survives_delivery_failure(self):
        self.ns['observe_host_boot'](self.snapshot, BOOT_A)
        self.ns['observe_host_boot'](self.snapshot, BOOT_B)
        self.ns['send_discord'] = lambda *a, **kw: False
        self.ns['flush_notifications']()
        self.ns['init_db']()
        self.ns['observe_host_boot'](self.snapshot, BOOT_B)
        self.assertEqual(len(self.rows('notification_outbox')), 1)
        result = self.deliver()
        self.assertFalse(result[0][1])
        self.assertIn('Ubuntu起動後の監視を再開', result[0][0])
        self.assertIn('2026/11/05 18:58:00 JST', result[0][0])
        self.assertEqual(self.rows('notification_outbox'), [])

    def test_boot_marker_and_notification_commit_together(self):
        self.ns['observe_host_boot'](self.snapshot, BOOT_A)
        with sqlite3.connect(self.ns['DB_PATH']) as db:
            db.execute("CREATE TRIGGER reject_outbox BEFORE INSERT ON notification_outbox BEGIN SELECT RAISE(ABORT,'test'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.ns['observe_host_boot'](self.snapshot, BOOT_B)
        self.assertEqual(self.rows('host_boot_state')[0]['boot_id'], BOOT_A)
        self.assertEqual(self.rows('events'), [])

    def test_manual_success_and_automatic_failure_are_persisted_and_mentioned_correctly(self):
        self.ns['restart_target']('docker', 'app', 'admin')
        self.ns['run'] = lambda *a, **kw: (124, 'timeout password=do-not-share')
        result = self.ns['restart_target']('pm2', 'worker', 'system:auto-recovery')
        self.assertFalse(result['ok'])
        self.assertNotIn('do-not-share', json.dumps(result))
        self.ns['send_discord'] = lambda *a, **kw: False
        self.ns['flush_notifications']()
        self.ns['init_db']()
        self.assertEqual([x['success'] for x in self.rows('actions')], [1, 0])
        self.assertNotIn('do-not-share', json.dumps(self.rows('actions')))
        delivered = self.deliver()
        self.assertEqual([x[1] for x in delivered], [False, True])
        self.assertIn('手動再起動 成功', delivered[0][0])
        self.assertIn('自動再起動 失敗', delivered[1][0])
        self.assertNotIn('do-not-share', str(delivered))

    def test_log_failure_does_not_lose_restart_result(self):
        def fail(*a):
            raise OSError('log unavailable')
        self.ns['service_logs'] = fail
        self.assertTrue(self.ns['restart_target']('docker', 'app', 'admin')['ok'])
        self.assertEqual(len(self.rows('notification_outbox')), 1)

    def test_unknown_target_is_never_restarted(self):
        with self.assertRaises(ValueError):
            self.ns['restart_target']('docker', 'unknown', 'admin')
        self.assertEqual(self.commands, [])


if __name__ == '__main__':
    unittest.main()
