"""Bounded GitHub read access, persistent freshness metadata, and operator views."""
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
from discord_command_config import connect, stamp


def jst(value):
    if not value:
        return '未確認'
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Tokyo')).strftime('%Y/%m/%d %H:%M:%S JST')
    except (TypeError, ValueError):
        return '日時不明'


def label(value):
    return {'success': '成功', 'failure': '失敗', 'cancelled': '中止', 'skipped': '省略', 'completed': '完了', 'in_progress': '実行中', 'queued': '待機中', 'timed_out': '時間切れ', 'action_required': '要対応'}.get(value, value or '未確認')


class GitHub:
    def __init__(self, db_path):
        self.db_path = db_path
        self.token = os.environ.get('TAYUNET_GITHUB_TOKEN', '')
        self.observations = []
        self.deadline = time.monotonic() + 35

    def get(self, path, ttl=300):
        if not path.startswith('/') or path.startswith('//'):
            raise ValueError('invalid GitHub path')
        key = hashlib.sha256((('auth:' + hashlib.sha256(self.token.encode()).hexdigest()) if self.token else 'public').encode() + path.encode()).hexdigest()
        with connect(self.db_path) as db:
            old = db.execute('SELECT * FROM bot_cache WHERE key=?', (key,)).fetchone()
        now = time.time()
        if old and old['last_attempt']:
            age = now - datetime.fromisoformat(old['last_attempt']).timestamp()
            if age < (60 if old['error'] else ttl):
                return self._result(old, cached=True)
        started = time.monotonic()
        headers = {'User-Agent': 'TayunetOperations/1.0', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        error = None
        data = None
        response_headers = {}
        status = 0
        try:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('GitHub read deadline')
            with urlopen(Request('https://api.github.com' + path, headers=headers), timeout=min(8, remaining)) as response:
                status = response.status
                response_headers = response.headers
                data = json.loads(response.read(4_000_000))
        except HTTPError as exc:
            status, response_headers = exc.code, exc.headers
            exc.close()
            error = {401: '認証が無効です。期限切れ・失効・トークン設定を確認してください。', 403: 'API制限または権限不足です。残数と権限を確認してください。', 404: '対象が見つからないか、参照権限がありません。'}.get(status, 'GitHub APIがHTTP ' + str(status) + 'を返しました。')
        except (URLError, OSError, TimeoutError, ValueError) as exc:
            error = 'GitHubに接続・応答解析できません: ' + type(exc).__name__
        metadata = {'status': status, 'responseMs': round((time.monotonic() - started) * 1000), 'path': path,
                    'mode': 'authenticated' if self.token else 'public',
                    'tokenSuffix': self.token[-4:] if self.token else None,
                    'remaining': response_headers.get('X-RateLimit-Remaining'), 'limit': response_headers.get('X-RateLimit-Limit'),
                    'reset': response_headers.get('X-RateLimit-Reset'), 'scopes': response_headers.get('X-OAuth-Scopes'),
                    'expiresAt': response_headers.get('GitHub-Authentication-Token-Expiration')}
        record = {'key': key, 'payload': json.dumps(data if error is None else json.loads(old['payload']) if old else None),
                  'fetched_at': stamp() if error is None else old['fetched_at'] if old else None,
                  'last_attempt': stamp(), 'error': error, 'metadata': json.dumps(metadata)}
        with connect(self.db_path) as db:
            db.execute('INSERT OR REPLACE INTO bot_cache(key,payload,fetched_at,last_attempt,error,metadata) VALUES(:key,:payload,:fetched_at,:last_attempt,:error,:metadata)', record)
        return self._result(record)

    def _result(self, row, cached=False):
        result = {'data': json.loads(row['payload']), 'fetchedAt': row['fetched_at'], 'lastAttempt': row['last_attempt'],
                  'error': row['error'], 'metadata': json.loads(row['metadata']), 'cached': cached}
        self.observations.append({k: v for k, v in result.items() if k != 'data'})
        return result

    def need(self, path, ttl=300):
        result = self.get(path, ttl)
        if result['error'] and result['data'] is None:
            raise RuntimeError(result['error'])
        return result['data']

    def freshness(self):
        lines = []
        for x in self.observations:
            if x['error']:
                lines.append('⚠ 取得失敗: ' + x['error'] + ' 前回成功 ' + jst(x['fetchedAt']))
        times = [x['fetchedAt'] for x in self.observations if x['fetchedAt']]
        if times:
            lines.append('データ取得時刻: ' + jst(min(times)) + ('（一部または全部キャッシュ、通常5分）' if any(x['cached'] for x in self.observations) else ''))
        if self.observations:
            m = self.observations[-1]['metadata']
            lines.append('API残数（取得時点）: ' + str(m.get('remaining') or '未確認') + '/' + str(m.get('limit') or '未確認'))
        return lines


def elapsed(run):
    try:
        start = datetime.fromisoformat(run['run_started_at'].replace('Z', '+00:00'))
        end = datetime.fromisoformat(run['updated_at'].replace('Z', '+00:00')) if run['status'] == 'completed' else datetime.now(timezone.utc)
        seconds = max(0, int((end - start).total_seconds()))
        return str(seconds // 60) + '分' + str(seconds % 60) + '秒' + ('経過' if run['status'] != 'completed' else '')
    except (KeyError, ValueError, TypeError):
        return '時間未確認'


def deployment(client, repo):
    base = '/repos/' + repo['name']
    deployments = client.need(base + '/deployments?environment=github-pages&per_page=5')
    latest = None
    published = None
    for item in deployments:
        statuses = client.need(base + '/deployments/' + str(int(item['id'])) + '/statuses?per_page=20')
        if latest is None:
            latest = {'sha': item['sha'], 'state': statuses[0]['state'] if statuses else 'unknown', 'at': statuses[0]['created_at'] if statuses else item['created_at']}
        success = next((x for x in statuses if x.get('state') == 'success'), None)
        if success:
            published = {'sha': item['sha'], 'at': success['created_at'], 'url': success.get('environment_url') or success.get('target_url') or '', 'logUrl': success.get('log_url') or '', 'active': bool(statuses and statuses[0].get('state') == 'success')}
            break
    return latest, published


def render(client, repo, view='summary', page=1):
    base = '/repos/' + repo['name']
    branch = quote(repo['branch'], safe='')
    lines = ['GitHub: ' + repo['name'] + ' / 対象ブランチ ' + repo['branch']]
    try:
        if view in ('summary', 'commits'):
            metadata = client.need(base)
            commits = client.need(base + '/commits?sha=' + branch + '&per_page=5')
            lines += ['既定ブランチ: ' + metadata['default_branch'], '最終push: ' + jst(metadata.get('pushed_at'))]
            for item in commits[:1 if view == 'summary' else 5]:
                commit = item['commit']
                author = (item.get('author') or {}).get('login') or commit.get('author', {}).get('name', '不明')
                lines += ['• ' + item['sha'][:7] + ' ' + commit['message'].splitlines()[0][:250], '  作者: ' + author + ' / ' + jst(commit.get('committer', {}).get('date')), '  ' + item['html_url']]
            if view == 'summary':
                lines.append('公開情報は /ubuntu github 表示:deploy、作業一覧は pulls / issues で確認できます。')
        elif view == 'actions':
            runs = client.need(base + '/actions/runs?branch=' + branch + '&per_page=5')['workflow_runs']
            for run in runs:
                lines += ['• ' + run.get('name', 'ワークフロー') + ': ' + label(run.get('conclusion') or run['status']) + ' / ' + elapsed(run), '  ' + run['html_url']]
                if run.get('conclusion') in ('failure', 'timed_out', 'action_required'):
                    jobs = client.need(base + '/actions/runs/' + str(int(run['id'])) + '/jobs?per_page=100')
                    for job in jobs['jobs']:
                        if job.get('conclusion') not in ('success', 'skipped', None):
                            bad = [s['name'] for s in job.get('steps', []) if s.get('conclusion') in ('failure', 'timed_out', 'cancelled')]
                            lines.append('  失敗箇所: ' + job['name'] + ' / ' + ('、'.join(bad) or 'ステップ詳細なし'))
                    if jobs.get('total_count', 0) > len(jobs['jobs']):
                        lines.append('  ジョブが100件を超えるため、残りは実行ページを確認してください。')
            if not runs:
                lines.append('実行記録はありません。')
        elif view == 'deploy':
            latest, published = deployment(client, repo)
            lines.append('直近の公開処理: ' + (label(latest['state']) + ' / ' + latest['sha'][:7] + ' / ' + jst(latest['at']) if latest else '未確認'))
            if not published:
                lines.append('直近5件で公開成功を確認できません。公開済みと推測しません。')
            else:
                lines += ['最終公開成功: ' + jst(published['at']), ('公開中として確認できたコミット: ' if published.get('active') else '最終公開成功コミット（現在の公開状態は未確認）: ') + published['sha'][:7], published['logUrl'] or published['url']]
                latest_commit = client.need(base + '/commits/' + branch)
                if latest_commit['sha'] == published['sha']:
                    lines.append('最新コミットと公開済みコミットは一致しています。')
                else:
                    comparison = client.need(base + '/compare/' + quote(published['sha'], safe='') + '...' + branch)
                    lines.append('公開済み→対象ブランチ: ' + comparison.get('status', '未確認') + ' / 未公開側 ' + str(comparison.get('ahead_by', '?')) + '件 / 逆方向 ' + str(comparison.get('behind_by', '?')) + '件')
                    lines.append(comparison.get('html_url', ''))
        elif view in ('pulls', 'issues'):
            query = 'repo:' + repo['name'] + ' is:open is:' + ('pr' if view == 'pulls' else 'issue')
            result = client.need('/search/issues?q=' + quote(query, safe='') + '&sort=created&order=desc&per_page=10&page=' + str(page))
            lines.append(('オープンPR' if view == 'pulls' else 'オープンIssue') + ': ' + str(result['total_count']) + '件 / ページ' + str(page))
            if result.get('incomplete_results'):
                lines.append('⚠ GitHub検索の結果が不完全です。件数・一覧は参考値です。')
            for item in result['items']:
                lines += ['• #' + str(item['number']) + ' ' + item['title'][:200] + ' / 作成者 ' + item['user']['login'], '  ' + item['html_url']]
            if result['total_count'] > page * 10:
                lines.append('続きはページ番号を増やして確認してください。')
        elif view == 'connection':
            result = client.get('/rate_limit', ttl=30)
            m = result['metadata']
            lines += ['接続: ' + ('取得失敗' if result['error'] else '応答あり') + ' / HTTP ' + str(m['status']) + ' / ' + str(m['responseMs']) + 'ms',
                      '認証: ' + ('トークン使用（末尾 ' + m['tokenSuffix'] + '）' if m['mode'] == 'authenticated' else '公開API（トークン未使用）'),
                      'トークン期限: ' + str(m.get('expiresAt') or 'APIから確認できません'),
                      '権限範囲: ' + str(m.get('scopes') or ('認証なし' if m['mode'] == 'public' else 'APIから確認できません'))]
            core = (result['data'] or {}).get('resources', {}).get('core', {})
            if core:
                lines.append('API残数: ' + str(core.get('remaining', '?')) + '/' + str(core.get('limit', '?')) + ' / 再開目安 ' + jst(datetime.fromtimestamp(core['reset'], timezone.utc).isoformat()))
        else:
            raise ValueError('GitHubの表示項目が正しくありません。')
    except RuntimeError as exc:
        lines.append('⚠ ' + str(exc))
    if any(x['error'] for x in client.observations):
        lines.insert(1, '⚠ 一部の取得が失敗しています。前回データを含む場合があり、現在の状態と断定できません。')
    lines += client.freshness()
    return '\n'.join(x for x in lines if x)
