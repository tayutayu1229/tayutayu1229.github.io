#!/usr/bin/env python3
"""ATOS在線の駅別遅延実績をSQLiteへ継続保存し、読み取りAPIで配信する。"""

from __future__ import annotations

import json
import logging
import os
import signal
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

JST = timezone(timedelta(hours=9))
ODPT_URL = os.environ.get(
    "ATOS_ODPT_URL",
    "https://tayunet-traininfo.com/api/odpt/challenge/odpt:Train?odpt:operator=odpt.Operator:JR-East",
)
DB_PATH = Path(os.environ.get("ATOS_HISTORY_DB", "/var/lib/atos-delay-history/history.sqlite3"))
HOST = os.environ.get("ATOS_HISTORY_HOST", "127.0.0.1")
PORT = int(os.environ.get("ATOS_HISTORY_PORT", "8787"))
INTERVAL = max(10, int(os.environ.get("ATOS_HISTORY_INTERVAL", "20")))
ALLOWED_ORIGINS = {
    value.strip()
    for value in os.environ.get(
        "ATOS_HISTORY_ALLOWED_ORIGINS",
        "https://tayunet-traininfo.com,https://www.tayunet-traininfo.com",
    ).split(",")
    if value.strip()
}

LOG = logging.getLogger("atos-delay-history")
STOP = threading.Event()
STATE = {"last_success": None, "last_error": None, "consecutive_failures": 0, "last_train_count": 0}


def service_date(now: datetime | None = None) -> str:
    current = now or datetime.now(JST)
    if current.hour < 4:
        current -= timedelta(days=1)
    return current.strftime("%Y-%m-%d")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def initialize_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as database:
        database.executescript(
            """
            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service_date TEXT NOT NULL,
                railway TEXT NOT NULL,
                train_number TEXT NOT NULL,
                station_id TEXT NOT NULL,
                phase TEXT NOT NULL CHECK (phase IN ('arrival', 'departure')),
                delay_seconds INTEGER NOT NULL CHECK (delay_seconds >= 0),
                from_station TEXT,
                to_station TEXT,
                observed_at TEXT NOT NULL,
                UNIQUE(service_date, railway, train_number, station_id, phase, delay_seconds)
            );
            CREATE INDEX IF NOT EXISTS idx_observations_train
                ON observations(service_date, railway, train_number, observed_at);
            CREATE INDEX IF NOT EXISTS idx_observations_station
                ON observations(service_date, station_id, observed_at);
            """
        )


def fetch_trains() -> list[dict]:
    # 公開プロキシは呼出元のacl:consumerKeyを必ず破棄して正規の秘密鍵へ差し替える。
    # その性質を使い、20秒単位の無害な値でCloudflareの60秒キャッシュだけを分離する。
    separator = "&" if "?" in ODPT_URL else "?"
    bucket = int(time.time() // INTERVAL)
    request_url = f"{ODPT_URL}{separator}acl:consumerKey=history-{bucket}"
    request = urllib.request.Request(request_url, headers={"Accept": "application/json", "User-Agent": "tayunet-atos-history/1.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f"ODPT HTTP {response.status}")
        data = json.load(response)
    if not isinstance(data, list):
        raise ValueError("ODPT列車データのルートが配列ではありません")
    return data


def store_snapshot(trains: list[dict]) -> int:
    now = datetime.now(JST)
    observed_at = now.isoformat(timespec="seconds")
    operating_date = service_date(now)
    rows: list[tuple] = []
    for train in trains:
        railway = str(train.get("odpt:railway") or "")
        train_number = str(train.get("odpt:trainNumber") or "")
        from_station = str(train.get("odpt:fromStation") or "")
        to_station = str(train.get("odpt:toStation") or "")
        if not railway or not train_number or not from_station:
            continue
        phase = "arrival" if not to_station or to_station == from_station else "departure"
        try:
            delay_seconds = max(0, int(train.get("odpt:delay") or 0))
        except (TypeError, ValueError):
            delay_seconds = 0
        rows.append((operating_date, railway, train_number, from_station, phase, delay_seconds, from_station, to_station or None, observed_at))

    with connect() as database:
        before = database.total_changes
        database.executemany(
            """
            INSERT OR IGNORE INTO observations
              (service_date, railway, train_number, station_id, phase, delay_seconds, from_station, to_station, observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        return database.total_changes - before


def collector_loop() -> None:
    while not STOP.is_set():
        started = time.monotonic()
        try:
            trains = fetch_trains()
            inserted = store_snapshot(trains)
            STATE.update(last_success=datetime.now(JST).isoformat(timespec="seconds"), last_error=None, consecutive_failures=0, last_train_count=len(trains))
            LOG.info("列車 %d件、実績 %d件を追加", len(trains), inserted)
        except Exception as error:  # noqa: BLE001 - daemon must keep collecting
            STATE["last_error"] = f"{type(error).__name__}: {error}"
            STATE["consecutive_failures"] += 1
            LOG.exception("在線データの収集に失敗")
        STOP.wait(max(1, INTERVAL - (time.monotonic() - started)))


def train_history(params: dict[str, list[str]]) -> dict:
    operating_date = (params.get("date") or [service_date()])[0]
    railway = (params.get("railway") or [""])[0]
    train_number = (params.get("trainNumber") or [""])[0]
    if not railway or not train_number:
        raise ValueError("railway と trainNumber は必須です")
    with connect() as database:
        rows = database.execute(
            """
            SELECT station_id, phase, delay_seconds, observed_at
            FROM observations
            WHERE service_date = ? AND railway = ? AND train_number = ?
            ORDER BY observed_at ASC, id ASC
            """,
            (operating_date, railway, train_number),
        ).fetchall()
    stations: dict[str, dict] = {}
    for row in rows:
        current = stations.setdefault(row["station_id"], {"arrival": None, "departure": None})
        item = {"delaySeconds": row["delay_seconds"], "observedAt": row["observed_at"]}
        current[row["phase"]] = item
        current["delaySeconds"] = row["delay_seconds"]
        current["phase"] = row["phase"]
        current["observedAt"] = row["observed_at"]
    return {
        "serviceDate": operating_date,
        "railway": railway,
        "trainNumber": train_number,
        "stations": stations,
        "count": len(rows),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "TayunetAtosHistory/1.0"

    def _origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_ORIGINS else None

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self._origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/health":
                with connect() as database:
                    count = database.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
                self._send_json(200, {"ok": STATE["consecutive_failures"] == 0, **STATE, "observation_count": count})
                return
            if parsed.path == "/api/v1/train-history":
                self._send_json(200, train_history(urllib.parse.parse_qs(parsed.query)))
                return
            self._send_json(404, {"error": "not_found"})
        except ValueError as error:
            self._send_json(400, {"error": "invalid_request", "message": str(error)})
        except Exception as error:  # noqa: BLE001
            LOG.exception("API処理に失敗")
            self._send_json(500, {"error": "internal_error", "message": str(error)})

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        origin = self._origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def log_message(self, message: str, *args: object) -> None:
        LOG.info("API %s - %s", self.address_string(), message % args)


def stop_service(*_: object) -> None:
    STOP.set()


def main() -> None:
    logging.basicConfig(level=os.environ.get("ATOS_HISTORY_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    initialize_database()
    signal.signal(signal.SIGTERM, stop_service)
    signal.signal(signal.SIGINT, stop_service)
    collector = threading.Thread(target=collector_loop, name="odpt-collector", daemon=True)
    collector.start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.timeout = 1
    LOG.info("APIを http://%s:%d で開始、DB=%s", HOST, PORT, DB_PATH)
    try:
        while not STOP.is_set():
            server.handle_request()
    finally:
        server.server_close()
        STOP.set()
        collector.join(timeout=5)


if __name__ == "__main__":
    main()
