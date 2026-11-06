import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import json,sqlite3,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone
import application_watch as watch
class WatchTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.db=self.root/'monitor.sqlite3';self.log=self.root/'app.log';self.log.write_text('old ERROR ignored\n');self.now=10000.;self.pending=0;self.missing=[];self.probe_fail=False
  with sqlite3.connect(self.db) as db:db.execute('CREATE TABLE test_outbox(code TEXT,severity TEXT,message TEXT)')
 def tearDown(self):self.temp.cleanup()
 def record(self,severity,code,message,**kw):kw['db'].execute('INSERT INTO test_outbox VALUES(?,?,?)',(code,severity,message))
 def execute(self,args,timeout=0):
  if 'jlist' in args:return 0,json.dumps([{'name':'test-app','pm2_env':{'pm_out_log_path':str(self.log)}}])
  if 'exec' in args:return 0,json.dumps({'probeError':True} if self.probe_fail else {'pending':self.pending,'missing':self.missing,'feedAt':datetime.fromtimestamp(self.now,timezone.utc).isoformat()})
  if 'logs' in args:return 0,''
  raise AssertionError(args)
 def poll(self):return watch.poll(self.root,self.db,self.record,self.execute,'pm2',{'test-app'},set(),self.now)
 def events(self,prefix='application:test-app:'):
  with sqlite3.connect(self.db) as db:return db.execute('SELECT code,severity,message FROM test_outbox WHERE code LIKE ?',(prefix+'%',)).fetchall()
 def append(self,text):
  with self.log.open('a') as f:f.write(text+'\n')
 def test_baseline(self):self.poll();self.assertEqual(self.events(),[])
 def test_sanitized_permission_error(self):
  self.poll();self.append('[エラー] Discord HTTP 403 Missing Permissions 50013 TOP_SECRET token=secret');self.now+=60;self.poll();events=self.events();self.assertEqual(len(events),1);self.assertEqual(events[0][0],'application:test-app:discord-permission');self.assertNotIn('TOP_SECRET',events[0][2]);self.assertNotIn('token=secret',events[0][2])
 def test_dedup_after_reopen(self):
  self.poll();self.append('ERROR failed');self.now+=60;self.poll();self.append('ERROR again');self.now+=60;self.poll();self.assertEqual(len(self.events()),1)
 def test_partial_line(self):
  self.poll()
  with self.log.open('a') as f:f.write('ERROR partial')
  self.now+=60;self.poll();self.assertEqual(self.events(),[]);self.append(' completed');self.now+=60;self.poll();self.assertEqual(len(self.events()),1)
 def test_rotation(self):
  self.poll();self.log.rename(self.root/'old.log');self.log.write_text('ERROR rotated\n');self.now+=60;self.poll();self.assertEqual(len(self.events()),1)
 def test_expected_401_400(self):
  self.poll();self.append('HTTP 401 unauthenticated; HTTP 400 user input');self.now+=60;self.poll();self.assertEqual(self.events(),[])
 def test_quiet_not_false_recovery(self):
  self.poll();self.append('ERROR failed');self.now+=60;self.poll();self.now+=601;self.poll();events=self.events('quiet:application:test-app:');self.assertEqual(events[0][1],'info');self.assertIn('保証する通知ではありません',events[0][2]);self.assertEqual(self.events('recovered:application:test-app:'),[])
 def test_permissions_recovery(self):
  self.missing=['送信'];self.poll();self.assertEqual(len(self.events('application:press:discord-permission')),1);self.missing=[];self.now+=121;self.poll();events=self.events('recovered:application:press:discord-permission');self.assertEqual(len(events),1);self.assertEqual(events[0][1],'ok')
 def test_backlog_then_clear(self):
  self.pending=2;self.poll();self.assertEqual(self.events('application:press:backlog'),[]);self.now+=240;self.poll();self.assertEqual(len(self.events('application:press:backlog')),1);self.pending=0;self.now+=121;self.poll();self.assertEqual(len(self.events('recovered:application:press:backlog')),1)
 def test_permission_failure_does_not_claim_backlog_recovered(self):
  self.pending=2;self.poll();self.now+=240;self.poll();self.missing=['送信'];self.now+=121;self.poll();self.assertEqual(self.events('recovered:application:press:backlog'),[])
 def test_probe_unavailable(self):
  self.probe_fail=True;self.poll();self.assertEqual(len(self.events('application:press:probe')),1)
 def test_rollback_does_not_consume_error(self):
  self.poll();self.append('ERROR retry');self.now+=60
  def fail(*a,**kw):raise sqlite3.OperationalError('test failure')
  with self.assertRaises(sqlite3.OperationalError):watch.poll(self.root,self.db,fail,self.execute,'pm2',{'test-app'},set(),self.now)
  self.poll();self.assertEqual(len(self.events()),1)
 def test_backup_age(self):
  with watch.connect(self.db) as db:
   (self.root/'backup-status.json').write_text(json.dumps({'ok':True,'finishedAt':datetime.fromtimestamp(self.now,timezone.utc).isoformat()}));watch.managed_backup_check(db,self.record,self.now,self.root);watch.managed_backup_check(db,self.record,self.now+37*3600,self.root)
  self.assertEqual(len(self.events('application:managed-db:backup')),1)
 def test_browser_report_is_routed_to_its_system(self):
  self.poll();self.append('ClientError system=jrchr kind=service_error');self.now+=60;self.poll();self.assertEqual(len(self.events('application:browser:jrchr:service_error')),1)
 def test_docker_failure_keeps_cursor(self):
  _,cursor,error=watch.docker_chunk('app','old',self.now,lambda *a,**kw:(1,'unavailable'));self.assertEqual(cursor,'old');self.assertTrue(error)
if __name__=='__main__':unittest.main()
