import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('freight_feed',Path(__file__).resolve().parents[1]/'freight_feed.py')
feedmod=importlib.util.module_from_spec(spec);spec.loader.exec_module(feedmod)

class FeedTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.directory=Path(self.temp.name)
        self.feed=feedmod.FreightFeed(self.directory,'python3','scraper.py')
    def tearDown(self): self.temp.cleanup()
    def write(self,name,data): (self.directory/name).write_text(json.dumps(data))
    def test_success_then_failure_preserves_previous_data(self):
        data={'ok':True,'trains':[{'service':'100列車'}],'routes':[],'incidents':[]}
        def run(*args,**kwargs):
            self.write('freight-status.json',data)
            self.write('fetch-health.json',{'ok':True,'checkedAt':'first','lastSuccessAt':'first'})
            return type('Result',(),{'returncode':0})()
        with patch.object(feedmod.subprocess,'run',side_effect=run): self.feed.collect()
        self.assertEqual(self.feed.snapshot()['data'],data)
        with patch.object(feedmod.subprocess,'run',side_effect=TimeoutError()): self.feed.collect()
        result=self.feed.snapshot();self.assertEqual(result['data'],data);self.assertFalse(result['health']['ok']);self.assertEqual(result['health']['lastSuccessAt'],'first')
        restarted=feedmod.FreightFeed(self.directory,'python3','scraper.py');self.assertEqual(restarted.snapshot(),result)
    def test_closed_hours_keeps_actual_success_time(self):
        self.write('freight-status.json',{'ok':True,'trains':[],'routes':[],'incidents':[]})
        self.write('fetch-health.json',{'ok':True,'available':False,'reason':'outside_service_hours','checkedAt':'closed','lastSuccessAt':'previous'})
        with patch.object(feedmod.subprocess,'run',return_value=type('Result',(),{'returncode':0})()): self.feed.collect()
        self.assertFalse(self.feed.snapshot()['health']['available']);self.assertEqual(self.feed.snapshot()['health']['lastSuccessAt'],'previous')
    def test_duplicate_run_is_skipped_and_get_never_collects(self):
        self.feed.run_lock.acquire()
        try:
            with patch.object(feedmod.subprocess,'run') as run:
                self.assertFalse(self.feed.collect());self.feed.snapshot();run.assert_not_called()
        finally:self.feed.run_lock.release()
    def test_output_must_be_new_and_well_formed(self):
        self.write('fetch-health.json',{'ok':True,'checkedAt':None})
        with patch.object(feedmod.subprocess,'run',return_value=type('Result',(),{'returncode':0})()):self.feed.collect()
        self.assertFalse(self.feed.snapshot()['health']['ok'])
    def test_interval_is_bounded(self): self.assertEqual(feedmod.FreightFeed(self.directory,'py','scraper',1).interval,300)
    def test_public_feed_does_not_expose_admin_routes(self):
        import ast
        from urllib.parse import urlparse
        source=Path(__file__).resolve().parents[1]/'monitor_service.py'
        tree=ast.parse(source.read_text())
        handler=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        method=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='do_GET')
        class AuthError(Exception):
            status=403
            code='denied'
        ns={'urlparse':urlparse,'FREIGHT_FEED':self.feed,'AuthError':AuthError,'json':json}
        exec(compile(ast.Module(body=[method],type_ignores=[]),'handler','exec'),ns)
        class Request:
            path='/server-monitor/freight-status'
            def send_json(self,status,payload):return(status,payload)
            def authorize(self):raise AuthError('denied')
        request=Request()
        self.assertEqual(ns['do_GET'](request)[0],200)
        request.path='/server-monitor/api/status'
        self.assertEqual(ns['do_GET'](request)[0],403)
