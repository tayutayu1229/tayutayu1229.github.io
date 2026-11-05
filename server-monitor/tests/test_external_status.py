import importlib.util,tempfile,unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'external_status.py'
spec=importlib.util.spec_from_file_location('external_status',p); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Events(unittest.TestCase):
 def test_transitions(self):
  with tempfile.TemporaryDirectory() as d:
   calls=[];send=lambda *a,**kw:calls.append((a,kw)) or True
   item=dict(id='discord',name='Discord',available=True,indicator='none',incidents=[],description='normal',impact='unconfirmed',source='https://discordstatus.com')
   m.notify_changes([item],Path(d),send);self.assertEqual(len(calls),0)
   item.update(indicator='major',incidents=[dict(id='incident',name='API',status='investigating')])
   m.notify_changes([item],Path(d),send);m.notify_changes([item],Path(d),send);self.assertEqual(len(calls),1);self.assertTrue(calls[0][1]['mention'])
   item['available']=False;m.notify_changes([item],Path(d),send);self.assertEqual(len(calls),1)
   item.update(available=True,indicator='none',incidents=[])
   m.notify_changes([item],Path(d),lambda *a,**kw:False)
   m.notify_changes([item],Path(d),send);self.assertEqual(len(calls),2);self.assertIn('復旧',calls[1][0][0]);self.assertFalse(calls[1][1]['mention'])
   item['indicator']='maintenance';m.notify_changes([item],Path(d),send);self.assertFalse(calls[2][1]['mention'])
if __name__=='__main__':unittest.main()
