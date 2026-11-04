import ast,json,re,sqlite3,tempfile,threading,time,unittest
from datetime import datetime,timezone
from pathlib import Path
SOURCE=Path(__file__).resolve().parents[1]/'monitor_service.py'
class Delivery(unittest.TestCase):
 def test_persistent_retry(self):
  with tempfile.TemporaryDirectory() as d:
   names={'init_db','db_rows','db_execute','iso_now','redact_sensitive','record_event','flush_notifications','restore_alerts','persist_alerts'}
   ns=dict(DATA_DIR=Path(d),DB_PATH=Path(d)/'test.db',db_lock=threading.Lock(),sqlite3=sqlite3,datetime=datetime,timezone=timezone,json=json,re=re,time=time,active_alerts={})
   tree=ast.parse(SOURCE.read_text());exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'monitor','exec'),ns)
   ns['init_db']();ns['record_event']('warning','backup','test','password=secret')
   self.assertNotIn('secret',ns['db_rows']('select detail from events')[0]['detail'])
   calls=[];ns['send_discord']=lambda *a,**kw:calls.append(kw) or False
   ns['flush_notifications']();self.assertEqual(ns['db_rows']('select attempts from notification_outbox')[0]['attempts'],1)
   ns['flush_notifications']();self.assertEqual(len(calls),1)
   ns['db_execute']('update notification_outbox set next_attempt=0')
   ns['send_discord']=lambda *a,**kw:True;ns['flush_notifications']();self.assertEqual(ns['db_rows']('select * from notification_outbox'),[])
   ns['active_alerts']={'backup':{'code':'backup','message':'test'}};ns['persist_alerts']();ns['active_alerts']={};ns['restore_alerts']();self.assertIn('backup',ns['active_alerts'])
if __name__=='__main__':unittest.main()
