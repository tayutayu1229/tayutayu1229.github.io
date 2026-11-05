import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dependency_security as m


class DependencyEvidence(unittest.TestCase):
    def setUp(self):
        m._cached = None
        self.run = {'id': 1, 'updated_at': '2026-11-05T00:00:00Z', 'conclusion': 'success'}
        self.now = 1793836800
        self.jobs = [{'name': name, 'steps': [{'name': step, 'conclusion': 'success'}]}
                     for name, step in m.AUDITS.items()]

    def test_success_requires_each_audit_step(self):
        self.assertEqual(m.evaluate(self.run, self.jobs, self.now)['state'], 'passed')
        self.assertEqual(m.evaluate(self.run, self.jobs[:1], self.now)['state'], 'unknown')

    def test_application_test_failure_is_not_claimed_as_vulnerability(self):
        self.run['conclusion'] = 'failure'
        self.assertEqual(m.evaluate(self.run, self.jobs, self.now)['state'], 'passed')

    def test_audit_failure_and_skipped_are_not_healthy(self):
        for conclusion, state in [('failure', 'failed'), ('skipped', 'unknown')]:
            self.jobs[0]['steps'][0]['conclusion'] = conclusion
            result = m.evaluate(self.run, self.jobs, self.now)
            self.assertEqual(result['state'], state)
            self.assertEqual(len(m.dependency_security_alerts(result)), 1)

    def test_old_result_is_not_current_success(self):
        self.assertEqual(m.evaluate(self.run, self.jobs, self.now + 9 * 86400)['state'], 'stale')

    def test_request_failure_is_unknown_and_cached_without_credentials(self):
        with patch.object(m, 'request_json', side_effect=OSError) as request:
            first = m.dependency_security_status()
            self.assertEqual(first['state'], 'unknown')
            self.assertFalse(first['available'])
            self.assertEqual(m.dependency_security_status(), first)
            self.assertEqual(request.call_count, 1)


if __name__ == '__main__':
    unittest.main()
