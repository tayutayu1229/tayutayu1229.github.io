import ast,json,tempfile,time,unittest
from pathlib import Path
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
SOURCE=Path(__file__).resolve().parents[1]/'monitor_service.py'
class Changes(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
  tree=ast.parse(SOURCE.read_text()); names={'backup_status','scheduled_report','send_discord','monitor_health'}
  self.ns=dict(DATA_DIR=Path(self.tmp.name),json=json,time=time,datetime=datetime,ZoneInfo=ZoneInfo)
  exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'monitor','exec'),self.ns)
 def test_backup(self):
  now=datetime.now(timezone.utc).isoformat()
  for cloud,want in [({'ok':True,'finishedAt':now},True),({'ok':False,'finishedAt':now},False),({'ok':True,'finishedAt':'2026-01-01T00:00:00+00:00'},False),({},False)]:
   (self.ns['DATA_DIR']/'backup-status.json').write_text(json.dumps({'ok':True,'runs':{'local':{'ok':True,'finishedAt':now},'cloud':cloud}}))
   self.assertEqual(self.ns['backup_status']()['ok'],want)
 def test_health(self):
  now=datetime.now(timezone.utc).isoformat()
  for status,stamp,want in [('warning',now,True),('error',now,False),('starting',None,False),('ok','2026-01-01T00:00:00+00:00',False)]:
   self.assertEqual(self.ns['monitor_health']({'status':status,'collectedAt':stamp})['ok'],want)
 def test_schedule(self):
  class Clock:
   @classmethod
   def now(cls,tz): return datetime(2026,11,5,9,0,tzinfo=tz)
  self.ns['datetime']=Clock; self.ns['recent_resource_summary']=lambda:{'samples':1}; calls=[]
  self.ns['send_discord']=lambda *a,**kw: calls.append((a,kw)) or True
  snapshot={'status':'ok','uptimeSeconds':3600,'cpu':{'usedPercent':2},'memory':{'usedPercent':30,'totalBytes':100,'usedBytes':30},'disks':[],'docker':[{'state':'running'}],'pm2':[],'backup':{'ok':True},'alerts':[]}
  self.ns['scheduled_report'](snapshot);self.ns['scheduled_report'](snapshot)
  self.assertEqual(len(calls),1);self.assertFalse(calls[0][1]['mention'])
  (self.ns['DATA_DIR']/'last-report-slot').unlink()
  self.ns['send_discord']=lambda *a,**kw:False; self.ns['record_event']=lambda *a,**kw:None
  self.ns['scheduled_report'](snapshot)
  self.assertFalse((self.ns['DATA_DIR']/'last-report-slot').exists())
if __name__=='__main__':unittest.main()
