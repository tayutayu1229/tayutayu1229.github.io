"""Public JR Freight snapshots collected independently of GitHub scheduling."""
from __future__ import annotations

import json
import logging
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

LOG = logging.getLogger(__name__)


def utcnow():
    return datetime.now(timezone.utc).isoformat()


class FreightFeed:
    def __init__(self, directory: Path, python: str, scraper: str, interval=420):
        self.directory = directory
        self.python = python
        self.scraper = scraper
        self.interval = max(300, int(interval))
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.run_lock = threading.Lock()
        self.stop = threading.Event()
        self.bundle = self.read('live-bundle.json', {'data': None, 'health': {'ok': False, 'error': '取得準備中'}})

    def read(self, name, default=None):
        try:
            return json.loads((self.directory / name).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return default

    def snapshot(self):
        with self.lock:
            # Requests never trigger scraping or read partially written files.
            return json.loads(json.dumps(self.bundle))

    def collect(self):
        if not self.run_lock.acquire(blocking=False):
            return False
        started = utcnow()
        previous = self.snapshot()
        data = previous.get('data')
        try:
            command = [self.python, self.scraper, '--output', str(self.directory / 'index.html'),
                       '--json-output', str(self.directory / 'freight-status.json'),
                       '--health-output', str(self.directory / 'fetch-health.json')]
            completed = subprocess.run(command, capture_output=True, text=True, timeout=140)
            health = self.read('fetch-health.json')
            if not isinstance(health, dict) or health.get('checkedAt') == previous.get('health', {}).get('checkedAt'):
                raise RuntimeError('collector_did_not_update_health')
            if completed.returncode and health.get('ok'):
                raise RuntimeError('collector_failed')
            candidate = self.read('freight-status.json')
            if candidate is not None:
                if not isinstance(candidate, dict) or not candidate.get('ok') or not all(isinstance(candidate.get(key), list) for key in ('trains', 'routes', 'incidents')):
                    raise ValueError('invalid_freight_snapshot')
                data = candidate
            bundle = {'data': data, 'health': health}
        except Exception as error:
            LOG.warning('Freight collection failed: %s', type(error).__name__)
            bundle = {'data': data, 'health': {'ok': False, 'available': False, 'checkedAt': started,
                      'lastSuccessAt': previous.get('health', {}).get('lastSuccessAt'),
                      'error': '定期取得処理に失敗しました（' + type(error).__name__ + '）'}}
        try:
            bundle['collector'] = {'intervalSeconds': self.interval,
                                   'nextCheckAt': (datetime.fromisoformat(started) + timedelta(seconds=self.interval)).isoformat()}
            temporary = self.directory / 'live-bundle.json.tmp'
            temporary.write_text(json.dumps(bundle, ensure_ascii=False), encoding='utf-8')
            temporary.replace(self.directory / 'live-bundle.json')
            with self.lock:
                self.bundle = bundle
            return True
        finally:
            self.run_lock.release()

    def loop(self):
        while not self.stop.is_set():
            deadline = time.monotonic() + self.interval
            try:
                self.collect()
            except Exception:
                LOG.exception('Could not persist freight snapshot')
            self.stop.wait(max(0, deadline - time.monotonic()))


def from_config(path: Path):
    if not path.exists():
        return None
    config = json.loads(path.read_text(encoding='utf-8'))
    return FreightFeed(Path(config['directory']), config['python'], config['scraper'], config.get('intervalSeconds', 420))
