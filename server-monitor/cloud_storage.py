"""Read Drive quota with the existing backup identity; never mutate storage."""
from datetime import datetime, timezone
import json
import subprocess
import time

_cached = None
_checked = 0.0


def cloud_storage_status():
    global _cached, _checked
    ttl = 600 if _cached and _cached.get('available') else 300
    if _cached is not None and time.monotonic() - _checked < ttl:
        return _cached
    result = {'configured': True, 'available': False,
              'checkedAt': datetime.now(timezone.utc).isoformat()}
    try:
        completed = subprocess.run([
            '/home/yoshi/.local/bin/rclone', '--config', '/home/yoshi/.config/rclone/rclone.conf',
            'about', 'tayunet-drive:', '--json'], capture_output=True, text=True, timeout=15, check=True)
        data = json.loads(completed.stdout)
        if not isinstance(data, dict) or any(type(data.get(k)) is not int for k in ('total', 'used', 'free')):
            raise ValueError('invalid quota fields')
        if data['total'] <= 0 or data['used'] < 0:
            raise ValueError('invalid quota values')
        result.update(available=True, totalBytes=data['total'], usedBytes=data['used'], freeBytes=data['free'],
                      usedPercent=round(data['used'] / data['total'] * 100, 1))
    except (OSError, ValueError, subprocess.SubprocessError):
        result['detail'] = 'Google Driveの空き容量を確認できません。保存先への接続設定・アクセス権を確認してください。バックアップの成否は別に表示します。'
    _cached, _checked = result, time.monotonic()
    return result


def cloud_storage_alerts(storage):
    if not storage or not storage.get('configured'):
        return []
    if not storage.get('available'):
        return [{'code': 'cloud-quota-check', 'severity': 'warning',
                 'message': 'Google Driveの空き容量を確認できません。接続設定を確認してください。'}]
    free, total = storage['freeBytes'], storage['totalBytes']
    level = ('critical' if free <= max(512 * 1024**2, total * 0.05) else
             'warning' if free <= max(2 * 1024**3, total * 0.20) else None)
    if not level:
        return []
    return [{'code': 'cloud-quota', 'severity': level,
             'message': f'Google Driveの空き容量が不足しています（残り {max(0, free) / 1024**3:.1f}GiB）。保存対象・保持世代を確認してください。'}]
