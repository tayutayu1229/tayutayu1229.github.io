#!/usr/bin/env python3
"""北区コミュニティバスの公開GTFSからWeb表示用JSONを生成する。"""

from __future__ import annotations

import argparse
import csv
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

FEED_URL = "https://api.gtfs-data.jp/v2/organizations/saitamacity/feeds/kitakucommunitybus/files/feed.zip"


def read_csv(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with archive.open(name) as source:
        text = io.TextIOWrapper(source, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


def compact_time(value: str) -> str:
    hour, minute, _ = value.split(":")
    return f"{int(hour):02d}:{minute}"


def build(zip_path: Path, output_path: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        stops = read_csv(archive, "stops.txt")
        trips = read_csv(archive, "trips.txt")
        stop_times = read_csv(archive, "stop_times.txt")
        shapes = read_csv(archive, "shapes.txt")
        calendar = read_csv(archive, "calendar.txt")[0]
        exceptions = read_csv(archive, "calendar_dates.txt")
        fares = read_csv(archive, "fare_attributes.txt")
        feed_info = read_csv(archive, "feed_info.txt")[0]

    stop_by_id = {row["stop_id"]: row for row in stops}
    trip_by_id = {row["trip_id"]: row for row in trips}
    grouped_stops: dict[str, dict] = {}

    for row in stops:
        name = row["stop_name"]
        group = grouped_stops.setdefault(name, {"name": name, "ids": [], "lats": [], "lons": [], "departures": []})
        group["ids"].append(row["stop_id"])
        group["lats"].append(float(row["stop_lat"]))
        group["lons"].append(float(row["stop_lon"]))

    for row in stop_times:
        stop = stop_by_id[row["stop_id"]]
        trip = trip_by_id[row["trip_id"]]
        grouped_stops[stop["stop_name"]]["departures"].append({
            "time": compact_time(row["departure_time"]),
            "headsign": trip["trip_headsign"],
            "direction": int(trip["direction_id"]),
            "trip": row["trip_id"],
        })

    stop_data = []
    for group in grouped_stops.values():
        stop_data.append({
            "name": group["name"],
            "lat": round(sum(group["lats"]) / len(group["lats"]), 6),
            "lon": round(sum(group["lons"]) / len(group["lons"]), 6),
            "departures": sorted(group["departures"], key=lambda item: (item["time"], item["headsign"])),
        })

    shape_data: dict[str, list[list[float]]] = defaultdict(list)
    for row in sorted(shapes, key=lambda item: (item["shape_id"], int(item["shape_pt_sequence"]))):
        shape_data[row["shape_id"]].append([round(float(row["shape_pt_lat"]), 7), round(float(row["shape_pt_lon"]), 7)])

    data = {
        "meta": {
            "name": "北区コミュニティバス",
            "publisher": feed_info["feed_publisher_name"],
            "version": feed_info["feed_version"],
            "startDate": feed_info["feed_start_date"],
            "endDate": feed_info["feed_end_date"],
            "license": "CC BY 4.0",
            "sourceUrl": FEED_URL,
            "operatorUrl": "https://www.city.saitama.lg.jp/001/010/018/004/index.html",
            "serviceDays": {key: int(calendar[key]) for key in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")},
            "exceptions": {row["date"]: int(row["exception_type"]) for row in exceptions},
            "fares": sorted({int(float(row["price"])) for row in fares}),
        },
        "stops": stop_data,
        "shapes": shape_data,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=Path, help="取得済みfeed.zipを使用する")
    parser.add_argument("--output", type=Path, default=Path("kitaku-bus/data.json"))
    args = parser.parse_args()
    if args.zip:
        build(args.zip, args.output)
        return
    request = urllib.request.Request(FEED_URL, headers={"User-Agent": "Tokyo-Transport-Info/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read()
    temporary = Path("/tmp/kitakucommunitybus-feed.zip")
    temporary.write_bytes(payload)
    build(temporary, args.output)


if __name__ == "__main__":
    main()
