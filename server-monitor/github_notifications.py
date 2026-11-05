"""Opt-in, baseline-aware GitHub notifications with an atomic durable outbox."""
import json
import time
from urllib.parse import quote
from discord_command_config import connect, load, audit
from github_operations import GitHub

_last_poll = 0.0


def poll(directory, db_path, record):
    global _last_poll
    if time.monotonic() - _last_poll < 300:
        return
    config = load(directory)
    types = config['notifications']['types']
    if config['notifications']['paused'] or not any(types[x]['enabled'] for x in types if x != 'ubuntu'):
        return
    _last_poll = time.monotonic()
    client = GitHub(db_path)
    for repo in [x for x in config['repositories'] if x['enabled']]:
        base = '/repos/' + repo['name']
        failures = []
        for category in ('github_actions', 'github_deploy', 'github_pr', 'github_issue'):
            if not types[category]['enabled']:
                continue
            try:
                if category == 'github_actions':
                    data = client.get(base + '/actions/runs?branch=' + quote(repo['branch'], safe='') + '&per_page=5')
                    if data['error']:
                        raise RuntimeError(data['error'])
                    items = [{'id': str(x['id']), 'state': x.get('conclusion') or x['status'], 'title': x.get('name', 'Actions'), 'url': x['html_url']} for x in data['data']['workflow_runs']]
                elif category == 'github_deploy':
                    data = client.get(base + '/deployments?environment=github-pages&per_page=5')
                    if data['error']:
                        raise RuntimeError(data['error'])
                    items = []
                    for x in data['data'][:2]:
                        status = client.get(base + '/deployments/' + str(int(x['id'])) + '/statuses?per_page=20')
                        if status['error']:
                            raise RuntimeError(status['error'])
                        if status['data']:
                            s = status['data'][0]
                            items.append({'id': str(x['id']), 'state': s['state'], 'title': '公開 ' + x['sha'][:7], 'url': s.get('log_url') or s.get('environment_url') or ''})
                else:
                    query = 'repo:' + repo['name'] + ' is:open is:' + ('pr' if category == 'github_pr' else 'issue')
                    data = client.get('/search/issues?q=' + quote(query, safe='') + '&sort=created&order=desc&per_page=100')
                    if data['error'] or data['data'].get('incomplete_results'):
                        raise RuntimeError(data['error'] or 'GitHub検索結果が不完全です')
                    items = [{'id': str(x['number']), 'state': 'open', 'title': x['title'][:200], 'url': x['html_url']} for x in data['data']['items']]
                key = 'watch:' + repo['name'] + ':' + repo['branch'] + ':' + category
                with connect(db_path) as db:
                    db.execute('CREATE TABLE IF NOT EXISTS bot_watch_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL)')
                    db.execute('BEGIN IMMEDIATE')
                    old = db.execute('SELECT payload FROM bot_watch_state WHERE key=?', (key,)).fetchone()
                    previous = json.loads(old[0]) if old else None
                    current = {x['id']: x['state'] for x in items}
                    if previous is not None:
                        for item in reversed(items):
                            changed = previous.get(item['id']) != item['state']
                            interesting = item['state'] in ('failure', 'timed_out') if category == 'github_actions' else item['state'] == 'success' if category == 'github_deploy' else item['id'] not in previous
                            if changed and interesting:
                                abnormal = category == 'github_actions'
                                record('warning' if abnormal else 'info', category, repo['name'] + ': ' + item['title'], item['state'] + '\n' + item['url'], db=db, category=category)
                    db.execute('INSERT OR REPLACE INTO bot_watch_state(key,payload) VALUES(?,?)', (key, json.dumps(current)))
            except Exception as exc:
                failures.append(category + ': ' + type(exc).__name__)
                audit(db_path, 'error', 'system', category, False, 'GitHub通知確認失敗: ' + type(exc).__name__ + ' / ' + repo['name'])

        with connect(db_path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS bot_watch_state(key TEXT PRIMARY KEY,payload TEXT NOT NULL)')
            db.execute('BEGIN IMMEDIATE')
            key = 'github-health:' + repo['name']
            old = db.execute('SELECT payload FROM bot_watch_state WHERE key=?', (key,)).fetchone()
            was_failed = bool(json.loads(old[0])) if old else False
            is_failed = bool(failures)
            if is_failed != was_failed:
                record('warning' if is_failed else 'ok', 'github-monitor-health',
                       repo['name'] + (': GitHub監視処理に失敗しました' if is_failed else ': GitHub監視の取得・保存が復旧しました'),
                       '、'.join(failures) if failures else '有効な通知項目の確認処理が正常に完了しました。', db=db, category='ubuntu')
            db.execute('INSERT OR REPLACE INTO bot_watch_state(key,payload) VALUES(?,?)', (key, json.dumps(is_failed)))
