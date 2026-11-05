import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

p = Path(__file__).resolve().parents[1] / 'sqlite_history_backup.py'
spec = importlib.util.spec_from_file_location('sqlite_history_backup_test', p)
m = importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ConsistentHistory(unittest.TestCase):
    def test_standalone_snapshot_includes_wal_and_passes_check(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);source=root/'live.sqlite3';target=root/'history.sqlite3'
            writer=sqlite3.connect(source)
            self.addCleanup(writer.close)
            writer.execute('PRAGMA journal_mode=WAL')
            writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute('CREATE TABLE history(id INTEGER PRIMARY KEY, value TEXT)');writer.commit()
            writer.execute('INSERT INTO history VALUES(1,?)',('committed-in-wal',));writer.commit()
            self.assertGreater(Path(str(source)+'-wal').stat().st_size,0)
            result=subprocess.run([sys.executable,'-c',m.CONTAINER_SCRIPT,str(source),str(target),'0'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            proof=json.loads((root/'result.json').read_text())
            self.assertEqual(proof['quickCheck'],[['ok']])
            self.assertEqual(proof['sha256'],hashlib.sha256(target.read_bytes()).hexdigest())
            with sqlite3.connect(target) as con:
                self.assertEqual(con.execute('PRAGMA journal_mode').fetchone()[0],'delete')
                self.assertEqual(con.execute('SELECT value FROM history').fetchall(),[('committed-in-wal',)])
            writer.execute('INSERT INTO history VALUES(2,?)',('later',));writer.commit()
            with sqlite3.connect(target) as con:self.assertEqual(con.execute('SELECT count(*) FROM history').fetchone()[0],1)

    def test_corrupt_source_does_not_claim_success(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);source=root/'invalid.sqlite3';source.write_bytes(b'not-a-database'*100)
            result=subprocess.run([sys.executable,'-c',m.CONTAINER_SCRIPT,str(source),str(root/'out.sqlite3'),'0'],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse((root/'result.json').exists())

    def test_copy_keeps_one_snapshot_while_another_connection_commits(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);source=root/'live.sqlite3';target=root/'history.sqlite3'
            writer=sqlite3.connect(source);self.addCleanup(writer.close)
            writer.execute('PRAGMA journal_mode=WAL');writer.execute('PRAGMA wal_autocheckpoint=0')
            writer.execute('CREATE TABLE history(id INTEGER PRIMARY KEY, payload BLOB)')
            writer.executemany('INSERT INTO history VALUES(?,?)',[(i,b'x'*65536) for i in range(100)]);writer.commit()
            # Commit through another connection between backup steps. Without
            # the source read transaction, later steps restart on newer data.
            injection="""global last_save
 if remaining>0 and not (target.parent/'injected').exists():
  other=sqlite3.connect(source)
  other.execute('INSERT INTO history VALUES(999,?)',(b'later',));other.commit();other.close()
  (target.parent/'injected').touch()
"""
            script=m.CONTAINER_SCRIPT.replace('global last_save',injection,1)
            result=subprocess.run([sys.executable,'-c',script,str(source),str(target),'0'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertTrue((root/'injected').exists())
            self.assertEqual(writer.execute('SELECT count(*) FROM history').fetchone()[0],101)
            with sqlite3.connect(target) as con:self.assertEqual(con.execute('SELECT count(*) FROM history').fetchone()[0],100)

    def test_cleanup_only_own_known_temporary_directory(self):
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);allowed=root/'tayunet-history-snapshot-test';allowed.mkdir();(allowed/'test').write_text('temp')
            unrelated=root/'business-data';unrelated.mkdir();(unrelated/'data').write_text('keep')
            link=root/'tayunet-history-snapshot-link';link.symlink_to(unrelated, target_is_directory=True)
            with patch.dict(os.environ,{'TAYUNET_HISTORY_SNAPSHOT_ROOT':str(root)}):
                for unsafe in (unrelated,root,link):
                    with self.assertRaises(ValueError):m.remove_snapshot(unsafe)
                m.remove_snapshot(allowed)
            self.assertFalse(allowed.exists());self.assertEqual((unrelated/'data').read_text(),'keep')

if __name__=='__main__':unittest.main()
