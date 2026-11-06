import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import ast,re,unittest
from pathlib import Path
class NoticeText(unittest.TestCase):
 def setUp(self):
  self.ns={'re':re}
  def run(cmd,**kw):return (0,'Result=exit-code\nExecMainStatus=1') if cmd[0]=='systemctl' else (0,'data/line-aliases.json: missing timetable line names: 伯備\nPRIVATE_TOKEN=secret')
  self.ns['run']=run
  tree=ast.parse((Path(__file__).resolve().parents[1]/'monitor_service.py').read_text());nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['failed_service_details','failed_services_message']];exec(compile(ast.Module(body=nodes,type_ignores=[]),'notice','exec'),self.ns)
 def test_unit_and_japanese_reason(self):
  lines=['● tayunet-private-data-sync.service loaded failed failed Synchronize data'];details=self.ns['failed_service_details'](lines);self.assertEqual(details[0]['unit'],'tayunet-private-data-sync.service');text=self.ns['failed_services_message']({'failedServices':lines,'failedServiceDetails':details});self.assertIn('非公開時刻表データの同期',text);self.assertIn('路線名',text);self.assertNotIn('secret',text)
 def test_fallback_keeps_service_name(self):self.assertIn('example.service',self.ns['failed_services_message']({'failedServices':['● example.service loaded failed failed description']}))
 def test_multiple_and_unknown_units(self):
  lines=['a.service loaded failed failed','b.service loaded failed failed'];details=self.ns['failed_service_details'](lines);text=self.ns['failed_services_message']({'failedServices':lines,'failedServiceDetails':details});self.assertIn('2件',text);self.assertIn('a.service',text);self.assertIn('b.service',text)
 def test_readable_log_target(self):
  import application_watch as m
  self.assertEqual(m.readable_target('application:watch:docker:tayunet-photo-archive'),'撮影記録・撮影地システムのログ監視')
if __name__=='__main__':unittest.main()
