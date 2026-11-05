import json
from datetime import datetime,timezone,timedelta
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import bot_dashboard as b


class DashboardFacts(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.db=self.root/'db.sqlite3'
        with sqlite3.connect(self.db) as db:
            db.executescript('CREATE TABLE events(id INTEGER PRIMARY KEY,created_at TEXT,severity TEXT,code TEXT,message TEXT); CREATE TABLE actions(id INTEGER PRIMARY KEY,created_at TEXT,actor TEXT,success INTEGER,target TEXT); CREATE TABLE rollups(bucket TEXT,granularity TEXT,payload TEXT);')

    def test_missing_heartbeat_is_unknown_not_fabricated_online(self):
        facts=b.runtime(self.root)
        self.assertFalse(facts['available']);self.assertFalse(facts['online'])
        self.assertNotIn('pingMs',facts)

    def test_stale_heartbeat_is_not_online(self):
        old=(datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat()
        (self.root/'discord-bot-heartbeat.json').write_text(json.dumps({'heartbeatAt':old,'ready':True}))
        facts=b.runtime(self.root)
        self.assertTrue(facts['available']);self.assertFalse(facts['online']);self.assertEqual(facts['state'],'critical')

    def test_process_stop_overrides_fresh_ready_heartbeat(self):
        (self.root/'discord-bot-heartbeat.json').write_text(json.dumps({'heartbeatAt':datetime.now(timezone.utc).isoformat(),'ready':True}))
        facts=b.runtime(self.root,{'pm2':[{'name':'tokyo-discord-bot','status':'stopped'}]})
        self.assertFalse(facts['online']);self.assertIn('停止',facts['detail'])

    def test_configuration_revision_must_be_actually_observed(self):
        now=datetime.now(timezone.utc).isoformat()
        (self.root/'discord-bot-heartbeat.json').write_text(json.dumps({'heartbeatAt':now,'startedAt':now,'ready':True,'configRevision':0}))
        facts=b.overview(self.root,self.db,{})
        self.assertFalse(facts['applied']);self.assertIn('未確認',facts['runtime']['restartReason'])

    def test_only_correlated_restart_action_is_reported_as_manual(self):
        now=datetime.now(timezone.utc).isoformat()
        (self.root/'discord-bot-heartbeat.json').write_text(json.dumps({'heartbeatAt':now,'startedAt':now,'ready':True,'configRevision':1}))
        with sqlite3.connect(self.db) as db:db.execute('insert into actions(created_at,actor,success,target) values(?,?,?,?)',(now,'admin',1,'tokyo-discord-bot'))
        facts=b.overview(self.root,self.db,{})
        self.assertTrue(facts['applied']);self.assertIn('手動再起動',facts['runtime']['restartReason'])

    def test_resource_data_are_small_and_missing_values_remain_missing(self):
        with sqlite3.connect(self.db) as db:
            db.execute('insert into rollups values(?,?,?)',((datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat(),'5m',json.dumps({'cpu':{'usedPercent':20},'memory':{},'secret':'must not enter graph'})))
            db.execute('insert into rollups values(?,?,?)',((datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat(),'5m','broken'))
        result=b.resources(self.db,'1h')
        self.assertEqual(result['invalid'],1);self.assertIsNone(result['points'][0]['memory']);self.assertNotIn('secret',str(result))
        with self.assertRaises(ValueError):b.resources(self.db,'all')


if __name__=='__main__':unittest.main()
