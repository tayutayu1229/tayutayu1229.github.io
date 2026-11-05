import ast
import json
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from urllib.parse import quote
from urllib.request import Request
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import discord_command_config as c


class NotificationPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        names={'init_db','db_rows','db_execute','iso_now','redact_sensitive','record_event','flush_notifications','send_discord'}
        self.ns=dict(DB_PATH=self.root/'db.sqlite3',DATA_DIR=self.root,sqlite3=sqlite3,json=json,re=re,time=time,datetime=datetime,timezone=timezone,db_lock=threading.Lock(),CHANNEL_ID='1499762805065388274',Request=Request,quote=quote,sys=sys)
        source=ast.parse((Path(__file__).resolve().parents[1]/'monitor_service.py').read_text())
        exec(compile(ast.Module(body=[x for x in source.body if isinstance(x,ast.FunctionDef) and x.name in names],type_ignores=[]),'monitor','exec'),self.ns)
        self.ns['init_db']();self.ns['load_discord_token']=lambda:'dummy-not-a-real-token'
        self.sent=[]
        outer=self
        class Response:
            status=201
            def __enter__(self):return self
            def __exit__(self,*a):pass
        def send(request,**kw):
            outer.sent.append(json.loads(request.data));return Response()
        self.ns['urlopen']=send

    def test_public_control_roles_do_not_expand_failure_mentions(self):
        self.assertTrue(self.ns['send_discord']('issue','details','warning',mention=True))
        self.assertEqual(self.sent[0]['allowed_mentions'],{'parse':[],'roles':['1489628881135730852']})
        self.assertTrue(self.ns['send_discord']('recovered','details','ok',mention=False))
        self.assertEqual(self.sent[1]['allowed_mentions']['roles'],[])

    def test_pause_keeps_outbox_and_test_is_explicitly_unmentioned(self):
        config=c.load(self.root);config['notifications']['paused']=True;c.save(self.root,config)
        self.ns['record_event']('warning','test','pending')
        self.ns['flush_notifications']()
        self.assertEqual(self.sent,[])
        rows=self.ns['db_rows']('select * from notification_outbox');self.assertEqual(len(rows),1);self.assertEqual(rows[0]['attempts'],0)
        self.assertTrue(self.ns['send_discord']('test','test',mention=False,category='test'))
        self.assertEqual(self.sent[0]['allowed_mentions']['roles'],[])
        config=c.load(self.root);config['notifications']['paused']=False;c.save(self.root,config)
        self.ns['flush_notifications']();self.assertEqual(self.ns['db_rows']('select * from notification_outbox'),[])
        self.assertEqual(self.sent[-1]['allowed_mentions']['roles'],['1489628881135730852'])

    def test_disabled_category_is_recorded_as_suppressed_not_delivered(self):
        self.ns['record_event']('info','new-pr','new PR',category='github_pr')
        self.ns['flush_notifications']();self.assertEqual(self.sent,[])
        self.assertEqual(self.ns['db_rows']('select * from notification_outbox'),[])
        entries=c.history(self.ns['DB_PATH']);self.assertFalse(entries[0]['ok']);self.assertIn('抑止',entries[0]['detail'])


if __name__=='__main__':unittest.main()
