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
from collections import defaultdict
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
INTERVAL = max(1, int(os.environ.get("ATOS_HISTORY_INTERVAL", "3")))
RETENTION_DAYS = max(1, min(366, int(os.environ.get("ATOS_HISTORY_RETENTION_DAYS", "30"))))
MAX_STORAGE_GB = max(1, int(os.environ.get("ATOS_HISTORY_MAX_STORAGE_GB", "230")))
MAX_STORAGE_BYTES = MAX_STORAGE_GB * 1024**3
STORAGE_TRIGGER_RATIO = 0.95
STORAGE_TARGET_RATIO = 0.90
STORAGE_CHECK_SECONDS = 60
STORAGE_DELETE_BATCH = 250_000
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
STATE = {
    "last_success": None,
    "last_error": None,
    "consecutive_failures": 0,
    "last_train_count": 0,
    "last_cleanup": None,
    "deleted_observations": 0,
    "last_storage_check": None,
    "last_storage_cleanup": None,
    "storage_deleted_observations": 0,
}
LAST_STORAGE_CHECK_MONOTONIC = 0.0


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
                destination_station TEXT,
                observed_at TEXT NOT NULL,
                UNIQUE(service_date, railway, train_number, station_id, phase, delay_seconds)
            );
            CREATE INDEX IF NOT EXISTS idx_observations_train
                ON observations(service_date, railway, train_number, observed_at);
            CREATE INDEX IF NOT EXISTS idx_observations_station
                ON observations(service_date, station_id, observed_at);
            CREATE INDEX IF NOT EXISTS idx_observations_number
                ON observations(service_date, train_number, observed_at);
            CREATE INDEX IF NOT EXISTS idx_observations_date
                ON observations(service_date);
            CREATE INDEX IF NOT EXISTS idx_observations_history_lookup
                ON observations(train_number, railway, service_date, station_id, observed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_observations_statistics
                ON observations(service_date, train_number, railway, station_id, observed_at DESC);
            CREATE TABLE IF NOT EXISTS latest_observations (
                service_date TEXT NOT NULL,
                railway TEXT NOT NULL,
                train_number TEXT NOT NULL,
                station_id TEXT NOT NULL,
                phase TEXT NOT NULL CHECK (phase IN ('arrival', 'departure')),
                delay_seconds INTEGER NOT NULL CHECK (delay_seconds >= 0),
                from_station TEXT,
                to_station TEXT,
                destination_station TEXT,
                observed_at TEXT NOT NULL,
                PRIMARY KEY (service_date, railway, train_number, station_id)
            );
            CREATE INDEX IF NOT EXISTS idx_latest_observations_date
                ON latest_observations(service_date, train_number, observed_at);
            """
        )
        columns = {row["name"] for row in database.execute("PRAGMA table_info(observations)")}
        if "destination_station" not in columns:
            database.execute("ALTER TABLE observations ADD COLUMN destination_station TEXT")


def cleanup_old_observations(force: bool = False) -> int:
    """30日分だけを残す。通常は運転日が変わった時に一度だけ実行する。"""
    today = service_date()
    if not force and STATE["last_cleanup"] == today:
        return 0
    cutoff = (datetime.now(JST) - timedelta(days=RETENTION_DAYS - 1)).strftime("%Y-%m-%d")
    with connect() as database:
        before = database.total_changes
        database.execute("DELETE FROM observations WHERE service_date < ?", (cutoff,))
        deleted = database.total_changes - before
        database.execute("DELETE FROM latest_observations WHERE service_date < ?", (cutoff,))
    STATE["last_cleanup"] = today
    STATE["deleted_observations"] = deleted
    if deleted:
        LOG.info("保存期限を過ぎた実績 %d件を削除（保持 %d日、基準日 %s）", deleted, RETENTION_DAYS, cutoff)
    return deleted


def storage_status(database: sqlite3.Connection | None = None) -> dict:
    """Return physical folder usage and SQLite's reusable-page-aware usage."""
    owns_connection = database is None
    connection = database or connect()
    try:
        page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
        page_count = int(connection.execute("PRAGMA page_count").fetchone()[0])
        free_pages = int(connection.execute("PRAGMA freelist_count").fetchone()[0])
    finally:
        if owns_connection:
            connection.close()

    database_bytes = DB_PATH.stat().st_size if DB_PATH.exists() else 0
    folder_bytes = sum(
        path.stat().st_size
        for path in DB_PATH.parent.iterdir()
        if path.is_file()
    )
    reusable_bytes = free_pages * page_size
    effective_bytes = max(0, folder_bytes - min(database_bytes, reusable_bytes))
    return {
        "folderBytes": folder_bytes,
        "databaseBytes": database_bytes,
        "reusableBytes": reusable_bytes,
        "effectiveBytes": effective_bytes,
        "maxBytes": MAX_STORAGE_BYTES,
        "maxGigabytes": MAX_STORAGE_GB,
        "triggerBytes": int(MAX_STORAGE_BYTES * STORAGE_TRIGGER_RATIO),
        "targetBytes": int(MAX_STORAGE_BYTES * STORAGE_TARGET_RATIO),
        "usagePercent": round(folder_bytes / MAX_STORAGE_BYTES * 100, 2),
        "effectiveUsagePercent": round(effective_bytes / MAX_STORAGE_BYTES * 100, 2),
    }


def cleanup_storage_limit(force: bool = False) -> int:
    """Keep effective storage below the configured cap by pruning oldest rows."""
    global LAST_STORAGE_CHECK_MONOTONIC
    checked_at = time.monotonic()
    if not force and checked_at - LAST_STORAGE_CHECK_MONOTONIC < STORAGE_CHECK_SECONDS:
        return 0
    LAST_STORAGE_CHECK_MONOTONIC = checked_at
    STATE["last_storage_check"] = datetime.now(JST).isoformat(timespec="seconds")

    current = storage_status()
    if current["effectiveBytes"] < current["triggerBytes"]:
        return 0

    deleted = 0
    with connect() as database:
        while current["effectiveBytes"] > current["targetBytes"]:
            before = database.total_changes
            database.execute(
                """
                DELETE FROM observations
                WHERE id IN (
                    SELECT id FROM observations
                    ORDER BY service_date ASC, id ASC
                    LIMIT ?
                )
                """,
                (STORAGE_DELETE_BATCH,),
            )
            batch_deleted = database.total_changes - before
            database.commit()
            if not batch_deleted:
                break
            deleted += batch_deleted
            oldest_remaining = database.execute(
                "SELECT service_date FROM observations ORDER BY service_date ASC LIMIT 1"
            ).fetchone()
            if oldest_remaining:
                database.execute(
                    "DELETE FROM latest_observations WHERE service_date < ?",
                    (oldest_remaining[0],),
                )
            database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            current = storage_status(database)

    if deleted:
        STATE["last_storage_cleanup"] = datetime.now(JST).isoformat(timespec="seconds")
        STATE["storage_deleted_observations"] += deleted
        LOG.warning(
            "保存容量の上限に近づいたため古い実績 %d件を削除（上限 %dGB、実効使用率 %.2f%%）",
            deleted,
            MAX_STORAGE_GB,
            current["effectiveUsagePercent"],
        )
    return deleted


def fetch_trains() -> list[dict]:
    # 公開プロキシは呼出元のacl:consumerKeyを必ず破棄して正規の秘密鍵へ差し替える。
    # その性質を使い、収集間隔単位の無害な値でCloudflareキャッシュを分離する。
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


def source_observed_at(train: dict, fallback: datetime) -> str:
    """Prefer the ODPT snapshot timestamp so collector/network latency is not shown as train delay."""
    raw_value = str(train.get("dc:date") or "").strip()
    if raw_value:
        try:
            parsed = datetime.fromisoformat(raw_value.replace("Z", "+00:00")).astimezone(JST)
            if abs((fallback - parsed).total_seconds()) <= 10 * 60:
                return parsed.isoformat(timespec="seconds")
        except ValueError:
            pass
    return fallback.isoformat(timespec="seconds")


def store_snapshot(trains: list[dict]) -> int:
    now = datetime.now(JST)
    operating_date = service_date(now)
    rows: list[tuple] = []
    for train in trains:
        railway = str(train.get("odpt:railway") or "")
        train_number = str(train.get("odpt:trainNumber") or "")
        from_station = str(train.get("odpt:fromStation") or "")
        to_station = str(train.get("odpt:toStation") or "")
        destinations = train.get("odpt:destinationStation") or []
        destination_station = str(destinations[0] if isinstance(destinations, list) and destinations else "")
        if not railway or not train_number or not from_station:
            continue
        phase = "arrival" if not to_station or to_station == from_station else "departure"
        try:
            delay_seconds = max(0, int(train.get("odpt:delay") or 0))
        except (TypeError, ValueError):
            delay_seconds = 0
        rows.append((operating_date, railway, train_number, from_station, phase, delay_seconds, from_station, to_station or None, destination_station or None, source_observed_at(train, now)))

    with connect() as database:
        before = database.total_changes
        database.executemany(
            """
            INSERT OR IGNORE INTO observations
              (service_date, railway, train_number, station_id, phase, delay_seconds, from_station, to_station, destination_station, observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(service_date, railway, train_number, station_id, phase, delay_seconds)
            DO UPDATE SET
              from_station = excluded.from_station,
              to_station = excluded.to_station,
              destination_station = excluded.destination_station
            WHERE COALESCE(observations.from_station, '') <> COALESCE(excluded.from_station, '')
               OR COALESCE(observations.to_station, '') <> COALESCE(excluded.to_station, '')
               OR COALESCE(observations.destination_station, '') <> COALESCE(excluded.destination_station, '')
            """,
            rows,
        )
        database.executemany(
            """
            INSERT INTO latest_observations
              (service_date, railway, train_number, station_id, phase, delay_seconds, from_station, to_station, destination_station, observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(service_date, railway, train_number, station_id)
            DO UPDATE SET
              phase = excluded.phase,
              delay_seconds = excluded.delay_seconds,
              from_station = excluded.from_station,
              to_station = excluded.to_station,
              destination_station = excluded.destination_station,
              observed_at = excluded.observed_at
            WHERE latest_observations.phase <> excluded.phase
               OR latest_observations.delay_seconds <> excluded.delay_seconds
               OR COALESCE(latest_observations.from_station, '') <> COALESCE(excluded.from_station, '')
               OR COALESCE(latest_observations.to_station, '') <> COALESCE(excluded.to_station, '')
               OR COALESCE(latest_observations.destination_station, '') <> COALESCE(excluded.destination_station, '')
            """,
            rows,
        )
        inserted = database.total_changes - before
    cleanup_old_observations()
    cleanup_storage_limit()
    return inserted


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
    if not train_number:
        raise ValueError("trainNumber は必須です")
    requested_railways = list(dict.fromkeys([value for value in [railway, *(params.get("relatedRailway") or [])] if value]))
    where = "service_date = ? AND train_number = ?"
    values: list[str] = [operating_date, train_number]
    if requested_railways:
        where += f" AND railway IN ({','.join('?' for _ in requested_railways)})"
        values.extend(requested_railways)
    with connect() as database:
        rows = database.execute(
            f"""
            SELECT railway, station_id, phase, delay_seconds, observed_at
            FROM observations
            WHERE {where}
            ORDER BY observed_at ASC, id ASC
            """,
            values,
        ).fetchall()
        prediction_where = "train_number = ? AND service_date < ? AND service_date >= ?"
        prediction_values: list[str] = [
            train_number,
            operating_date,
            (datetime.strptime(operating_date, "%Y-%m-%d") - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d"),
        ]
        if requested_railways:
            prediction_where += f" AND railway IN ({','.join('?' for _ in requested_railways)})"
            prediction_values.extend(requested_railways)
        prediction_rows = database.execute(
            f"""
            WITH ranked AS (
              SELECT service_date, railway, station_id, delay_seconds, observed_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY service_date, railway, train_number, station_id
                       ORDER BY observed_at DESC, id DESC
                     ) AS row_number
              FROM observations
              WHERE {prediction_where}
            )
            SELECT service_date, railway, station_id, delay_seconds, observed_at
            FROM ranked
            WHERE row_number = 1
            ORDER BY service_date, observed_at
            """,
            prediction_values,
        ).fetchall()
    stations: dict[str, dict] = {}
    railways: set[str] = set()
    for row in rows:
        railways.add(row["railway"])
        current = stations.setdefault(row["station_id"], {"arrival": None, "departure": None})
        item = {"delaySeconds": row["delay_seconds"], "observedAt": row["observed_at"], "railway": row["railway"]}
        current[row["phase"]] = item
        current["delaySeconds"] = row["delay_seconds"]
        current["phase"] = row["phase"]
        current["observedAt"] = row["observed_at"]
        current["railway"] = row["railway"]
    prediction_totals: dict[str, dict] = defaultdict(
        lambda: {"delayTotal": 0, "samples": 0, "days": set(), "changeTotal": 0, "changeSamples": 0}
    )
    previous_prediction: dict[tuple[str, str], sqlite3.Row] = {}
    for row in prediction_rows:
        bucket = prediction_totals[row["station_id"]]
        bucket["delayTotal"] += int(row["delay_seconds"])
        bucket["samples"] += 1
        bucket["days"].add(row["service_date"])
        previous_key = (row["service_date"], row["railway"])
        previous = previous_prediction.get(previous_key)
        if previous and previous["station_id"] != row["station_id"]:
            bucket["changeTotal"] += int(row["delay_seconds"]) - int(previous["delay_seconds"])
            bucket["changeSamples"] += 1
        previous_prediction[previous_key] = row
    predictions = {
        station_id: {
            "expectedDelaySeconds": round(value["delayTotal"] / value["samples"]),
            "expectedChangeSeconds": round(value["changeTotal"] / value["changeSamples"]) if value["changeSamples"] else 0,
            "sampleDays": len(value["days"]),
            "changeSamples": value["changeSamples"],
        }
        for station_id, value in prediction_totals.items()
    }
    return {
        "serviceDate": operating_date,
        "railway": railway,
        "trainNumber": train_number,
        "railways": sorted(railways),
        "stations": stations,
        "predictions": predictions,
        "count": len(rows),
    }


def statistics(params: dict[str, list[str]]) -> dict:
    try:
        days = max(1, min(RETENTION_DAYS, int((params.get("days") or [str(RETENTION_DAYS)])[0])))
    except ValueError as error:
        raise ValueError("days は整数で指定してください") from error
    cutoff = (datetime.now(JST) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with connect() as database:
        rows = database.execute(
            """
            SELECT service_date, railway, train_number, station_id, phase, delay_seconds, destination_station, observed_at
            FROM latest_observations
            WHERE service_date >= ?
            ORDER BY service_date, train_number, observed_at
            """,
            (cutoff,),
        ).fetchall()
        total_observations = database.execute(
            "SELECT COUNT(*) FROM latest_observations WHERE service_date >= ?", (cutoff,)
        ).fetchone()[0]

    station_stats: dict[tuple[str, str], dict] = defaultdict(lambda: {"samples": 0, "delayTotal": 0, "maxDelay": 0, "changeTotal": 0, "changes": 0, "increases": 0, "recoveries": 0})
    train_stats: dict[tuple[str, str], dict] = defaultdict(lambda: {"samples": 0, "delayed": 0, "delayTotal": 0, "maxDelay": 0, "days": set()})
    weekday_stats: dict[int, dict] = defaultdict(lambda: {"samples": 0, "delayed": 0, "maxDelay": 0})
    hour_stats: dict[int, dict] = defaultdict(lambda: {"samples": 0, "delayed": 0, "maxDelay": 0})
    daily_stats: dict[str, dict] = defaultdict(lambda: {"samples": 0, "onTime": 0, "maxDelay": 0})
    monthly_stats: dict[str, dict] = defaultdict(lambda: {"samples": 0, "onTime": 0, "maxDelay": 0})
    prediction_stats: dict[tuple[str, str, str], dict] = defaultdict(lambda: {"samples": 0, "delayTotal": 0, "maxDelay": 0, "days": set()})
    delay_bands = {"定時（1分未満）": 0, "1～2分": 0, "3～5分": 0, "6～10分": 0, "11分以上": 0}
    previous_by_train: dict[tuple[str, str, str], sqlite3.Row] = {}
    service_destinations: dict[tuple[str, str, str], str] = {}

    for row in rows:
        delay = int(row["delay_seconds"])
        delayed = delay >= 60
        if delay < 60:
            delay_bands["定時（1分未満）"] += 1
        elif delay < 180:
            delay_bands["1～2分"] += 1
        elif delay < 360:
            delay_bands["3～5分"] += 1
        elif delay < 660:
            delay_bands["6～10分"] += 1
        else:
            delay_bands["11分以上"] += 1
        station = station_stats[(row["railway"], row["station_id"])]
        station["samples"] += 1
        station["delayTotal"] += delay
        station["maxDelay"] = max(station["maxDelay"], delay)

        train = train_stats[(row["railway"], row["train_number"])]
        train["samples"] += 1
        train["delayed"] += int(delayed)
        train["delayTotal"] += delay
        train["maxDelay"] = max(train["maxDelay"], delay)
        train["days"].add(row["service_date"])

        parsed = datetime.fromisoformat(row["observed_at"])
        weekday = weekday_stats[datetime.strptime(row["service_date"], "%Y-%m-%d").weekday()]
        hour = hour_stats[parsed.hour]
        for bucket in (weekday, hour):
            bucket["samples"] += 1
            bucket["delayed"] += int(delayed)
            bucket["maxDelay"] = max(bucket["maxDelay"], delay)

        daily = daily_stats[row["service_date"]]
        month = monthly_stats[row["service_date"][:7]]
        for bucket in (daily, month):
            bucket["samples"] += 1
            bucket["onTime"] += int(not delayed)
            bucket["maxDelay"] = max(bucket["maxDelay"], delay)

        prediction = prediction_stats[(row["railway"], row["train_number"], row["station_id"])]
        prediction["samples"] += 1
        prediction["delayTotal"] += delay
        prediction["maxDelay"] = max(prediction["maxDelay"], delay)
        prediction["days"].add(row["service_date"])

        train_key = (row["service_date"], row["railway"], row["train_number"])
        previous = previous_by_train.get(train_key)
        if previous and previous["station_id"] != row["station_id"]:
            change = delay - int(previous["delay_seconds"])
            station["changeTotal"] += change
            station["changes"] += 1
            station["increases"] += int(change > 0)
            station["recoveries"] += int(change < 0)
        previous_by_train[train_key] = row
        if row["destination_station"]:
            service_destinations[train_key] = row["destination_station"]

    def delay_bucket(name: str, value: dict) -> dict:
        samples = value["samples"]
        return {
            "name": name,
            "samples": samples,
            "delayed": value.get("delayed", samples - value.get("onTime", 0)),
            "onTimeRate": round((value.get("onTime", samples - value.get("delayed", 0)) / samples) * 100, 1) if samples else 0,
            "averageDelaySeconds": round(value.get("delayTotal", 0) / samples) if samples else 0,
            "maxDelaySeconds": value["maxDelay"],
        }

    heatmap = []
    for (railway, station_id), value in station_stats.items():
        heatmap.append({
            "railway": railway,
            "stationId": station_id,
            "samples": value["samples"],
            "averageDelaySeconds": round(value["delayTotal"] / value["samples"]),
            "maxDelaySeconds": value["maxDelay"],
            "averageChangeSeconds": round(value["changeTotal"] / value["changes"]) if value["changes"] else 0,
            "increaseCount": value["increases"],
            "recoveryCount": value["recoveries"],
        })
    heatmap.sort(key=lambda item: (abs(item["averageChangeSeconds"]), item["samples"]), reverse=True)

    train_ranking = [
        {**delay_bucket(key[1], value), "railway": key[0], "days": len(value["days"])}
        for key, value in train_stats.items()
    ]
    train_ranking.sort(key=lambda item: (item["averageDelaySeconds"], item["maxDelaySeconds"], item["samples"]), reverse=True)
    weekday_names = ["月", "火", "水", "木", "金", "土", "日"]
    weekday_ranking = [delay_bucket(weekday_names[index], weekday_stats[index]) for index in range(7) if weekday_stats[index]["samples"]]
    hour_ranking = [delay_bucket(f"{hour:02d}時", hour_stats[hour]) for hour in sorted(hour_stats)]
    daily = [delay_bucket(date, daily_stats[date]) for date in sorted(daily_stats)]
    monthly = [delay_bucket(month, monthly_stats[month]) for month in sorted(monthly_stats)]
    predictions = [
        {
            "railway": key[0],
            "trainNumber": key[1],
            "stationId": key[2],
            "sampleDays": len(value["days"]),
            "samples": value["samples"],
            "expectedDelaySeconds": round(value["delayTotal"] / value["samples"]),
            "maxDelaySeconds": value["maxDelay"],
        }
        for key, value in prediction_stats.items()
        if len(value["days"]) >= 2
    ]
    predictions.sort(key=lambda item: (item["sampleDays"], item["expectedDelaySeconds"]), reverse=True)

    destination_changes = []
    destination_history: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    for (date, railway, train_number), destination in sorted(service_destinations.items()):
        history_key = (railway, train_number)
        previous = [item_destination for item_date, item_destination in destination_history[history_key] if item_date < date]
        if previous:
            counts: dict[str, int] = defaultdict(int)
            for previous_destination in previous:
                counts[previous_destination] += 1
            usual, samples = max(counts.items(), key=lambda item: (item[1], item[0]))
            confidence = round(samples / len(previous) * 100, 1)
            if len(previous) >= 2 and destination != usual:
                destination_changes.append({
                    "serviceDate": date,
                    "railway": railway,
                    "trainNumber": train_number,
                    "usualDestinationStation": usual,
                    "actualDestinationStation": destination,
                    "confidence": confidence,
                    "sampleDays": len(previous),
                })
        destination_history[history_key].append((date, destination))
    destination_changes.sort(key=lambda item: (item["serviceDate"], item["confidence"]), reverse=True)

    last_success = STATE["last_success"]
    freshness_seconds = None
    if last_success:
        freshness_seconds = max(0, round((datetime.now(JST) - datetime.fromisoformat(last_success)).total_seconds()))
    return {
        "generatedAt": datetime.now(JST).isoformat(timespec="seconds"),
        "range": {"days": days, "from": cutoff, "to": service_date(), "retentionDays": RETENTION_DAYS},
        "health": {**STATE, "freshnessSeconds": freshness_seconds, "observationCount": total_observations},
        "summary": {"stationSamples": len(rows), "rawObservations": total_observations, "trains": len(train_stats), "stations": len({row["station_id"] for row in rows}), "stationLinePairs": len(station_stats)},
        "stationHeatmap": heatmap[:600],
        "trainRanking": train_ranking[:200],
        "weekdayRanking": weekday_ranking,
        "hourRanking": hour_ranking,
        "daily": daily,
        "monthly": monthly,
        "delayBands": [{"name": name, "samples": samples} for name, samples in delay_bands.items()],
        "predictions": predictions[:300],
        "destinationChanges": destination_changes[:300],
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
                    # A full COUNT scan blocks the API once the history DB grows into
                    # gigabytes. MAX(id) uses the primary-key B-tree and is an
                    # intentionally approximate, constant-time health metric.
                    count = database.execute("SELECT COALESCE(MAX(id), 0) FROM observations").fetchone()[0]
                    oldest = database.execute("SELECT service_date FROM observations ORDER BY service_date ASC LIMIT 1").fetchone()
                    newest = database.execute("SELECT service_date FROM observations ORDER BY service_date DESC LIMIT 1").fetchone()
                self._send_json(200, {"ok": STATE["consecutive_failures"] == 0, **STATE, "observation_count": count, "observation_count_approximate": True, "oldest_service_date": oldest[0] if oldest else None, "newest_service_date": newest[0] if newest else None, "retention_days": RETENTION_DAYS, "interval_seconds": INTERVAL, "storage": storage_status()})
                return
            if parsed.path == "/api/v1/train-history":
                self._send_json(200, train_history(urllib.parse.parse_qs(parsed.query)))
                return
            if parsed.path == "/api/v1/statistics":
                self._send_json(200, statistics(urllib.parse.parse_qs(parsed.query)))
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
    cleanup_old_observations(force=True)
    cleanup_storage_limit(force=True)
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
