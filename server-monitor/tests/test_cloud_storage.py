import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch, Mock

p = Path(__file__).resolve().parents[1] / 'cloud_storage.py'
spec = importlib.util.spec_from_file_location('cloud_storage_test', p)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class DriveQuota(unittest.TestCase):
    def setUp(self):
        m._cached = None

    def test_cache_and_query_is_read_only(self):
        data = {'total': 15 * 1024**3, 'used': 9 * 1024**3, 'free': 6 * 1024**3}
        with patch.object(m.subprocess, 'run', return_value=Mock(stdout=json.dumps(data))) as run:
            first = m.cloud_storage_status(); second = m.cloud_storage_status()
        self.assertEqual(first, second); self.assertEqual(run.call_count, 1)
        self.assertTrue(first['available']); self.assertEqual(first['freeBytes'], data['free'])
        command = run.call_args.args[0]
        self.assertEqual(command[-3:], ['about', 'tayunet-drive:', '--json'])
        self.assertEqual(m.cloud_storage_alerts(first), [])

    def test_unavailable_and_malformed_are_not_healthy(self):
        for output in ('null', '[]', '{"total":0,"used":0,"free":0}', '{"total":true,"used":0,"free":0}'):
            m._cached = None
            with patch.object(m.subprocess, 'run', return_value=Mock(stdout=output)):
                data = m.cloud_storage_status()
            self.assertFalse(data['available']); self.assertEqual(m.cloud_storage_alerts(data)[0]['code'], 'cloud-quota-check')
        m._cached = None
        with patch.object(m.subprocess, 'run', side_effect=subprocess.TimeoutExpired('rclone', 15)):
            self.assertFalse(m.cloud_storage_status()['available'])

    def test_warning_critical_and_recovered_capacity(self):
        def alerts(total, free):
            return m.cloud_storage_alerts(dict(configured=True, available=True, totalBytes=total, freeBytes=free))
        self.assertEqual(alerts(15 * 1024**3, 3 * 1024**3)[0]['severity'], 'warning')
        self.assertEqual(alerts(15 * 1024**3, 700 * 1024**2)[0]['severity'], 'critical')
        self.assertEqual(alerts(15 * 1024**3, -20_000_000)[0]['severity'], 'critical')
        self.assertEqual(alerts(1000 * 1024**3, 150 * 1024**3)[0]['severity'], 'warning')
        self.assertEqual(alerts(15 * 1024**3, 6 * 1024**3), [])
        self.assertEqual(m.cloud_storage_alerts({}), [])

if __name__ == '__main__': unittest.main()
