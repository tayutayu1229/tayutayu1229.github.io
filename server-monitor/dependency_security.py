"""Read the public dependency audit evidence without GitHub credentials."""
import json
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

REPOSITORY = 'tayutayu1229/tayutayu1229.github.io'
API = 'https://api.github.com/repos/' + REPOSITORY
WORKFLOW = 'https://github.com/' + REPOSITORY + '/actions/workflows/dependency-security.yml'
AUDITS = {'node': 'Run npm audit --omit=dev --audit-level=high',
          'photo-archive': 'Run pip-audit -r requirements.txt'}
SCOPE = 'PDF出力のNode本番依存（high以上）／撮影記録のPython依存。全サービス・全脆弱性を網羅する検査ではありません。'
_cached = None
_checked = 0.0


def request_json(path):
    req = Request(API + path, headers={'User-Agent': 'TayunetMonitor/1.0',
                                      'Accept': 'application/vnd.github+json'})
    with urlopen(req, timeout=8) as response:
        return json.loads(response.read(2_000_000))


def evaluate(run, jobs, now):
    checked = datetime.fromisoformat(run['updated_at'].replace('Z', '+00:00'))
    age = now - checked.timestamp()
    if age < -300:
        raise ValueError('Audit timestamp is in the future')
    checks = []
    for name, step_name in AUDITS.items():
        matches = [s for job in jobs if job.get('name') == name
                   for s in job.get('steps', []) if s.get('name') == step_name]
        checks.append({'name': name, 'conclusion': matches[0].get('conclusion') if len(matches) == 1 else 'unknown'})
    state = ('stale' if age > 8 * 86400 else 'failed' if any(x['conclusion'] == 'failure' for x in checks)
             else 'passed' if all(x['conclusion'] == 'success' for x in checks) else 'unknown')
    detail = {'passed': '直近の対象依存検査は合格です。',
              'failed': '依存検査が失敗しています。検出内容または検査エラーを実行ログで確認してください。',
              'stale': '依存検査の結果が8日以上更新されていません。定期検査の実行状況を確認してください。',
              'unknown': '依存検査の実行完了を確認できません。正常とは判定していません。'}[state]
    return {'available': True, 'state': state, 'detail': detail, 'auditedAt': run['updated_at'],
            'runId': run['id'], 'source': WORKFLOW + '?query=branch%3Amain',
            'checks': checks, 'workflowConclusion': run.get('conclusion'), 'commit': run.get('head_sha')}


def dependency_security_status():
    global _cached, _checked
    if _cached is not None and time.monotonic() - _checked < (3600 if _cached.get('available') else 900):
        return _cached
    result = {'available': False, 'state': 'unknown', 'source': WORKFLOW,
              'checkedAt': datetime.now(timezone.utc).isoformat(), 'scope': SCOPE,
              'detail': '依存検査情報を取得できません。脆弱性がないという意味ではありません。'}
    try:
        runs = request_json('/actions/workflows/dependency-security.yml/runs?branch=main&status=completed&per_page=10')['workflow_runs']
        run = next(x for x in runs if x.get('head_branch') == 'main' and x.get('event') in ('push', 'schedule', 'workflow_dispatch'))
        jobs = request_json('/actions/runs/' + str(int(run['id'])) + '/jobs?per_page=100')
        if jobs['total_count'] != len(jobs['jobs']):
            raise ValueError('Incomplete job list')
        result.update(evaluate(run, jobs['jobs'], time.time()))
    except Exception as error:
        result['errorType'] = type(error).__name__
    _cached, _checked = result, time.monotonic()
    return result


def dependency_security_alerts(result):
    if not result:
        return []
    if result.get('state') != 'passed':
        return [{'code': 'dependency-security', 'severity': 'warning',
                 'message': result.get('detail', '依存検査の結果が未確認です。')}]
    return []
