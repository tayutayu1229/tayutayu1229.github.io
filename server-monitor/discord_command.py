"""Fixed read-only command worker. Never accepts shell code or file paths."""
from contextlib import closing
import argparse
import json
import re
import sqlite3
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo
import monitor_service as monitor
from discord_command_config import audit, load
from github_operations import GitHub, render as github_render, jst

GUILD = '1489628881106243664'


def sanitize(text):
    text = monitor.redact_sensitive(str(text))
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----', '[PRIVATE_KEY_REDACTED]', text, flags=re.S)
    text = re.sub(r'\b(?:mfa\.[\w-]{20,}|[\w-]{23,28}\.[\w-]{6}\.[\w-]{20,})\b', '[TOKEN_REDACTED]', text)
    text = re.sub(r'\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b', '[GITHUB_TOKEN_REDACTED]', text)
    text = re.sub(r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b', '[JWT_REDACTED]', text)
    text = re.sub(r'(?i)(authorization\s*:\s*)(?:bearer|basic|bot)\s+[^\s,;]+', r'\1[REDACTED]', text)
    text = re.sub(r'(https?://)[^\s/@:]+:[^\s/@]+@', r'\1[CREDENTIALS_REDACTED]@', text)
    return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', text)


def snapshot():
    with closing(sqlite3.connect('file:' + str(monitor.DB_PATH) + '?mode=ro', uri=True)) as db:
        row = db.execute('SELECT payload FROM metrics ORDER BY collected_at DESC LIMIT 1').fetchone()
    if not row:
        raise ValueError('監視データがまだありません。収集開始後に再確認してください。')
    state = json.loads(row[0])
    age = time.time() - datetime.fromisoformat(state['collectedAt']).timestamp()
    return state, '取得 ' + jst(state['collectedAt']) + ('\n⚠ 監視データが3分以上古いため、現在の状態とは断定できません。' if age > 180 else '')


def permitted(config, command, actor, roles, channel, guild):
    if guild != GUILD or command not in config['commands']:
        return False
    policy = config['commands'][command]
    if not config['enabled'] or not policy['enabled'] or (command == 'logs' and not config['allowLogs']):
        return False
    individual = bool(policy['roleIds'] or policy['userIds'])
    allowed_roles = policy['roleIds'] if individual else config['allowedRoleIds']
    allowed_users = policy['userIds'] if individual else config['allowedUserIds']
    channels = policy['channelIds'] or config['allowedChannelIds']
    return channel in channels and (actor in allowed_users or bool(set(roles) & set(allowed_roles)))


def output(args, config):
    command = args.command
    if command == 'help':
        return ('/ubuntu status: Ubuntuの現在値\n/ubuntu services: サービスの稼働状態\n/ubuntu report: 定時報を現在の取得データで表示\n/ubuntu logs: 許可されたサービスの最近のログ\n/ubuntu events: 障害・復旧の履歴\n/ubuntu github: コミット・Actions・公開・PR・Issue・接続状態\n結果はこのチャンネルの閲覧者に表示されます。再起動等の操作は実行しません。')
    if command == 'github':
        repos = [x for x in config['repositories'] if x['enabled']]
        repo = next((x for x in repos if x['name'] == args.repository), None) if args.repository else (repos[0] if repos else None)
        if not repo:
            raise ValueError('有効な登録リポジトリを選択してください。')
        client = GitHub(monitor.DB_PATH)
        text = github_render(client, repo, args.view, args.page)
        return {'text': text, 'ok': not any(x['error'] for x in client.observations)}
    state, freshness = snapshot()
    if command == 'status':
        memory = state['memory']
        lines = ['Ubuntuサーバー: ' + {'ok': '正常', 'warning': '要確認', 'critical': '異常あり'}.get(state['status'], '未確認'), freshness,
                 'CPU ' + str(state['cpu']['usedPercent']) + '% / I/O待ち ' + str(state['cpu']['iowaitPercent']) + '%',
                 'メモリ ' + str(memory['usedPercent']) + '% / 使用 ' + f"{memory['usedBytes']/1024**3:.1f}" + 'GiB / 全体 ' + f"{memory['totalBytes']/1024**3:.1f}" + 'GiB',
                 '連続稼働 ' + str(int(state['uptimeSeconds'] // 3600)) + '時間']
        lines += [x['mount'] + ': 使用 ' + str(x.get('usedPercent', '?')) + '% / 空き ' + f"{x.get('freeBytes',0)/1024**3:.1f}" + 'GiB' for x in state['disks']]
        lines += ['• ' + x['message'] for x in state['alerts']]
        return '\n'.join(lines)
    if command == 'services':
        lines = ['サービス稼働状況', freshness]
        lines += ['• Docker ' + x.get('name', '?') + ': ' + ('稼働' if x.get('state') == 'running' else '停止・未確認') for x in state['docker']]
        lines += ['• PM2 ' + x.get('name', '?') + ': ' + ('稼働' if x.get('status') == 'online' else '停止・未確認') + ' / 再起動 ' + str(x.get('restarts', '?')) + '回' for x in state['pm2']]
        lines += ['• ' + x['name'] + ': ' + ('正常' if x['ok'] else '異常') + ' / HTTP ' + str(x.get('status', '?')) for x in state['endpoints']]
        return '\n'.join(lines)
    if command == 'report':
        now = datetime.fromisoformat(state['collectedAt']).astimezone(ZoneInfo('Asia/Tokyo'))
        return freshness + '\n' + monitor.build_server_report(state, now)
    if command == 'logs':
        if ':' not in args.target:
            raise ValueError('ログ対象を選択してください。')
        kind, target = args.target.split(':', 1)
        if not ((kind == 'docker' and target in monitor.DOCKER_NAMES) or (kind == 'pm2' and target in monitor.PM2_NAMES)):
            raise ValueError('このログ対象は許可されていません。')
        text = sanitize(monitor.service_logs(kind, target, 40))
        return '取得 ' + jst(datetime.now(ZoneInfo('Asia/Tokyo')).isoformat()) + '\n' + target + ' 最近のログ（最大40行・表示は末尾6000文字。ログ内の時刻は出力元の表記）\n' + text[-6000:].replace('```', '~~~')
    if command == 'events':
        with closing(sqlite3.connect('file:' + str(monitor.DB_PATH) + '?mode=ro', uri=True)) as db:
            rows = db.execute('SELECT created_at,severity,message FROM events ORDER BY id DESC LIMIT 15').fetchall()
        return '取得 ' + jst(datetime.now(ZoneInfo('Asia/Tokyo')).isoformat()) + '\n最近の障害・復旧\n' + ('\n'.join(jst(x[0]) + ' [' + x[1] + '] ' + x[2] for x in rows) or '記録はありません。')
    raise ValueError('未対応の確認コマンドです。')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['status', 'services', 'report', 'logs', 'github', 'events', 'help', 'denied'])
    for name in ('actor', 'channel', 'guild', 'roles', 'target', 'repository'):
        parser.add_argument('--' + name, default='')
    parser.add_argument('--view', choices=['summary', 'commits', 'actions', 'deploy', 'pulls', 'issues', 'connection'], default='summary')
    parser.add_argument('--page', type=int, default=1)
    args = parser.parse_args()
    if not 1 <= args.page <= 100:
        raise ValueError('ページ番号は1〜100で指定してください。')
    if args.command == 'denied':
        audit(monitor.DB_PATH, 'command', args.actor, 'denied', False, '権限・チャンネル・有効設定・クールダウンで拒否')
        print(json.dumps({'ok': True}))
        return
    try:
        config = load(monitor.DATA_DIR)
        if not permitted(config, args.command, args.actor, args.roles.split(','), args.channel, args.guild):
            raise ValueError('この場所・権限では実行できないか、機能が停止中です。')
        result = output(args, config)
        success = result.get('ok', False) if isinstance(result, dict) else True
        text = sanitize(result['text'] if isinstance(result, dict) else result)
        audit(monitor.DB_PATH, 'command' if success else 'error', args.actor, args.command, success, ('取得失敗を含みます / ' if not success else '') + 'チャンネル ' + args.channel + (' / ' + args.repository if args.repository else ''))
        print(json.dumps({'ok': success, 'text': text}, ensure_ascii=False))
    except Exception as exc:
        detail = sanitize(str(exc)) if isinstance(exc, (ValueError, RuntimeError)) else '取得に失敗しました: ' + type(exc).__name__
        audit(monitor.DB_PATH, 'error', args.actor, args.command, False, detail)
        print(json.dumps({'ok': False, 'text': detail}, ensure_ascii=False))


if __name__ == '__main__':
    main()
