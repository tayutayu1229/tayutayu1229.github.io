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
 def test_restore_failure_is_not_transfer_success(self):
  now=datetime.now(timezone.utc).isoformat()
  (self.ns['DATA_DIR']/'backup-status.json').write_text(json.dumps({'ok':True,'runs':{mode:{'ok':True,'finishedAt':now} for mode in ('local','cloud')}}))
  proof=self.ns['DATA_DIR']/'backup-restore-validation.json'
  proof.write_text(json.dumps({'state':'failed','snapshotId':'old-snapshot'}))
  result=self.ns['backup_status']();self.assertFalse(result['ok']);self.assertTrue(result['transferOk']);self.assertEqual(result['restoreValidation']['state'],'failed')
  proof.write_text(json.dumps({'state':'passed','snapshotId':'verified-snapshot'}))
  self.assertTrue(self.ns['backup_status']()['ok'])
  proof.write_text('[]');result=self.ns['backup_status']();self.assertFalse(result['ok']);self.assertEqual(result['restoreValidation']['state'],'unknown')
 def test_malformed_backup_record(self):
  for data in [None, [], {'runs':[]}, {'runs':{'cloud':None}}]:
   (self.ns['DATA_DIR']/'backup-status.json').write_text(json.dumps(data))
   self.assertIsNot(self.ns['backup_status']()['ok'],True)
 def test_health(self):
  now=datetime.now(timezone.utc).isoformat()
  for status,stamp,want in [('warning',now,True),('error',now,False),('starting',None,False),('ok','2026-01-01T00:00:00+00:00',False)]:
   self.assertEqual(self.ns['monitor_health']({'status':status,'collectedAt':stamp})['ok'],want)
 def test_schedule(self):
  class Clock:
   hour=9
   minute=0
   @classmethod
   def now(cls,tz):
    assert tz.key == "Asia/Tokyo"
    return datetime(2026,11,5,cls.hour,cls.minute,tzinfo=tz)
  self.ns['datetime']=Clock; self.ns['recent_resource_summary']=lambda:{'samples':1}; calls=[]
  self.ns['send_discord']=lambda *a,**kw: calls.append((a,kw)) or True
  snapshot={'status':'ok','uptimeSeconds':3600,'cpu':{'usedPercent':2},'memory':{'usedPercent':30,'totalBytes':100,'usedBytes':30},'disks':[],'docker':[{'state':'running'}],'pm2':[],'backup':{'ok':True},'alerts':[]}
  self.ns['scheduled_report'](snapshot);self.ns['scheduled_report'](snapshot)
  self.assertEqual(len(calls),1);self.assertFalse(calls[0][1]['mention'])
  (self.ns['DATA_DIR']/'last-report-slot').unlink()
  self.ns['send_discord']=lambda *a,**kw:False; self.ns['record_event']=lambda *a,**kw:None
  self.ns['scheduled_report'](snapshot)
  self.assertFalse((self.ns['DATA_DIR']/'last-report-slot').exists())
  calls.clear()
  self.ns['send_discord']=lambda *a,**kw: calls.append((a,kw)) or True
  for hour in range(24):
   Clock.hour=hour
   self.ns['scheduled_report'](snapshot)
  self.assertEqual(len(calls),6)
  self.assertTrue(all(not call[1]['mention'] for call in calls))
  Clock.hour=9;Clock.minute=5
  self.ns['scheduled_report'](snapshot)
  self.assertEqual(len(calls),6)
if __name__=='__main__':unittest.main()
