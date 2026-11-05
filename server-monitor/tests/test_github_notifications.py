import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import discord_command_config as c
import github_notifications as n


class GithubNotificationState(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.db=self.root/'db.sqlite3'
        config=c.load(self.root);config['notifications']['types']['github_pr']['enabled']=True;c.save(self.root,config)
        self.items=[];self.error=None;outer=self
        class API:
            def __init__(self,*a):pass
            def get(self,path):return {'error':outer.error,'data':{'items':outer.items,'incomplete_results':False}}
        self.patch=patch.object(n,'GitHub',API);self.patch.start();self.addCleanup(self.patch.stop)
        self.recorded=[]

    def record(self,*args,**kwargs):self.recorded.append((args,kwargs))
    def poll(self,callback=None):n._last_poll=-1000;n.poll(self.root,self.db,callback or self.record)

    def test_initial_baseline_does_not_send_old_items_then_sends_new_once(self):
        self.items=[{'number':1,'title':'old PR','html_url':'https://github.com/pr/1'}];self.poll();self.assertEqual(self.recorded,[])
        self.items.insert(0,{'number':2,'title':'new PR','html_url':'https://github.com/pr/2'});self.poll();self.poll()
        self.assertEqual(len(self.recorded),1);self.assertEqual(self.recorded[0][0][0],'info');self.assertEqual(self.recorded[0][1]['category'],'github_pr')

    def test_failed_fetch_does_not_advance_state_and_is_audited(self):
        self.poll();self.error='test API unavailable';self.items=[{'number':2,'title':'new PR','html_url':'https://github.com/pr/2'}];self.poll();self.assertEqual(self.recorded[0][0][0],'warning')
        self.error=None;self.poll();self.assertEqual(len([x for x in self.recorded if x[1]['category']=='github_pr']),1)
        self.assertTrue(any(x['kind']=='error' for x in c.history(self.db)))

    def test_notification_storage_failure_rolls_back_observed_state(self):
        self.poll();self.items=[{'number':2,'title':'new PR','html_url':'https://github.com/pr/2'}]
        def fail(*a,**kw):raise sqlite3.OperationalError('test failure')

        with self.assertRaises(sqlite3.OperationalError):self.poll(fail)
        self.poll();self.assertEqual(len(self.recorded),1)

    def test_paused_notifications_do_not_poll_or_send(self):
        config=c.load(self.root);config['notifications']['paused']=True;c.save(self.root,config)
        self.items=[{'number':1,'title':'new','html_url':'https://github.com/pr/1'}];self.poll();self.assertEqual(self.recorded,[])
        self.assertFalse(self.db.exists())


if __name__=='__main__':unittest.main()
