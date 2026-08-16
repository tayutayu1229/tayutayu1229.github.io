#!/usr/bin/env python3
"""Tayunet Ubuntu health monitor and restricted recovery API.

Runs as the existing ``yoshi`` account, binds to localhost, and is published
only through the existing Cloudflare Tunnel. Every non-health endpoint checks
both a Firebase ID token and the explicit administrator email allowlist.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import shutil
import socket
import sqlite3
import ssl
import subprocess
import threading
import time
import traceback
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


PORT = int(os.environ.get("TAYUNET_MONITOR_PORT", "5110"))
DATA_DIR = Path(os.environ.get("TAYUNET_MONITOR_DATA", "/home/yoshi/.local/share/tayunet-server-monitor"))
DB_PATH = DATA_DIR / "monitor.sqlite3"
FIREBASE_API_KEY = os.environ.get("TAYUNET_FIREBASE_API_KEY", "AIzaSyAjMS_UwsMRm3XkXBqRnt4mgugR1LhWz4I")
FIREBASE_PROJECT_ID = os.environ.get("TAYUNET_FIREBASE_PROJECT_ID", "tokyo-pass")
ALLOWED_EMAILS = {
    value.strip().lower()
    for value in os.environ.get(
        "TAYUNET_MONITOR_ADMINS",
        "admin@tayunet-traininfo.com,systemadmin@tayunet-traininfo.com,railwaymax185@gmail.com",
    ).split(",")
    if value.strip()
}
ALLOWED_ORIGINS = {
    "https://tayunet-traininfo.com",
    "https://www.tayunet-traininfo.com",
    "https://tayutayu1229.github.io",
}
CHANNEL_ID = os.environ.get("TAYUNET_DISCORD_CHANNEL", "1499762805065388274")
DISCORD_ENV_FILES = [
    Path("/home/yoshi/tokyo-discord-bot/.env"),
    Path("/home/yoshi/yoshi-util-discord-bot/.env"),
]
PM2_BIN = "/home/yoshi/.nvm/versions/node/v24.15.0/lib/node_modules/pm2/bin/pm2"
PM2_NAMES = {
    "file-api", "filet-main", "flight-alert", "timetable-app",
    "tokyo-discord-bot", "jre-issei", "jre-discord-voice",
}
DOCKER_NAMES = {
    "incident-share", "atos-delay-history", "tayunet-photo-archive",
    "atos-history-tunnel", "jreast-press-bot-press-release-bot-1",
    "jre-aivis", "jre-voicevox",
}
PUBLIC_TARGETS = [
    {"id": "site", "name": "Tayunetトップ", "url": "https://tayunet-traininfo.com/", "expected": [200], "json": False},
    {"id": "api", "name": "Tayunet API", "url": "https://api.tayunet-traininfo.com/", "expected": [401], "json": True},
    {"id": "history", "name": "遅延履歴API", "url": "https://history.tayunet-traininfo.com/health", "expected": [200], "json": True},
    {"id": "incident", "name": "事象共有API", "url": "https://incident-api.tayunet-traininfo.com/health", "expected": [200], "json": True},
    {"id": "photo", "name": "撮影記録API", "url": "https://photo-api.tayunet-traininfo.com/health", "expected": [200], "json": True},
    {"id": "secure", "name": "保護データAPI", "url": "https://secure.tayunet-traininfo.com/api/timetable-files", "expected": [401], "json": True},
    {"id": "train", "name": "列車サービス", "url": "https://train.tayunet-traininfo.com/", "expected": [200], "json": False},
    {"id": "flight", "name": "航空サービス", "url": "https://flightal.tayunet-traininfo.com/", "expected": [200], "json": False},
    {"id": "jreissei", "name": "JR一斉配信", "url": "https://jreissei.tayunet-traininfo.com/", "expected": [200], "json": False},
]

THRESHOLDS = {
    "cpu": {"warning": 90, "critical": 97},
    "memory": {"warning": 80, "critical": 90},
    "swap": {"warning": 80, "critical": 92},
    "disk": {"warning": 85, "critical": 95},
    "temperature": {"warning": 80, "critical": 90},
    "iowait": {"warning": 25, "critical": 45},
    "packet_loss": {"warning": 10, "critical": 40},
    "api_ms": {"warning": 3000, "critical": 10000},
    "tls_days": {"warning": 30, "critical": 7},
}

DATA_DIR.mkdir(parents=True, exist_ok=True)
db_lock = threading.Lock()
state_lock = threading.Lock()
action_lock = threading.Lock()
current_state: dict = {"status": "starting", "collectedAt": None}
previous_cpu = None
previous_network = None
previous_oom_kills = None
alert_streaks: dict[str, int] = {}
active_alerts: dict[str, dict] = {}
auth_cache: dict[str, tuple[float, dict]] = {}
AUTO_RECOVERY_MAP = {
    "endpoint:history": ("docker", "atos-delay-history"),
    "endpoint:incident": ("docker", "incident-share"),
    "endpoint:photo": ("docker", "tayunet-photo-archive"),
    "endpoint:jreissei": ("pm2", "jre-issei"),
    "endpoint:flight": ("pm2", "flight-alert"),
}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(command: list[str], timeout: int = 15) -> tuple[int, str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, (result.stdout + result.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return 124, str(error)


def init_db() -> None:
    with sqlite3.connect(DB_PATH) as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS metrics (
          collected_at TEXT PRIMARY KEY,
          payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rollups (
          bucket TEXT NOT NULL,
          granularity TEXT NOT NULL,
          payload TEXT NOT NULL,
          PRIMARY KEY(bucket, granularity)
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          severity TEXT NOT NULL,
          code TEXT NOT NULL,
          message TEXT NOT NULL,
          detail TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          actor TEXT NOT NULL,
          kind TEXT NOT NULL,
          target TEXT NOT NULL,
          action TEXT NOT NULL,
          success INTEGER NOT NULL,
          detail TEXT NOT NULL DEFAULT ''
        );
        """)


def db_execute(sql: str, values=()) -> None:
    with db_lock, sqlite3.connect(DB_PATH) as db:
        db.execute(sql, values)
        db.commit()


def db_rows(sql: str, values=()) -> list[dict]:
    with db_lock, sqlite3.connect(DB_PATH) as db:
        db.row_factory = sqlite3.Row
        return [dict(row) for row in db.execute(sql, values).fetchall()]


def read_meminfo() -> dict:
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, raw = line.split(":", 1)
        values[key] = int(raw.strip().split()[0]) * 1024
    total = values.get("MemTotal", 1)
    available = values.get("MemAvailable", 0)
    swap_total = values.get("SwapTotal", 0)
    swap_free = values.get("SwapFree", 0)
    return {
        "totalBytes": total,
        "usedBytes": total - available,
        "usedPercent": round((total - available) / total * 100, 1),
        "swapTotalBytes": swap_total,
        "swapUsedBytes": swap_total - swap_free,
        "swapUsedPercent": round((swap_total - swap_free) / swap_total * 100, 1) if swap_total else 0,
    }


def read_vmstat() -> dict:
    data = {}
    try:
        for line in Path("/proc/vmstat").read_text().splitlines():
            key, value = line.split()
            if key in ("pswpin", "pswpout", "oom_kill"):
                data[key] = int(value)
    except OSError:
        pass
    return data


def read_cpu() -> dict:
    global previous_cpu
    line = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
    values = [int(value) for value in line]
    total = sum(values)
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    iowait = values[4] if len(values) > 4 else 0
    result = {"usedPercent": 0.0, "iowaitPercent": 0.0, "load": [round(x, 2) for x in os.getloadavg()]}
    if previous_cpu:
        delta_total = max(1, total - previous_cpu[0])
        result["usedPercent"] = round((1 - (idle - previous_cpu[1]) / delta_total) * 100, 1)
        result["iowaitPercent"] = round((iowait - previous_cpu[2]) / delta_total * 100, 1)
    previous_cpu = (total, idle, iowait)
    return result


def read_disks() -> list[dict]:
    disks = []
    for mount in ("/", "/mnt/hdd"):
        try:
            usage = shutil.disk_usage(mount)
            disks.append({
                "mount": mount, "totalBytes": usage.total, "usedBytes": usage.used,
                "freeBytes": usage.free, "usedPercent": round(usage.used / usage.total * 100, 1),
            })
        except OSError as error:
            disks.append({"mount": mount, "error": str(error)})
    return disks


def read_temperature() -> dict:
    readings = []
    for path in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
        try:
            value = float(path.read_text().strip())
            if value > 1000:
                value /= 1000
            if 0 < value < 150:
                readings.append(round(value, 1))
        except (OSError, ValueError):
            pass
    return {"maxCelsius": max(readings) if readings else None, "readings": readings}


def read_network() -> dict:
    global previous_network
    totals = {"rx": 0, "tx": 0, "rxPackets": 0, "txPackets": 0, "rxErrors": 0, "txErrors": 0}
    for line in Path("/proc/net/dev").read_text().splitlines()[2:]:
        name, raw = line.split(":", 1)
        if name.strip() == "lo":
            continue
        values = [int(value) for value in raw.split()]
        totals["rx"] += values[0]
        totals["rxPackets"] += values[1]
        totals["rxErrors"] += values[2]
        totals["tx"] += values[8]
        totals["txPackets"] += values[9]
        totals["txErrors"] += values[10]
    now = time.monotonic()
    result = {"rxBytesPerSec": 0, "txBytesPerSec": 0, **totals}
    if previous_network:
        elapsed = max(.1, now - previous_network[0])
        result["rxBytesPerSec"] = round((totals["rx"] - previous_network[1]["rx"]) / elapsed)
        result["txBytesPerSec"] = round((totals["tx"] - previous_network[1]["tx"]) / elapsed)
    previous_network = (now, totals)
    code, output = run(["ping", "-c", "4", "-W", "2", "1.1.1.1"], timeout=12)
    match = re.search(r"([0-9.]+)% packet loss", output)
    latency = re.search(r"= [^/]+/([^/]+)/", output)
    result["packetLossPercent"] = float(match.group(1)) if match else (100 if code else 0)
    result["latencyMs"] = round(float(latency.group(1)), 1) if latency else None
    return result


def json_lines(output: str) -> list[dict]:
    rows = []
    for line in output.splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def docker_status() -> list[dict]:
    code, output = run(["docker", "ps", "-a", "--format", "{{json .}}"])
    if code:
        return [{"error": output or "docker unavailable"}]
    rows = {row.get("Names"): row for row in json_lines(output)}
    _, stats_output = run(["docker", "stats", "--no-stream", "--format", "{{json .}}"], timeout=25)
    stats = {row.get("Name"): row for row in json_lines(stats_output)}
    return [{
        "name": name,
        "state": rows.get(name, {}).get("State", "missing"),
        "status": rows.get(name, {}).get("Status", "not found"),
        "image": rows.get(name, {}).get("Image", "-"),
        "cpuPercent": stats.get(name, {}).get("CPUPerc", "-"),
        "memory": stats.get(name, {}).get("MemUsage", "-"),
        "memoryPercent": stats.get(name, {}).get("MemPerc", "-"),
        "netIO": stats.get(name, {}).get("NetIO", "-"),
        "blockIO": stats.get(name, {}).get("BlockIO", "-"),
    } for name in sorted(DOCKER_NAMES)]


def pm2_status() -> list[dict]:
    code, output = run([PM2_BIN, "jlist"], timeout=20)
    if code:
        return [{"error": output or "pm2 unavailable"}]
    try:
        rows = {row.get("name"): row for row in json.loads(output)}
    except json.JSONDecodeError:
        return [{"error": "invalid pm2 response"}]
    result = []
    for name in sorted(PM2_NAMES):
        row = rows.get(name, {})
        env = row.get("pm2_env", {})
        monit = row.get("monit", {})
        result.append({
            "name": name, "status": env.get("status", "missing"),
            "restarts": env.get("restart_time", 0), "unstableRestarts": env.get("unstable_restarts", 0),
            "uptime": env.get("pm_uptime"), "cpuPercent": monit.get("cpu", 0),
            "memoryBytes": monit.get("memory", 0),
        })
    return result


def check_url(target: dict) -> dict:
    started = time.monotonic()
    request = Request(target["url"], headers={"User-Agent": "TayunetServerMonitor/1.0", "Accept": "application/json,text/html"})
    status = 0
    detail = ""
    json_valid = None
    try:
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        status = response.status
        body = response.read(1024 * 1024)
        if target["json"]:
            try:
                json.loads(body)
                json_valid = True
            except (ValueError, json.JSONDecodeError):
                json_valid = False
        ok = status in target["expected"] and json_valid is not False
        detail = f"HTTP {status}"
    except (URLError, OSError, TimeoutError) as error:
        ok = False
        detail = str(error)
    elapsed = round((time.monotonic() - started) * 1000)
    return {**target, "ok": ok, "status": status, "responseMs": elapsed, "jsonValid": json_valid, "detail": detail}


def tls_status(host: str) -> dict:
    try:
        context = ssl.create_default_context()
        with socket.create_connection((host, 443), timeout=8) as raw:
            with context.wrap_socket(raw, server_hostname=host) as wrapped:
                cert = wrapped.getpeercert()
        expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days = int((expires - datetime.now(timezone.utc)).total_seconds() // 86400)
        return {"host": host, "ok": days >= 0, "daysRemaining": days, "expiresAt": expires.isoformat(), "issuer": dict(x[0] for x in cert.get("issuer", ())).get("organizationName", "-")}
    except Exception as error:
        return {"host": host, "ok": False, "daysRemaining": None, "error": str(error)}


def smart_status() -> list[dict]:
    smartctl = shutil.which("smartctl") or ("/usr/sbin/smartctl" if Path("/usr/sbin/smartctl").exists() else None)
    if not smartctl:
        return [{"device": "/dev/sda", "available": False}, {"device": "/dev/sdb", "available": False}]
    results = []
    for device in ("/dev/sda", "/dev/sdb"):
        code, output = run(["sudo", "-n", smartctl, "-H", "-A", "-j", device], timeout=15)
        try:
            data = json.loads(output)
            passed = data.get("smart_status", {}).get("passed")
            temperature = data.get("temperature", {}).get("current")
            attrs = {row.get("name"): row.get("raw", {}).get("value") for table in data.get("ata_smart_attributes", {}).get("table", []) for row in [table]}
            results.append({"device": device, "available": True, "passed": passed, "temperature": temperature, "reallocatedSectors": attrs.get("Reallocated_Sector_Ct", 0), "pendingSectors": attrs.get("Current_Pending_Sector", 0), "exitCode": code})
        except (ValueError, json.JSONDecodeError):
            results.append({"device": device, "available": False, "error": output[-240:]})
    return results


def system_checks() -> dict:
    global previous_oom_kills
    _, failed = run(["systemctl", "--failed", "--no-legend", "--no-pager"])
    vmstat = read_vmstat()
    _, journal = run(["journalctl", "-k", "--since", "-10 minutes", "--no-pager", "-n", "100"], timeout=10)
    oom_lines = [line for line in journal.splitlines() if re.search(r"out of memory|oom-kill|killed process", line, re.I)]
    oom_count = vmstat.get("oom_kill", 0)
    if previous_oom_kills is not None and oom_count > previous_oom_kills:
        oom_lines.append(f"OOM kill count increased: {previous_oom_kills} -> {oom_count}")
    previous_oom_kills = oom_count
    fail2ban_client = shutil.which("fail2ban-client") or ("/usr/bin/fail2ban-client" if Path("/usr/bin/fail2ban-client").exists() else None)
    fail2ban_available = bool(fail2ban_client)
    fail2ban = {"available": fail2ban_available, "jails": []}
    if fail2ban_available:
        code, output = run(["sudo", "-n", fail2ban_client, "status"])
        fail2ban.update({"ok": code == 0, "summary": output[-1000:]})
    return {
        "failedServices": [line.strip() for line in failed.splitlines() if line.strip()],
        "vmstat": vmstat, "recentOom": oom_lines[-20:], "fail2ban": fail2ban,
    }


def backup_status() -> dict:
    status_file = DATA_DIR / "backup-status.json"
    try:
        return json.loads(status_file.read_text())
    except (OSError, ValueError, json.JSONDecodeError):
        return {"configured": False, "lastRun": None, "ok": None, "detail": "Google Drive認証待ち"}


def severity(value, threshold_name: str, reverse=False) -> str:
    thresholds = THRESHOLDS[threshold_name]
    if value is None:
        return "unknown"
    if reverse:
        if value <= thresholds["critical"]:
            return "critical"
        if value <= thresholds["warning"]:
            return "warning"
    else:
        if value >= thresholds["critical"]:
            return "critical"
        if value >= thresholds["warning"]:
            return "warning"
    return "ok"


def derive_alerts(snapshot: dict) -> list[dict]:
    alerts = []
    checks = [
        ("cpu", "CPU使用率", snapshot["cpu"]["usedPercent"], "cpu", "%"),
        ("memory", "メモリ使用率", snapshot["memory"]["usedPercent"], "memory", "%"),
        ("swap", "Swap使用率", snapshot["memory"]["swapUsedPercent"], "swap", "%"),
        ("iowait", "ディスクI/O待ち", snapshot["cpu"]["iowaitPercent"], "iowait", "%"),
        ("packet-loss", "パケットロス", snapshot["network"]["packetLossPercent"], "packet_loss", "%"),
    ]
    for code, label, value, threshold, suffix in checks:
        level = severity(value, threshold)
        if level in ("warning", "critical"):
            alerts.append({"code": code, "severity": level, "message": f"{label} {value}{suffix}"})
    for disk in snapshot["disks"]:
        if "usedPercent" in disk:
            level = severity(disk["usedPercent"], "disk")
            if level in ("warning", "critical"):
                alerts.append({"code": "disk:" + disk["mount"], "severity": level, "message": f"{disk['mount']} 使用率 {disk['usedPercent']}%"})
    temperature = snapshot["temperature"].get("maxCelsius")
    level = severity(temperature, "temperature")
    if level in ("warning", "critical"):
        alerts.append({"code": "temperature", "severity": level, "message": f"温度 {temperature}℃"})
    for item in snapshot["docker"]:
        if item.get("name") and item.get("state") != "running":
            alerts.append({"code": "docker:" + item["name"], "severity": "critical", "message": f"Docker {item['name']} が停止"})
    for item in snapshot["pm2"]:
        if item.get("name") and item.get("status") != "online":
            alerts.append({"code": "pm2:" + item["name"], "severity": "critical", "message": f"PM2 {item['name']} が停止"})
    for item in snapshot["endpoints"]:
        if not item["ok"]:
            alerts.append({"code": "endpoint:" + item["id"], "severity": "critical", "message": f"{item['name']} 応答異常（{item['detail']}）"})
        elif item["responseMs"] >= THRESHOLDS["api_ms"]["warning"]:
            alerts.append({"code": "latency:" + item["id"], "severity": "warning", "message": f"{item['name']} 応答遅延 {item['responseMs']}ms"})
    for item in snapshot["tls"]:
        if not item.get("ok") or item.get("daysRemaining", 999) <= THRESHOLDS["tls_days"]["warning"]:
            level = "critical" if not item.get("ok") or item.get("daysRemaining", 999) <= 7 else "warning"
            alerts.append({"code": "tls:" + item["host"], "severity": level, "message": f"TLS {item['host']} 残り{item.get('daysRemaining', '?')}日"})
    if snapshot["system"]["failedServices"]:
        alerts.append({"code": "failed-services", "severity": "critical", "message": f"失敗サービス {len(snapshot['system']['failedServices'])}件"})
    if snapshot["system"]["recentOom"]:
        alerts.append({"code": "oom", "severity": "critical", "message": "直近10分にOOM Killerを検知"})
    for item in snapshot["smart"]:
        if item.get("available") and (item.get("passed") is False or item.get("reallocatedSectors", 0) or item.get("pendingSectors", 0)):
            alerts.append({"code": "smart:" + item["device"], "severity": "critical", "message": f"SMART異常 {item['device']}"})
    return alerts


def load_discord_token() -> str | None:
    for path in DISCORD_ENV_FILES:
        try:
            for line in path.read_text().splitlines():
                match = re.match(r"(?:DISCORD_TOKEN|BOT_TOKEN)=(.+)", line.strip())
                if match:
                    return match.group(1).strip().strip('"').strip("'")
        except OSError:
            continue
    return None


def send_discord(title: str, description: str, severity_name="info") -> bool:
    token = load_discord_token()
    if not token or not CHANNEL_ID:
        return False
    colors = {"critical": 0xC62828, "warning": 0xE08A00, "ok": 0x0A9B63, "info": 0x1267A3}
    body = json.dumps({"embeds": [{"title": title[:256], "description": description[:4000], "color": colors.get(severity_name, colors["info"]), "timestamp": iso_now()}]}).encode()
    request = Request(
        f"https://discord.com/api/v10/channels/{quote(CHANNEL_ID)}/messages",
        data=body,
        headers={"Authorization": "Bot " + token, "Content-Type": "application/json", "User-Agent": "TayunetMonitor/1.0"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            return response.status in (200, 201, 204)
    except (HTTPError, URLError, TimeoutError):
        return False


def redact_sensitive(value: str) -> str:
    patterns = [
        (r"https://(?:discord(?:app)?\.com)/api/webhooks/[^\s\"']+", "[DISCORD_WEBHOOK_REDACTED]"),
        (r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._-]+", r"\1[TOKEN_REDACTED]"),
        (r"(?i)((?:token|secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+", r"\1[REDACTED]"),
    ]
    result = value
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result)
    return result


def record_event(severity_name: str, code: str, message: str, detail="", notify=True) -> None:
    db_execute("INSERT INTO events(created_at,severity,code,message,detail) VALUES(?,?,?,?,?)", (iso_now(), severity_name, code, message, detail[-8000:]))
    if notify:
        safe_detail = redact_sensitive(detail[-1800:])
        send_discord("Tayunet Ubuntu監視", message + ("\n```\n" + safe_detail + "\n```" if safe_detail else ""), severity_name)


def network_diagnostics() -> str:
    sections = []
    commands = [
        ("DNS", ["getent", "hosts", "tayunet-traininfo.com"]),
        ("外部疎通", ["ping", "-c", "3", "-W", "2", "1.1.1.1"]),
        ("Cloudflare", ["ping", "-c", "3", "-W", "2", "cloudflare.com"]),
    ]
    if shutil.which("tracepath"):
        commands.append(("経路", ["tracepath", "-m", "10", "1.1.1.1"]))
    elif shutil.which("traceroute"):
        commands.append(("経路", ["traceroute", "-m", "10", "-w", "1", "1.1.1.1"]))
    for label, command in commands:
        _, output = run(command, timeout=15)
        sections.append(f"[{label}]\n{output[-1800:]}")
    return "\n\n".join(sections)


def recovery_target(code: str) -> tuple[str, str] | None:
    if code.startswith("docker:") and code.removeprefix("docker:") in DOCKER_NAMES:
        return "docker", code.removeprefix("docker:")
    if code.startswith("pm2:") and code.removeprefix("pm2:") in PM2_NAMES:
        return "pm2", code.removeprefix("pm2:")
    return AUTO_RECOVERY_MAP.get(code)


def maybe_auto_recover(item: dict) -> None:
    target = recovery_target(item["code"])
    if not target or item.get("severity") != "critical":
        return
    kind, name = target
    cutoff = datetime.fromtimestamp(time.time() - 86400, timezone.utc).isoformat()
    recent = db_rows(
        "SELECT created_at FROM actions WHERE actor='system:auto-recovery' AND kind=? AND target=? AND created_at>=? ORDER BY id DESC",
        (kind, name, cutoff),
    )
    if len(recent) >= 3:
        record_event("warning", "recovery-limit:" + item["code"], f"{kind}/{name} の自動再起動上限（24時間に3回）へ到達", notify=True)
        return
    if recent:
        try:
            last = datetime.fromisoformat(recent[0]["created_at"])
            if (datetime.now(timezone.utc) - last).total_seconds() < 900:
                return
        except (ValueError, TypeError):
            pass
    if not action_lock.acquire(blocking=False):
        return
    try:
        record_event("warning", "auto-recovery:" + item["code"], f"{kind}/{name} の安全な自動再起動を開始", notify=False)
        restart_target(kind, name, "system:auto-recovery")
    finally:
        action_lock.release()


def process_alerts(alerts: list[dict]) -> None:
    global alert_streaks, active_alerts
    seen = {item["code"] for item in alerts}
    for item in alerts:
        code = item["code"]
        alert_streaks[code] = alert_streaks.get(code, 0) + 1
        if alert_streaks[code] >= 3 and code not in active_alerts:
            active_alerts[code] = item
            target = recovery_target(code)
            if target:
                try:
                    detail = service_logs(target[0], target[1], 80)
                except (ValueError, OSError):
                    detail = "ログを取得できませんでした。"
            elif code == "packet-loss" or code.startswith("endpoint:"):
                detail = network_diagnostics()
            else:
                detail = ""
            record_event(item["severity"], code, item["message"], detail)
            maybe_auto_recover(item)
    for code in list(active_alerts):
        if code not in seen:
            previous = active_alerts.pop(code)
            alert_streaks.pop(code, None)
            record_event("ok", "recovered:" + code, "復旧: " + previous["message"])
    for code in list(alert_streaks):
        if code not in seen:
            alert_streaks.pop(code, None)


def save_snapshot(snapshot: dict) -> None:
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    now = datetime.now(timezone.utc)
    db_execute("INSERT OR REPLACE INTO metrics(collected_at,payload) VALUES(?,?)", (snapshot["collectedAt"], payload))
    five = now.replace(minute=(now.minute // 5) * 5, second=0, microsecond=0).isoformat()
    day = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    db_execute("INSERT OR REPLACE INTO rollups(bucket,granularity,payload) VALUES(?,?,?)", (five, "5m", payload))
    db_execute("INSERT OR REPLACE INTO rollups(bucket,granularity,payload) VALUES(?,?,?)", (day, "1d", payload))
    raw_cutoff = datetime.fromtimestamp(time.time() - 7 * 86400, timezone.utc).isoformat()
    five_cutoff = datetime.fromtimestamp(time.time() - 90 * 86400, timezone.utc).isoformat()
    day_cutoff = datetime.fromtimestamp(time.time() - 366 * 86400, timezone.utc).isoformat()
    db_execute("DELETE FROM metrics WHERE collected_at < ?", (raw_cutoff,))
    db_execute("DELETE FROM rollups WHERE granularity='5m' AND bucket < ?", (five_cutoff,))
    db_execute("DELETE FROM rollups WHERE granularity='1d' AND bucket < ?", (day_cutoff,))


def collect() -> dict:
    uptime_seconds = float(Path("/proc/uptime").read_text().split()[0])
    endpoints = [check_url(target) for target in PUBLIC_TARGETS]
    tls = [tls_status(urlparse(target["url"]).hostname) for target in PUBLIC_TARGETS]
    unique_tls = list({item["host"]: item for item in tls}.values())
    snapshot = {
        "status": "ok", "collectedAt": iso_now(), "hostname": socket.gethostname(),
        "uptimeSeconds": round(uptime_seconds), "cpu": read_cpu(), "memory": read_meminfo(),
        "vmstat": read_vmstat(), "disks": read_disks(), "temperature": read_temperature(),
        "network": read_network(), "docker": docker_status(), "pm2": pm2_status(),
        "endpoints": endpoints, "tls": unique_tls, "smart": smart_status(),
        "system": system_checks(), "backup": backup_status(),
        "thresholds": THRESHOLDS,
    }
    snapshot["alerts"] = derive_alerts(snapshot)
    snapshot["status"] = "critical" if any(x["severity"] == "critical" for x in snapshot["alerts"]) else "warning" if snapshot["alerts"] else "ok"
    return snapshot


def collector_loop() -> None:
    global current_state
    time.sleep(1)
    while True:
        started = time.monotonic()
        try:
            snapshot = collect()
            with state_lock:
                current_state = snapshot
            save_snapshot(snapshot)
            process_alerts(snapshot["alerts"])
        except Exception as error:
            detail = traceback.format_exc()
            with state_lock:
                current_state = {"status": "error", "collectedAt": iso_now(), "error": str(error)}
            record_event("critical", "collector-error", "監視情報の収集に失敗", detail)
        time.sleep(max(1, 60 - (time.monotonic() - started)))


class AuthError(Exception):
    def __init__(self, code: str, status=401):
        super().__init__(code)
        self.code = code
        self.status = status


def request_json(request: Request, timeout=8) -> dict:
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code in (400, 401, 403, 404):
            raise AuthError("firebase_token_invalid", 401) from error
        raise AuthError("firebase_unavailable", 503) from error
    except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        raise AuthError("firebase_unavailable", 503) from error


def verify_admin(token: str) -> dict:
    if not token:
        raise AuthError("firebase_token_required", 401)
    key = hashlib.sha256(token.encode()).hexdigest()
    cached = auth_cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    lookup = request_json(Request(
        "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + quote(FIREBASE_API_KEY, safe=""),
        data=json.dumps({"idToken": token}).encode(), headers={"Content-Type": "application/json"}, method="POST",
    ))
    users = lookup.get("users") or []
    user = users[0] if users else {}
    uid, email = user.get("localId"), user.get("email", "").lower()
    if not uid or email not in ALLOWED_EMAILS:
        raise AuthError("administrator_required", 403)
    document = request_json(Request(
        f"https://firestore.googleapis.com/v1/projects/{quote(FIREBASE_PROJECT_ID)}/databases/(default)/documents/users/{quote(uid)}",
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"}, method="GET",
    ))
    fields = document.get("fields") or {}
    approved = fields.get("approved", {}).get("booleanValue") is True
    active = fields.get("status", {}).get("stringValue") == "active"
    disabled = fields.get("disabled", {}).get("booleanValue") is True
    is_admin = fields.get("isAdmin", {}).get("booleanValue") is True
    if not approved or not active or disabled or not is_admin:
        raise AuthError("administrator_required", 403)
    identity = {"uid": uid, "email": email}
    auth_cache[key] = (time.monotonic() + 60, identity)
    return identity


def service_logs(kind: str, target: str, lines=80) -> str:
    lines = max(20, min(200, int(lines)))
    if kind == "docker" and target in DOCKER_NAMES:
        return run(["docker", "logs", "--tail", str(lines), "--timestamps", target], timeout=15)[1][-30000:]
    if kind == "pm2" and target in PM2_NAMES:
        return run([PM2_BIN, "logs", target, "--nostream", "--lines", str(lines)], timeout=15)[1][-30000:]
    raise ValueError("target_not_allowed")


def restart_target(kind: str, target: str, actor: str) -> dict:
    if kind == "docker" and target in DOCKER_NAMES:
        before = service_logs(kind, target, 60)
        code, output = run(["docker", "restart", "--time", "20", target], timeout=45)
        time.sleep(2)
        after = service_logs(kind, target, 40)
    elif kind == "pm2" and target in PM2_NAMES:
        before = service_logs(kind, target, 60)
        code, output = run([PM2_BIN, "restart", target], timeout=30)
        time.sleep(2)
        after = service_logs(kind, target, 40)
    else:
        raise ValueError("target_not_allowed")
    success = code == 0
    detail = f"command: {output[-1000:]}\n\n--- before ---\n{before[-5000:]}\n\n--- after ---\n{after[-5000:]}"
    db_execute("INSERT INTO actions(created_at,actor,kind,target,action,success,detail) VALUES(?,?,?,?,?,?,?)", (iso_now(), actor, kind, target, "restart", 1 if success else 0, detail))
    send_discord(
        "手動再起動 " + ("成功" if success else "失敗"),
        f"実行者: {actor}\n対象: {kind}/{target}\n結果: {output[-1200:]}",
        "ok" if success else "critical",
    )
    return {"ok": success, "kind": kind, "target": target, "detail": output[-2000:]}


class Handler(BaseHTTPRequestHandler):
    server_version = "TayunetServerMonitor/1.0"

    def origin(self) -> str | None:
        value = self.headers.get("Origin", "")
        return value if value in ALLOWED_ORIGINS else None

    def token(self) -> str:
        authorization = self.headers.get("Authorization", "")
        scheme, separator, value = authorization.partition(" ")
        return value.strip() if separator and scheme.lower() == "bearer" else ""

    def send_json(self, status: int, payload: dict | list) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        origin = self.origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorize(self) -> dict:
        if not self.origin():
            raise AuthError("origin_not_allowed", 403)
        return verify_admin(self.token())

    def do_OPTIONS(self):
        if not self.origin():
            return self.send_json(403, {"error": "origin_not_allowed"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.origin())
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path)
        request_path = path.path.removeprefix("/server-monitor")
        try:
            if request_path == "/health":
                with state_lock:
                    return self.send_json(200, {"ok": True, "status": current_state.get("status"), "collectedAt": current_state.get("collectedAt")})
            identity = self.authorize()
            if request_path == "/api/status":
                with state_lock:
                    return self.send_json(200, current_state)
            if request_path == "/api/history":
                query = parse_qs(path.query)
                granularity = query.get("granularity", ["raw"])[0]
                limit = max(10, min(2000, int(query.get("limit", ["720"])[0])))
                if granularity == "raw":
                    rows = db_rows("SELECT collected_at AS at,payload FROM metrics ORDER BY collected_at DESC LIMIT ?", (limit,))
                elif granularity in ("5m", "1d"):
                    rows = db_rows("SELECT bucket AS at,payload FROM rollups WHERE granularity=? ORDER BY bucket DESC LIMIT ?", (granularity, limit))
                else:
                    return self.send_json(400, {"error": "invalid_granularity"})
                return self.send_json(200, [{"at": row["at"], "metrics": json.loads(row["payload"])} for row in reversed(rows)])
            if request_path == "/api/events":
                return self.send_json(200, db_rows("SELECT * FROM events ORDER BY id DESC LIMIT 200"))
            if request_path == "/api/actions":
                return self.send_json(200, db_rows("SELECT id,created_at,actor,kind,target,action,success,detail FROM actions ORDER BY id DESC LIMIT 100"))
            if request_path == "/api/logs":
                query = parse_qs(path.query)
                kind = query.get("kind", [""])[0]
                target = query.get("target", [""])[0]
                return self.send_json(200, {"kind": kind, "target": target, "logs": service_logs(kind, target, query.get("lines", ["80"])[0])})
            if request_path == "/api/config":
                return self.send_json(200, {"admins": sorted(ALLOWED_EMAILS), "channelId": CHANNEL_ID, "dockerTargets": sorted(DOCKER_NAMES), "pm2Targets": sorted(PM2_NAMES), "thresholds": THRESHOLDS, "actor": identity["email"]})
            return self.send_json(404, {"error": "not_found"})
        except AuthError as error:
            return self.send_json(error.status, {"error": error.code})
        except (ValueError, OSError) as error:
            return self.send_json(400, {"error": str(error)})
        except Exception:
            return self.send_json(500, {"error": "internal_error"})

    def do_POST(self):
        try:
            identity = self.authorize()
            length = min(int(self.headers.get("Content-Length", "0")), 16384)
            payload = json.loads(self.rfile.read(length) or b"{}")
            if urlparse(self.path).path.removeprefix("/server-monitor") != "/api/action":
                return self.send_json(404, {"error": "not_found"})
            if payload.get("action") != "restart" or payload.get("confirm") != payload.get("target"):
                return self.send_json(400, {"error": "confirmation_required"})
            if not action_lock.acquire(blocking=False):
                return self.send_json(409, {"error": "action_in_progress"})
            try:
                result = restart_target(str(payload.get("kind", "")), str(payload.get("target", "")), identity["email"])
            finally:
                action_lock.release()
            return self.send_json(200 if result["ok"] else 500, result)
        except AuthError as error:
            return self.send_json(error.status, {"error": error.code})
        except (ValueError, json.JSONDecodeError) as error:
            return self.send_json(400, {"error": str(error)})
        except Exception:
            return self.send_json(500, {"error": "internal_error"})

    def log_message(self, *_args):
        return


def main() -> None:
    init_db()
    threading.Thread(target=collector_loop, daemon=True, name="collector").start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
