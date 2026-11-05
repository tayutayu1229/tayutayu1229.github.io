import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

SOURCE = Path(__file__).resolve().parents[2] / 'scripts/external_server_monitor.py'
spec = importlib.util.spec_from_file_location('external_probe', SOURCE)
probe_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe_module)


class ExternalHealthProbe(unittest.TestCase):
    def check(self, body, require_health=True, status=200):
        response = Mock(status=status)
        response.read.return_value = body
        with patch.object(probe_module, 'urlopen', return_value=response):
            return probe_module.probe('monitor', 'https://example.invalid/health', {status}, True, require_health)

    def test_stopped_collector_fails_even_with_http_200(self):
        for body in (b'{"ok":false}', b'{}', b'{"ok":"true"}', b'[]', b'not-json'):
            with self.subTest(body=body):
                self.assertFalse(self.check(body)['ok'])

    def test_live_collector_remains_healthy_with_resource_warning(self):
        self.assertTrue(self.check(b'{"ok":true,"status":"warning"}')['ok'])

    def test_existing_authenticated_api_contract_is_preserved(self):
        self.assertTrue(self.check(b'{"error":"unauthorized"}', False, 401)['ok'])

    def test_real_target_checks_monitor_health(self):
        matches = [target for target in probe_module.TARGETS if target[0] == 'Ubuntu監視']
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0][2:], ({200}, True, True))


if __name__ == '__main__':
    unittest.main()
