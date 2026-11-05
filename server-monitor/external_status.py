"""Read official service status, keeping provider reports separate from local impact."""
import json
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen

SOURCES = (
    ('discord', 'Discord', 'https://discordstatus.com'),
    ('github', 'GitHub', 'https://www.githubstatus.com'),
    ('cloudflare', 'Cloudflare', 'https://www.cloudflarestatus.com'),
    ('supabase', 'Supabase', 'https://status.supabase.com'),
)
_cached = None
_checked = 0.0

def provider_status():
    global _cached, _checked
    if _cached is not None and time.monotonic() - _checked < 300:
        return _cached
    results = []
    for key, name, base in SOURCES:
        item = {'id': key, 'name': name, 'source': base, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'impact': '本システムへの影響は外形監視で別途確認'}
        try:
            req = Request(base + '/api/v2/summary.json', headers={'User-Agent': 'TayunetMonitor/1.0'})
            with urlopen(req, timeout=8) as response:
                data = json.loads(response.read(2_000_000))
            incidents = data.get('incidents', [])
            item.update({'available': True, 'indicator': data['status']['indicator'], 'description': data['status']['description'],
                         'incidents': [{'id': x['id'], 'name': x['name'], 'status': x['status'], 'url': x.get('shortlink', base), 'updatedAt': x.get('updated_at')} for x in incidents],
                         'maintenance': [{'id': x['id'], 'name': x['name'], 'status': x['status'], 'startsAt': x.get('scheduled_for'), 'endsAt': x.get('scheduled_until')} for x in data.get('scheduled_maintenances', [])]})
        except Exception as error:
            item.update({'available': False, 'indicator': 'unknown', 'description': '公式情報取得失敗: ' + type(error).__name__, 'incidents': [], 'maintenance': []})
        upcoming = []
        for maintenance in item.get('maintenance', []):
            try:
                stamp = maintenance.get('endsAt') or maintenance.get('startsAt')
                if stamp and datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() >= time.time():
                    upcoming.append(maintenance)
                elif maintenance.get('status') in ('in_progress', 'verifying'):
                    upcoming.append(maintenance)
            except (TypeError, ValueError):
                continue
        item['maintenance'] = upcoming
        item['description'] = ('公式の稼働情報を取得できません。サービスの障害かどうかは未確認です。' if not item.get('available') else '公式発表では通常稼働です。' if item['indicator'] == 'none' else '保守作業が報告されています。対象機能・時刻を確認してください。' if item['indicator'] == 'maintenance' else '公式に障害が報告されています。対象機能・地域を確認してください。')
        results.append(item)
    results.extend(google_status())
    _cached, _checked = results, time.monotonic()
    return results

def notify_changes(providers, data_dir, send):
    """Persist only delivered states; retry delivery failures on the next collection."""
    path = data_dir / 'external-notification-state.json'
    try:
        previous = json.loads(path.read_text())
    except (OSError, ValueError):
        previous = {}
    for item in providers:
        if not item['available']:
            continue
        key = item['id']
        current = {'indicator': item['indicator'], 'incidents': {x['id']: x['status'] for x in item['incidents']}}
        old = previous.get(key)
        # An initial healthy observation is not an event.
        if old == current or (old is None and current['indicator'] == 'none' and not current['incidents']):
            previous[key] = current
            continue
        recovered = current['indicator'] == 'none' and not current['incidents']
        abnormal = current['indicator'] in ('minor', 'major', 'critical') or bool(current['incidents'])
        lines = [item['name'] + ': ' + item['description'], item['impact'], item['source']]
        lines.extend(x['name'] + ' (' + x['status'] + ')' for x in item['incidents'][:5])
        if send('外部サービス ' + ('復旧情報' if recovered else '障害・更新情報' if abnormal else '保守・稼働情報'), '\n'.join(lines), 'ok' if recovered else 'warning' if abnormal else 'info', mention=abnormal):
            previous[key] = current
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(previous, ensure_ascii=False))
    temporary.replace(path)

_security_cache = None
_security_checked = 0.0

def security_updates():
    """Use installed Ubuntu tooling; report unavailable and index age explicitly."""
    global _security_cache, _security_checked
    if _security_cache is not None and time.monotonic() - _security_checked < 3600:
        return _security_cache
    import subprocess
    from pathlib import Path
    result = {'available': False, 'checkedAt': datetime.now(timezone.utc).isoformat(),
              'source': 'Ubuntu apt-check / ローカルAPT索引', 'rebootRequired': Path('/var/run/reboot-required').exists()}
    try:
        check = subprocess.run(['/usr/lib/update-notifier/apt-check'], capture_output=True, text=True, timeout=45, check=True)
        counts = (check.stdout + check.stderr).strip().split(';')
        result.update(available=True, total=int(counts[0]), security=int(counts[1]))
        indexes = [p.stat().st_mtime for p in Path('/var/lib/apt/lists').glob('*InRelease')]
        result['indexUpdatedAt'] = datetime.fromtimestamp(max(indexes), timezone.utc).isoformat() if indexes else None
    except (OSError, ValueError, subprocess.SubprocessError):
        result['detail'] = '更新情報を取得できませんでした。正常とは判定していません。'
    _security_cache, _security_checked = result, time.monotonic()
    return result


def google_status():
    sources = (
        ('google-workspace', 'Google Drive / Sheets', 'https://www.google.com/appsstatus/dashboard/', ('drive', 'sheets')),
        ('firebase', 'Firebase Auth / Firestore', 'https://status.firebase.google.com/', ('authentication', 'firestore')),
    )
    results = []
    for key, name, base, products in sources:
        item = {'id': key, 'name': name, 'source': base, 'checkedAt': datetime.now(timezone.utc).isoformat(),
                'impact': '対象サービスの公式発表。本システムへの影響は別途確認', 'incidents': [], 'maintenance': []}
        try:
            request = Request(base + 'incidents.json', headers={'User-Agent': 'TayunetMonitor/1.0'})
            with urlopen(request, timeout=8) as response:
                rows = json.loads(response.read(4_000_000))
            for row in rows:
                names = [row.get('service_name', '')] + [x.get('title', '') for x in row.get('affected_products', [])]
                if not any(product in title.casefold() for title in names for product in products):
                    continue
                end, begin = row.get('end'), row.get('begin')
                if end and datetime.fromisoformat(end.replace('Z', '+00:00')).timestamp() <= time.time():
                    continue
                if begin and datetime.fromisoformat(begin.replace('Z', '+00:00')).timestamp() > time.time():
                    continue
                item['incidents'].append({'id': row['id'], 'name': (row.get('external_desc') or ', '.join(names))[:500],
                                          'status': row.get('most_recent_update', {}).get('status', 'reported'),
                                          'url': base + row.get('uri', ''), 'updatedAt': row.get('modified')})
            item.update(available=True, indicator='minor' if item['incidents'] else 'none',
                        description='対象サービスの継続障害あり' if item['incidents'] else '対象サービスの継続障害の発表なし')
        except Exception as error:
            item.update(available=False, indicator='unknown', description='公式情報取得失敗: ' + type(error).__name__)
        item['description'] = ('公式の稼働情報を取得できません。サービスの障害かどうかは未確認です。' if not item.get('available') else '公式発表では通常稼働です。' if item['indicator'] == 'none' else '保守作業が報告されています。対象機能・時刻を確認してください。' if item['indicator'] == 'maintenance' else '公式に障害が報告されています。対象機能・地域を確認してください。')
        results.append(item)
    return results
