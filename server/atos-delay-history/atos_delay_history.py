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
INTERVAL = max(10, int(os.environ.get("ATOS_HISTORY_INTERVAL", "20")))
RETENTION_DAYS = max(1, min(275, int(os.environ.get("ATOS_HISTORY_RETENTION_DAYS", "120"))))
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
}
STATISTICS_CACHE: dict[int, tuple[float, dict]] = {}


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
            CREATE INDEX IF NOT EXISTS idx_observations_number
                ON observations(service_date, train_number, observed_at);
            CREATE INDEX IF NOT EXISTS idx_observations_date
                ON observations(service_date);
            CREATE TABLE IF NOT EXISTS train_states (
                service_date TEXT NOT NULL,
                railway TEXT NOT NULL,
                train_number TEXT NOT NULL,
                first_station TEXT,
                last_station TEXT,
                destination_station TEXT,
                rail_direction TEXT,
                car_composition INTEGER,
                train_type TEXT,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                PRIMARY KEY (service_date, railway, train_number)
            );
            CREATE INDEX IF NOT EXISTS idx_train_states_date
                ON train_states(service_date);
            CREATE INDEX IF NOT EXISTS idx_train_states_number
                ON train_states(service_date, train_number);
            CREATE TABLE IF NOT EXISTS destination_events (
                service_date TEXT NOT NULL,
                railway TEXT NOT NULL,
                train_number TEXT NOT NULL,
                destination_station TEXT NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                PRIMARY KEY (service_date, railway, train_number, destination_station)
            );
            CREATE INDEX IF NOT EXISTS idx_destination_events_date
                ON destination_events(service_date);
            """
        )


def cleanup_old_observations(force: bool = False) -> int:
    """設定された保持日数分だけを残す。通常は運転日が変わった時に一度だけ実行する。"""
    today = service_date()
    if not force and STATE["last_cleanup"] == today:
        return 0
    cutoff = (datetime.now(JST) - timedelta(days=RETENTION_DAYS - 1)).strftime("%Y-%m-%d")
    with connect() as database:
        before = database.total_changes
        database.execute("DELETE FROM observations WHERE service_date < ?", (cutoff,))
        database.execute("DELETE FROM train_states WHERE service_date < ?", (cutoff,))
        database.execute("DELETE FROM destination_events WHERE service_date < ?", (cutoff,))
        deleted = database.total_changes - before
    STATE["last_cleanup"] = today
    STATE["deleted_observations"] = deleted
    if deleted:
        LOG.info("保存期限を過ぎた実績 %d件を削除（保持 %d日、基準日 %s）", deleted, RETENTION_DAYS, cutoff)
    return deleted


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
    state_rows: list[tuple] = []
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
        destinations = train.get("odpt:destinationStation") or []
        destination = str(destinations[0] if isinstance(destinations, list) and destinations else destinations or "")
        state_rows.append((
            operating_date,
            railway,
            train_number,
            from_station,
            from_station,
            destination or None,
            str(train.get("odpt:railDirection") or "") or None,
            train.get("odpt:carComposition"),
            str(train.get("odpt:trainType") or "") or None,
            observed_at,
            observed_at,
        ))

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
        database.executemany(
            """
            INSERT INTO train_states
              (service_date, railway, train_number, first_station, last_station, destination_station,
               rail_direction, car_composition, train_type, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(service_date, railway, train_number) DO UPDATE SET
              last_station=excluded.last_station,
              destination_station=COALESCE(excluded.destination_station, train_states.destination_station),
              rail_direction=COALESCE(excluded.rail_direction, train_states.rail_direction),
              car_composition=COALESCE(excluded.car_composition, train_states.car_composition),
              train_type=COALESCE(excluded.train_type, train_states.train_type),
              last_seen=excluded.last_seen
            """,
            state_rows,
        )
        database.executemany(
            """
            INSERT INTO destination_events
              (service_date, railway, train_number, destination_station, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(service_date, railway, train_number, destination_station) DO UPDATE SET
              last_seen=excluded.last_seen
            """,
            [(row[0], row[1], row[2], row[5], row[9], row[10]) for row in state_rows if row[5]],
        )
        inserted = database.total_changes - before
    cleanup_old_observations()
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
            SELECT station_id, CAST(ROUND(AVG(delay_seconds)) AS INTEGER) AS expected_delay,
                   COUNT(DISTINCT service_date) AS sample_days
            FROM observations
            WHERE {prediction_where}
            GROUP BY station_id
            """,
            prediction_values,
        ).fetchall()
        historical_rows = database.execute(
            f"""
            WITH ranked AS (
              SELECT service_date, station_id, delay_seconds, observed_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY service_date, station_id
                       ORDER BY observed_at DESC, id DESC
                     ) AS row_number
              FROM observations
              WHERE {prediction_where}
            )
            SELECT service_date, station_id, delay_seconds, observed_at
            FROM ranked WHERE row_number = 1
            ORDER BY service_date, observed_at
            """,
            prediction_values,
        ).fetchall()
        current_state = database.execute(
            """
            SELECT * FROM train_states
            WHERE service_date = ? AND train_number = ?
            ORDER BY CASE WHEN railway = ? THEN 0 ELSE 1 END, first_seen
            LIMIT 1
            """,
            (operating_date, train_number, railway),
        ).fetchone()
        day_states = database.execute(
            "SELECT * FROM train_states WHERE service_date = ? AND train_number <> ?",
            (operating_date, train_number),
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
    changes: dict[str, list[int]] = defaultdict(list)
    previous_by_day: dict[str, sqlite3.Row] = {}
    for row in historical_rows:
        previous = previous_by_day.get(row["service_date"])
        if previous and previous["station_id"] != row["station_id"]:
            changes[row["station_id"]].append(int(row["delay_seconds"]) - int(previous["delay_seconds"]))
        previous_by_day[row["service_date"]] = row
    predictions = {}
    for row in prediction_rows:
        station_changes = changes.get(row["station_id"], [])
        predictions[row["station_id"]] = {
            "expectedDelaySeconds": row["expected_delay"],
            "sampleDays": row["sample_days"],
            "expectedChangeSeconds": round(sum(station_changes) / len(station_changes)) if station_changes else 0,
            "recoveryRate": round(sum(1 for value in station_changes if value < 0) / len(station_changes) * 100, 1) if station_changes else 0,
        }

    def physical_station_key(value: str | None) -> str:
        return str(value or "").split(".")[-1]

    def inferred_connection(direction: str) -> dict | None:
        if not current_state:
            return None
        if direction == "previous":
            station = current_state["first_station"]
            boundary = datetime.fromisoformat(current_state["first_seen"])
            candidates = [
                state for state in day_states
                if physical_station_key(state["last_station"]) == physical_station_key(station)
                and 0 <= (boundary - datetime.fromisoformat(state["last_seen"])).total_seconds() <= 480
            ]
            gap = lambda state: round((boundary - datetime.fromisoformat(state["last_seen"])).total_seconds())
        else:
            station = current_state["last_station"]
            boundary = datetime.fromisoformat(current_state["last_seen"])
            candidates = [
                state for state in day_states
                if physical_station_key(state["first_station"]) == physical_station_key(station)
                and 0 <= (datetime.fromisoformat(state["first_seen"]) - boundary).total_seconds() <= 480
            ]
            gap = lambda state: round((datetime.fromisoformat(state["first_seen"]) - boundary).total_seconds())
        # 同じ駅・時間帯に候補が複数ある場合は誤案内を避け、確定扱いにしない。
        if len(candidates) != 1:
            return None
        match = candidates[0]
        return {
            "trainNumber": match["train_number"],
            "railway": match["railway"],
            "stationId": station,
            "gapSeconds": gap(match),
            "confidence": "confirmed",
        }
    return {
        "serviceDate": operating_date,
        "railway": railway,
        "trainNumber": train_number,
        "railways": sorted(railways),
        "stations": stations,
        "predictions": predictions,
        "inferredConnections": {
            "previous": inferred_connection("previous"),
            "next": inferred_connection("next"),
        },
        "count": len(rows),
    }


def statistics(params: dict[str, list[str]]) -> dict:
    try:
        days = max(1, min(RETENTION_DAYS, int((params.get("days") or [str(RETENTION_DAYS)])[0])))
    except ValueError as error:
        raise ValueError("days は整数で指定してください") from error
    cached = STATISTICS_CACHE.get(days)
    if cached and time.monotonic() - cached[0] < 900:
        return cached[1]
    cutoff = (datetime.now(JST) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with connect() as database:
        rows = database.execute(
            """
            WITH ranked AS (
              SELECT service_date, railway, train_number, station_id, phase, delay_seconds, observed_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY service_date, railway, train_number, station_id
                       ORDER BY observed_at DESC, id DESC
                     ) AS row_number
              FROM observations WHERE service_date >= ?
            )
            SELECT service_date, railway, train_number, station_id, phase, delay_seconds, observed_at
            FROM ranked WHERE row_number = 1
            ORDER BY service_date, train_number, observed_at
            """,
            (cutoff,),
        ).fetchall()
        total_observations = database.execute(
            "SELECT COUNT(*) FROM observations WHERE service_date >= ?", (cutoff,)
        ).fetchone()[0]
        destination_rows = database.execute(
            """
            SELECT service_date, railway, train_number, destination_station, first_seen, last_seen
            FROM destination_events
            WHERE service_date >= ? AND destination_station IS NOT NULL AND destination_station <> ''
            ORDER BY service_date, train_number, first_seen
            """,
            (cutoff,),
        ).fetchall()

    station_stats: dict[tuple[str, str], dict] = defaultdict(lambda: {"samples": 0, "delayTotal": 0, "maxDelay": 0, "changeTotal": 0, "changes": 0, "increases": 0, "recoveries": 0})
    train_stats: dict[tuple[str, str], dict] = defaultdict(lambda: {"samples": 0, "delayed": 0, "delayTotal": 0, "maxDelay": 0, "days": set()})
    weekday_stats: dict[int, dict] = defaultdict(lambda: {"samples": 0, "delayed": 0, "maxDelay": 0})
    hour_stats: dict[int, dict] = defaultdict(lambda: {"samples": 0, "delayed": 0, "maxDelay": 0})
    daily_stats: dict[str, dict] = defaultdict(lambda: {"samples": 0, "onTime": 0, "maxDelay": 0})
    monthly_stats: dict[str, dict] = defaultdict(lambda: {"samples": 0, "onTime": 0, "maxDelay": 0})
    prediction_stats: dict[tuple[str, str, str], dict] = defaultdict(lambda: {"samples": 0, "delayTotal": 0, "maxDelay": 0, "days": set()})
    delay_bands = {"定時（1分未満）": 0, "1～2分": 0, "3～5分": 0, "6～10分": 0, "11分以上": 0}
    previous_by_train: dict[tuple[str, str], sqlite3.Row] = {}

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

        train_key = (row["service_date"], row["train_number"])
        previous = previous_by_train.get(train_key)
        previous_gap = (datetime.fromisoformat(row["observed_at"]) - datetime.fromisoformat(previous["observed_at"])).total_seconds() if previous else None
        if previous and previous["station_id"] != row["station_id"] and 0 <= previous_gap <= 2700:
            change = delay - int(previous["delay_seconds"])
            station["changeTotal"] += change
            station["changes"] += 1
            station["increases"] += int(change > 0)
            station["recoveries"] += int(change < 0)
        previous_by_train[train_key] = row

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

    live_destination_groups: dict[tuple[str, str, str], list] = defaultdict(list)
    destination_groups: dict[tuple[str, str], dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for row in destination_rows:
        live_destination_groups[(row["service_date"], row["railway"], row["train_number"])].append(row)
        destination_groups[(row["railway"], row["train_number"])][row["destination_station"]].add(row["service_date"])
    live_destination_changes = []
    for (date, railway, train_number), rows_for_train in live_destination_groups.items():
        ordered = sorted(rows_for_train, key=lambda row: row["first_seen"] or "")
        destinations = []
        seen_destinations = set()
        for row in ordered:
            destination = row["destination_station"]
            if destination in seen_destinations:
                continue
            seen_destinations.add(destination)
            destinations.append(row)
        if len(destinations) < 2:
            continue
        live_destination_changes.append({
            "serviceDate": date,
            "railway": railway,
            "trainNumber": train_number,
            "usualDestinationStation": destinations[0]["destination_station"],
            "actualDestinationStation": destinations[-1]["destination_station"],
            "detectedAt": destinations[-1]["last_seen"],
            "confidence": 100.0,
            "source": "same-day-destination-change",
        })
    live_destination_changes.sort(key=lambda item: item["detectedAt"], reverse=True)
    destination_changes = []
    for (railway, train_number), destinations in destination_groups.items():
        counts = sorted(((len(days), destination, days) for destination, days in destinations.items()), reverse=True)
        total_days = len(set().union(*(days for _, _, days in counts))) if counts else 0
        if total_days < 5 or not counts or counts[0][0] / total_days < 0.8:
            continue
        usual_count, usual_destination, _ = counts[0]
        for actual_count, actual_destination, dates in counts[1:]:
            for date in sorted(dates, reverse=True):
                destination_changes.append({
                    "serviceDate": date,
                    "railway": railway,
                    "trainNumber": train_number,
                    "usualDestinationStation": usual_destination,
                    "actualDestinationStation": actual_destination,
                    "usualSampleDays": usual_count,
                    "totalSampleDays": total_days,
                    "confidence": round(usual_count / total_days * 100, 1),
                })
    destination_changes.sort(key=lambda item: item["serviceDate"], reverse=True)

    last_success = STATE["last_success"]
    freshness_seconds = None
    if last_success:
        freshness_seconds = max(0, round((datetime.now(JST) - datetime.fromisoformat(last_success)).total_seconds()))
    result = {
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
        "destinationChanges": destination_changes[:200],
        "liveDestinationChanges": live_destination_changes[:200],
    }
    STATISTICS_CACHE[days] = (time.monotonic(), result)
    return result


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
                    dates = database.execute("SELECT MIN(service_date), MAX(service_date) FROM observations").fetchone()
                    database_bytes = database.execute("PRAGMA page_count").fetchone()[0] * database.execute("PRAGMA page_size").fetchone()[0]
                self._send_json(200, {"ok": STATE["consecutive_failures"] == 0, **STATE, "observation_count": count, "oldest_service_date": dates[0], "newest_service_date": dates[1], "retention_days": RETENTION_DAYS, "database_bytes": database_bytes})
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
