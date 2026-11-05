import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

source = Path(__file__).resolve().parents[1] / 'external_status.py'
spec = importlib.util.spec_from_file_location('external_partial', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class PartialIncident(unittest.TestCase):
    def test_active_incident_overrides_overall_normal(self):
        data = {'status': {'indicator': 'none', 'description': 'All Systems Operational'},
                'incidents': [{'id': 'active', 'name': 'Storage issue', 'status': 'monitoring'},
                              {'id': 'closed', 'name': 'Old issue', 'status': 'resolved'}]}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(data).encode()
        with patch.object(m, 'urlopen', return_value=response), patch.object(m, 'google_status', return_value=[]):
            rows = m.provider_status()
        for row in rows:
            self.assertEqual(row['reportedIndicator'], 'none')
            self.assertEqual(row['indicator'], 'minor')
            self.assertEqual([i['id'] for i in row['incidents']], ['active'])
            self.assertNotIn('通常稼働', row['description'])
        # A closed-only report is healthy again.
        m._cached = None
        data['incidents'] = [data['incidents'][1]]
        response.__enter__.return_value.read.return_value = json.dumps(data).encode()
        with patch.object(m, 'urlopen', return_value=response), patch.object(m, 'google_status', return_value=[]):
            rows = m.provider_status()
        self.assertTrue(all(row['indicator'] == 'none' and row['incidents'] == [] for row in rows))

if __name__ == '__main__':
    unittest.main()
