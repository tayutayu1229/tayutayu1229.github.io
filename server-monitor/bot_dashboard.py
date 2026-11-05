"""Dashboard runtime facts; unavailable facts remain explicitly unknown."""
from contextlib import closing
import json
import os
import platform
import time
from pathlib import Path
from discord_command_config import connect, history, load, stamp


def runtime(directory, snapshot=None):
    result = {'available': False, 'online': False, 'state': 'unknown', 'detail': 'Botの稼働情報はまだ取得されていません。'}
    try:
        data = json.loads((directory / 'discord-bot-heartbeat.json').read_text())
        from datetime import datetime
        age = time.time() - datetime.fromisoformat(data['heartbeatAt']).timestamp()
        result.update(data, available=True, online=bool(data['ready'] is True and -10 <= age <= 90), ageSeconds=round(age))
        result['state'] = 'ok' if result['online'] else 'critical'
        result['detail'] = 'Discordへ接続中' if result['online'] else '応答が古いか、Discordへ未接続です。'
        if data.get('configError'):
            result.update(state='warning', detail='Botの設定読込に失敗しています。')
    except (OSError, ValueError, TypeError, KeyError):
        pass
    process = next((x for x in (snapshot or {}).get('pm2', []) if x.get('name') == 'tokyo-discord-bot'), None)
    if process:
        result['process'] = process
        if process.get('status') != 'online':
            result.update(online=False, state='critical', detail='Botプロセスが停止しています。')
    logs = []
    for label, name in [('標準出力', '/home/yoshi/.pm2/logs/tokyo-discord-bot-out.log'), ('標準エラー', '/home/yoshi/.pm2/logs/tokyo-discord-bot-error.log')]:
        p = Path(name)
        try:
            logs.append({'name': label, 'bytes': p.stat().st_size, 'available': True})
        except OSError:
            logs.append({'name': label, 'bytes': None, 'available': False})
    result['logFiles'] = logs
    try:
        result['os'] = platform.freedesktop_os_release().get('PRETTY_NAME', platform.system()) + ' / ' + platform.release()
    except (AttributeError, OSError):
        result['os'] = platform.platform()
    return result


def overview(directory, db_path, snapshot):
    config = load(directory)
    bot = runtime(directory, snapshot)
    with connect(db_path) as db:
        caches = [dict(x) for x in db.execute('SELECT fetched_at,last_attempt,error,metadata FROM bot_cache ORDER BY last_attempt DESC LIMIT 30')]
    for item in caches:
        item['metadata'] = json.loads(item['metadata'])
    with connect(db_path) as db:
        monitor_events = [dict(x) for x in db.execute('SELECT created_at,severity,code,message FROM events ORDER BY id DESC LIMIT 30')]
        actions = [dict(x) for x in db.execute("SELECT created_at,actor,success FROM actions WHERE target='tokyo-discord-bot' ORDER BY id DESC LIMIT 10")]
    bot['restartReason'] = '未確認（再起動の原因を確定できる記録なし）'
    if bot.get('startedAt'):
        from datetime import datetime
        started = datetime.fromisoformat(bot['startedAt']).timestamp()
        for action in actions:
            if action['success'] and abs(datetime.fromisoformat(action['created_at']).timestamp() - started) < 180:
                bot['restartReason'] = ('自動復旧による再起動' if action['actor'] == 'system:auto-recovery' else '管理画面からの手動再起動')
                break
    return {'serverTime': stamp(), 'monitorEvents': monitor_events, 'config': config, 'runtime': bot, 'server': snapshot, 'githubConnections': caches,
            'history': history(db_path), 'applied': bool(bot.get('online') and not bot.get('configError') and bot.get('configRevision') == config['revision']),
            'githubTokenConfigured': bool(os.environ.get('TAYUNET_GITHUB_TOKEN'))}


def resources(db_path, period):
    import sqlite3
    from datetime import datetime, timezone, timedelta
    if period not in ('1h', '24h'):
        raise ValueError('表示期間は1hまたは24hを指定してください。')
    with closing(sqlite3.connect('file:' + str(db_path) + '?mode=ro', uri=True)) as db:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=1 if period == '1h' else 24)).isoformat()
        rows = db.execute("SELECT bucket,payload FROM rollups WHERE granularity='5m' AND bucket>=? ORDER BY bucket DESC LIMIT ?", (cutoff,13 if period == '1h' else 289)).fetchall()
    points = []
    invalid = 0
    for at, payload in reversed(rows):
        try:
            item = json.loads(payload)
            points.append({'at': at, 'cpu': item.get('cpu', {}).get('usedPercent'), 'memory': item.get('memory', {}).get('usedPercent'), 'botRss': item.get('botRuntime', {}).get('memory', {}).get('rss')})
        except (ValueError, TypeError, AttributeError):
            invalid += 1
    return {'points': points, 'invalid': invalid, 'period': period}
