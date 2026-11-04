import importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch,MagicMock
p=Path(__file__).resolve().parents[1]/'external_status.py'
spec=importlib.util.spec_from_file_location('external',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Google(unittest.TestCase):
 def test_filters(self):
  rows=[dict(id='drive-active',service_name='Google Drive',begin='2026-01-01T00:00:00Z',end=None),dict(id='firestore-active',service_name='Cloud Firestore',begin='2026-01-01T00:00:00Z',end=None),dict(id='ended',service_name='Google Drive',end='2026-01-01T00:00:00Z'),dict(id='unrelated',service_name='Gmail',end=None)]
  response=MagicMock();response.__enter__.return_value.read.return_value=json.dumps(rows).encode()
  with patch.object(m,'urlopen',return_value=response): result=m.google_status()
  self.assertEqual([i['id'] for i in result[0]['incidents']],['drive-active'])
  self.assertEqual([i['id'] for i in result[1]['incidents']],['firestore-active'])
  with patch.object(m,'urlopen',side_effect=OSError()): self.assertTrue(all(not x['available'] for x in m.google_status()))
if __name__=='__main__':unittest.main()
