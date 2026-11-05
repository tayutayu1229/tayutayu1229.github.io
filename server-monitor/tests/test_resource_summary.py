import ast
import json
import math
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / 'monitor_service.py'

class ResourceSummary(unittest.TestCase):
    def test_measured_range_and_missing_values(self):
        rows = [
            {'collected_at': '2026-11-05T00:00:00+00:00', 'payload': json.dumps({'cpu': {'usedPercent': 10, 'iowaitPercent': 2}, 'memory': {'usedPercent': 40}})},
            {'collected_at': '2026-11-05T00:02:00+00:00', 'payload': json.dumps({'cpu': {'usedPercent': 30, 'iowaitPercent': 6}, 'memory': None})},
            {'collected_at': '2026-11-05T00:03:00+00:00', 'payload': 'broken'},
            {'collected_at': '2026-11-05T00:04:00+00:00', 'payload': json.dumps({'cpu': {'usedPercent': float('nan')}, 'memory': {'usedPercent': True}})},
        ]
        calls = []
        def query(sql, args):
            calls.append((sql, args))
            return rows
        ns = dict(datetime=datetime, timezone=timezone, time=time, json=json, math=math, db_rows=query)
        fn = next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'recent_resource_summary')
        exec(compile(ast.Module(body=[fn], type_ignores=[]), 'summary', 'exec'), ns)
        result = ns['recent_resource_summary']()
        self.assertEqual(result['cpu'], {'average': 20, 'maximum': 30})
        self.assertEqual(result['memory'], {'average': 40, 'maximum': 40})
        self.assertEqual(result['iowait'], {'average': 4, 'maximum': 6})
        self.assertEqual(result['invalidSamples'], 1)
        self.assertEqual(result['firstAt'], rows[0]['collected_at'])
        self.assertEqual(result['lastAt'], rows[-1]['collected_at'])
        self.assertAlmostEqual(datetime.fromisoformat(calls[0][1][0]).timestamp(), time.time() - 86400, delta=2)
        rows.clear()
        empty = ns['recent_resource_summary']()
        self.assertEqual(empty['samples'], 0)
        self.assertIsNone(empty['cpu'])
        self.assertIsNone(empty['firstAt'])

if __name__ == '__main__':
    unittest.main()
