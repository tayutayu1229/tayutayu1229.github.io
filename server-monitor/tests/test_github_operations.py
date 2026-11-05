import json
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import github_operations as g


class Response:
    status=200
    def __init__(self,payload):
        self.payload=payload;self.headers={'X-RateLimit-Remaining':'42','X-RateLimit-Limit':'60'}
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def read(self,*a):return json.dumps(self.payload).encode()


class GitHubFacts(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.db=Path(self.tmp.name)/'db.sqlite3'
        self.repo={'name':'owner/repo','branch':'main'}

    def test_public_reads_cache_success_and_failed_refresh_preserves_freshness(self):
        with patch.dict(g.os.environ,{},clear=True),patch.object(g,'urlopen',return_value=Response({'name':'repo'})) as send:
            client=g.GitHub(self.db);first=client.get('/repos/owner/repo');second=client.get('/repos/owner/repo')
            self.assertEqual(send.call_count,1);self.assertTrue(second['cached']);self.assertEqual(first['fetchedAt'],second['fetchedAt'])
        with patch.object(g,'urlopen',side_effect=HTTPError('https://api.github.com',401,'Unauthorized',{},io.BytesIO(b'Unauthorized'))):
            failed=g.GitHub(self.db).get('/repos/owner/repo',ttl=0)
        self.assertIsNotNone(failed['error']);self.assertEqual(failed['data'],{'name':'repo'});self.assertEqual(failed['fetchedAt'],first['fetchedAt'])

    def test_no_commit_or_identity_is_invented_on_failure(self):
        with patch.object(g,'urlopen',side_effect=OSError):
            client=g.GitHub(self.db);text=g.render(client,self.repo)
        self.assertIn('取得',text);self.assertIn('失敗',text);self.assertNotIn('公開済みコミットは一致',text)

    def test_token_body_never_enters_persisted_metadata(self):
        token='test-secret-not-a-real-token'
        with patch.dict(g.os.environ,{'TAYUNET_GITHUB_TOKEN':token}),patch.object(g,'urlopen',return_value=Response({})):
            result=g.GitHub(self.db).get('/rate_limit')
        self.assertNotIn(token,json.dumps(result));self.assertEqual(result['metadata']['tokenSuffix'],token[-4:])

    def test_failure_job_and_step_are_reported(self):
        class Fake:
            observations=[]
            def need(self,path,**kw):
                if '/jobs?' in path:return {'total_count':1,'jobs':[{'name':'build','conclusion':'failure','steps':[{'name':'compile','conclusion':'failure'}]}]}
                return {'workflow_runs':[{'id':2,'name':'Publish','conclusion':'failure','status':'completed','run_started_at':'2026-11-05T00:00:00Z','updated_at':'2026-11-05T00:01:10Z','html_url':'https://github.com/owner/repo/actions/runs/2'}]}
            def freshness(self):return []
        text=g.render(Fake(),self.repo,'actions')
        self.assertIn('build / compile',text);self.assertIn('1分10秒',text);self.assertIn('失敗',text)

    def test_issue_count_excludes_pull_requests_by_query(self):
        class Fake:
            observations=[]
            paths=[]
            def need(self,path,**kw):self.paths.append(path);return {'total_count':12,'incomplete_results':False,'items':[]}
            def freshness(self):return []
        client=Fake();text=g.render(client,self.repo,'issues',2)
        self.assertIn('is%3Aissue',client.paths[0]);self.assertIn('12件 / ページ2',text)

    def test_successful_deployment_is_compared_with_target_branch(self):
        class Fake:
            observations=[]
            def need(self,path,**kw):
                if '/statuses?' in path:return [{'state':'success','created_at':'2026-11-05T00:00:00Z','log_url':'https://github.com/run'}]
                if '/deployments?' in path:return [{'id':3,'sha':'a'*40,'created_at':'2026-11-05T00:00:00Z'}]
                if '/commits/' in path:return {'sha':'b'*40}
                if '/compare/' in path:return {'status':'ahead','ahead_by':2,'behind_by':0,'html_url':'https://github.com/compare'}
                raise AssertionError(path)
            def freshness(self):return []
        text=g.render(Fake(),self.repo,'deploy')
        self.assertIn('未公開側 2件',text);self.assertNotIn('コミットは一致',text)


if __name__=='__main__':unittest.main()
