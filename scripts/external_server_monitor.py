#!/usr/bin/env python3
"""External HTTP/TLS probe used by the scheduled GitHub Actions workflow."""

import json
import socket
import ssl
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TARGETS = [
    ("Tayunetトップ", "https://tayunet-traininfo.com/", {200}, False),
    ("Tayunet API", "https://api.tayunet-traininfo.com/", {401}, True),
    ("遅延履歴API", "https://history.tayunet-traininfo.com/health", {200}, True),
    ("事象共有API", "https://incident-api.tayunet-traininfo.com/health", {200}, True),
    ("撮影記録API", "https://photo-api.tayunet-traininfo.com/health", {200}, True),
    ("保護データAPI", "https://secure.tayunet-traininfo.com/api/timetable-files", {401}, True),
    ("列車サービス", "https://train.tayunet-traininfo.com/", {200}, False),
    ("航空サービス", "https://flightal.tayunet-traininfo.com/", {200}, False),
    ("JR一斉配信", "https://jreissei.tayunet-traininfo.com/", {200}, False),
]


def probe(name, url, expected, require_json):
    started = time.monotonic()
    try:
        try:
            response = urlopen(Request(url, headers={"User-Agent": "TayunetExternalMonitor/1.0", "Accept": "application/json,text/html"}), timeout=10)
        except HTTPError as error:
            response = error
        body = response.read(1024 * 1024)
        json_valid = None
        if require_json:
            try:
                json.loads(body)
                json_valid = True
            except (ValueError, json.JSONDecodeError):
                json_valid = False
        elapsed = round((time.monotonic() - started) * 1000)
        return {"name": name, "url": url, "ok": response.status in expected and json_valid is not False and elapsed < 10000, "status": response.status, "responseMs": elapsed, "jsonValid": json_valid}
    except (URLError, OSError, TimeoutError) as error:
        return {"name": name, "url": url, "ok": False, "status": 0, "responseMs": round((time.monotonic() - started) * 1000), "error": str(error)}


def tls(host):
    try:
        with socket.create_connection((host, 443), timeout=8) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as wrapped:
                cert = wrapped.getpeercert()
        expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days = int((expires - datetime.now(timezone.utc)).total_seconds() // 86400)
        return {"host": host, "ok": days > 7, "daysRemaining": days, "expiresAt": expires.isoformat()}
    except Exception as error:
        return {"host": host, "ok": False, "error": str(error)}


def main():
    final = []
    # Three attempts in the same external run prevent one-off network failures
    # from becoming an incident notification.
    for attempt in range(3):
        rows = [probe(*target) for target in TARGETS]
        if all(row["ok"] for row in rows):
            final = rows
            break
        final = rows
        if attempt < 2:
            time.sleep(20)
    hosts = sorted({url.split("/")[2] for _, url, _, _ in TARGETS})
    certificates = [tls(host) for host in hosts]
    payload = {"checkedAt": datetime.now(timezone.utc).isoformat(), "targets": final, "tls": certificates}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    failures = [row for row in final if not row["ok"]] + [row for row in certificates if not row["ok"]]
    if failures:
        print("\nFAILURE_SUMMARY=" + " / ".join(f"{row.get('name', row.get('host'))}: HTTP {row.get('status', '-')} {row.get('error', '')}" for row in failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
