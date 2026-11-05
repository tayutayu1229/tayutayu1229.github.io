import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ast
import importlib.util
import json
import re
import sqlite3
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('providers_for_delivery_test', ROOT / 'external_status.py')
providers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(providers)


class ExternalOutbox(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.directory = Path(tmp.name)
        self.ns = dict(DATA_DIR=self.directory, DB_PATH=self.directory / 'test.sqlite3',
                       sqlite3=sqlite3, json=json, re=re, threading=threading,
                       db_lock=threading.Lock(), datetime=datetime, timezone=timezone, time=time)
        names = {'init_db', 'db_rows', 'db_execute', 'iso_now', 'redact_sensitive',
                 'record_event', 'queue_external_notification', 'flush_notifications'}
        tree = ast.parse((ROOT / 'monitor_service.py').read_text())
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names],
                                type_ignores=[]), 'monitor', 'exec'), self.ns)
        self.ns['init_db']()
        self.item = dict(id='discord', name='Discord', available=True, indicator='none', incidents=[],
                         description='通常稼働', impact='本システムへの影響は別途確認', source='https://discordstatus.com')

    def observe(self):
        providers.notify_changes([self.item], self.directory, self.ns['queue_external_notification'])

    def test_incident_and_recovery_survive_discord_outage_and_restart(self):
        self.observe()
        self.assertEqual(self.ns['db_rows']('select * from notification_outbox'), [])
        self.item.update(indicator='major', incidents=[dict(id='one', name='API障害', status='investigating')])
        self.observe()
        self.ns['send_discord'] = lambda *a, **kw: False
        self.ns['flush_notifications']()
        self.item.update(indicator='none', incidents=[])
        self.observe()
        # Reopening the persistent store and observing the same recovered
        # state must retain both pending messages without adding a duplicate.
        self.ns['init_db']()
        self.observe()
        rows = self.ns['db_rows']('select * from notification_outbox order by id')
        self.assertEqual([r['severity'] for r in rows], ['warning', 'ok'])
        self.assertIn('Discord', rows[0]['body'])
        delivered = []
        self.ns['send_discord'] = lambda *a, **kw: delivered.append((a[1], kw['mention'])) or True
        self.ns['db_execute']('update notification_outbox set next_attempt=0')
        self.ns['flush_notifications']()
        self.assertEqual([x[1] for x in delivered], [True, False])
        self.assertIn('障害', delivered[0][0])
        self.assertIn('復旧', delivered[1][0])
        self.assertTrue(all(body.startswith('記録: ') and ' JST\n' in body for body, _ in delivered))
        self.assertEqual(self.ns['db_rows']('select * from notification_outbox'), [])

    def test_storage_failure_does_not_advance_provider_marker(self):
        self.observe()
        marker = self.directory / 'external-notification-state.json'
        before = marker.read_bytes()
        self.item.update(indicator='major', incidents=[dict(id='one', name='API障害', status='investigating')])
        def fail(*a, **kw):
            raise sqlite3.OperationalError('test store unavailable')
        self.ns['record_event'] = fail
        with self.assertRaises(sqlite3.OperationalError):
            self.observe()
        self.assertEqual(marker.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
