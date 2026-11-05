#!/usr/bin/env python3
"""JR貨物の輸送状況を取得し、閲覧用の静的HTMLを生成する。"""

from __future__ import annotations

import argparse
import html
import json
import os
import unicodedata
import re
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup, NavigableString, Tag


SOURCE_URL = "https://www.jrfreight.co.jp/i_daiya.html"
USER_AGENT = "jr-freight-status-viewer/1.0 (+GitHub Actions; public status page reader)"
JST = ZoneInfo("Asia/Tokyo")


@dataclass
class Section:
    name: str
    trains: list[tuple[str, str, str]]


@dataclass
class Status:
    published_date: str
    as_of: str
    title: str
    incidents: list[tuple[str, str]]
    sections: list[Section]


def clean(value: str) -> str:
    return re.sub(r"[ \t\u3000]+", " ", value).strip()


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace").encode("utf-8")


def section_lines(heading: Tag, content: Tag) -> list[str]:
    """Preserve BR/paragraph boundaries without splitting inline spans into rows."""
    chunks = []
    for node in heading.next_elements:
        if isinstance(node, Tag) and node.name == "h2":
            break
        if content not in node.parents:
            break
        if isinstance(node, Tag) and node.name in ("br", "p", "li", "tr"):
            chunks.append("\n")
        elif isinstance(node, NavigableString) and node.parent.name not in ("h2", "script", "style"):
            chunks.append(str(node))
    return [line.strip() for line in "".join(chunks).splitlines() if line.strip()]


def parse_train(line: str) -> tuple[str, str, str]:
    normalized = unicodedata.normalize("NFKC", line)
    service = re.match(r"^((?:\d{1,2}日発)?[\d～〜~・、/\-\s]+列車(?:\s*\([^)]*\))?)\s*(.*)$", normalized)
    if not service:
        raise ValueError(f"列車情報の形式を認識できません: {clean(line)}")
    tail = service.group(2)
    state = re.search(r"[+]\s*\d|(?:約)?\d+\s*(?:時間|分)|運休|抑止|停車|遅延|定時|運転再開|運転見合わせ", tail)
    if state:
        place, status = tail[:state.start()], tail[state.start():]
    else:
        parts = re.split(r"\s{2,}", tail.strip(), maxsplit=1)
        if len(parts) != 2:
            raise ValueError(f"現在地と状況を分離できません: {clean(line)}")
        place, status = parts
    # Full-width spaces inside station names are typography, not column breaks.
    place = re.sub(r"\s+", "", place)
    if not place or not status.strip():
        raise ValueError(f"現在地または状況が空です: {clean(line)}")
    return clean(service.group(1)), place, clean(status)


class OutsideServiceHours(Exception):
    """The official provider explicitly suspends its report outside service hours."""


def parse(source: bytes) -> Status:
    soup = BeautifulSoup(source.decode("utf-8-sig"), "html.parser")
    notice = soup.select_one("#pbBlock91536")
    if soup.select_one(".base_daiya .day") and notice and "サービス時間外" in notice.get_text():
        raise OutsideServiceHours("JR貨物公式サイトはサービス時間外です")
    content = soup.select_one(".base_daiya-content")
    if content is None:
        raise ValueError("輸送状況の本文が見つかりません（サイト構造が変わった可能性があります）")
    day = soup.select_one(".base_daiya .day")
    date_match = re.search(r"\d{4}年\d{1,2}月\d{1,2}日", day.get_text() if day else "")
    time_node = soup.select_one(".base_daiya .time")
    if not date_match or not time_node or not re.search(r"\d+時", time_node.get_text()):
        raise ValueError("公式発表の日付または時刻を取得できません")
    headings = content.find_all("h2")
    overview_heading = next((h for h in headings if "発生時刻" in clean(h.get_text())), None)
    route_heading = next((h for h in headings if "線区" in re.sub(r"\s+", "", h.get_text())), None)
    if overview_heading is None or route_heading is None:
        raise ValueError("概要または線区の見出しが見つかりません")
    title_heading = next((h for h in soup.find_all("h2") if re.sub(r"\s+", "", h.get_text()) == "標題"), None)
    title_node = title_heading.find_next("p") if title_heading else soup.select_one("#pbBlock91536")
    incidents: list[tuple[str, str]] = []
    for line in section_lines(overview_heading, content):
        line = clean(line)
        match = re.match(r"^[（(]\d+[）)]\s*(.*)", line)
        if match:
            incidents.append((match.group(1), ""))
        elif incidents:
            when, detail = incidents[-1]
            incidents[-1] = (when, clean(f"{detail} {line}"))
    sections: list[Section] = []
    current: Section | None = None
    for line in section_lines(route_heading, content):
        header = re.match(r"^[<＜](.+?)[>＞]$", line)
        if header:
            current = Section(clean(header.group(1)), [])
            sections.append(current)
        elif "列車" in line and re.search(r"\d", line):
            if current is None:
                raise ValueError("列車情報の線区が不明です")
            current.trains.append(parse_train(line))
        elif current and not line.startswith(("※", "注")):
            raise ValueError(f"未対応の線区情報があります: {clean(line)}")
    if not any(section.trains for section in sections) and not incidents:
        if not re.search(r"ありません|平常|正常|定刻", content.get_text()):
            raise ValueError("障害情報も列車情報も取得できませんでした")
    return Status(
        published_date=date_match.group(0),
        as_of=clean(time_node.get_text(" ", strip=True)),
        title=clean(title_node.get_text(" ", strip=True)) if title_node else "JR貨物 輸送状況",
        incidents=incidents,
        sections=[section for section in sections if section.trains],
    )


def departure_date(service: str, published: datetime) -> str | None:
    match = re.match(r"(\d{1,2})日発", service)
    if not match:
        return None
    day = int(match.group(1))
    # A report at the start of a month may contain trains from last month.
    for offset in range(32):
        candidate = published - timedelta(days=offset)
        if candidate.day == day:
            return candidate.date().isoformat()
    raise ValueError("列車の出発日が不正です")


def as_json(data: Status, fetched_at: datetime) -> dict:
    published = datetime.strptime(data.published_date, "%Y年%m月%d日").replace(tzinfo=JST)
    routes = []
    for section in data.sections:
        trains = []
        for service, location, status in section.trains:
            number_text = re.sub(r"^\d+日発", "", service.split("列車")[0])
            trains.append({"service": service, "location": location, "status": status, "route": section.name,
                           "trainNumbers": [str(int(n)) for n in re.findall(r"\d+", number_text)],
                           "departureDate": departure_date(service, published)})
        routes.append({"name": section.name, "trains": trains})
    return {"ok": True, "announcementDate": data.published_date, "asOf": data.as_of, "title": data.title,
            "incidents": [{"time": when, "detail": detail} for when, detail in data.incidents],
            "routes": routes, "trains": [train for route in routes for train in route["trains"]],
            "fetchedLabel": fetched_at.strftime("%Y年%m月%d日 %H:%M JST"), "source": SOURCE_URL,
            "proxiedAt": fetched_at.isoformat()}


def atomic_write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    os.replace(temporary, path)


def status_class(status: str) -> str:
    if "停車" in status or "運休" in status:
        return "danger"
    if "+" in status or "遅" in status:
        return "delay"
    return "normal"


def render(data: Status, fetched_at: datetime) -> str:
    esc = html.escape
    incidents = "".join(
        f'<li><time>{esc(when)}</time><p>{esc(detail)}</p></li>' for when, detail in data.incidents
    ) or '<li class="empty">現在、掲載中の障害概要はありません。</li>'
    cards = []
    train_count = 0
    for section in data.sections:
        train_count += len(section.trains)
        rows = "".join(
            f'<tr><td data-label="列車">{esc(train)}</td><td data-label="現在地">{esc(place)}</td>'
            f'<td data-label="状況"><span class="status {status_class(state)}">{esc(state)}</span></td></tr>'
            for train, place, state in section.trains
        )
        cards.append(
            f'<section class="route"><div class="route-head"><h2>{esc(section.name)}</h2>'
            f'<span>{len(section.trains)}列車</span></div><div class="table-wrap"><table><thead><tr>'
            f'<th>列車</th><th>現在地</th><th>状況</th></tr></thead><tbody>{rows}</tbody></table></div></section>'
        )
    routes = "".join(cards) or '<div class="empty-card">現在、掲載中の列車情報はありません。</div>'
    fetched = fetched_at.strftime("%Y年%-m月%-d日 %H:%M")
    return f'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="JR貨物公式サイトの公開情報を見やすく表示します">
<title>JR貨物 輸送状況</title><style>
:root{{--navy:#112b46;--blue:#1768ac;--sky:#eaf4fb;--ink:#17232e;--muted:#607181;--line:#dce5ec;--paper:#fff;--delay:#c55a00;--danger:#b42318}}*{{box-sizing:border-box}}body{{margin:0;background:#f3f6f8;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif;line-height:1.65}}a{{color:inherit}}.hero{{background:linear-gradient(120deg,var(--navy),#164e78);color:#fff;padding:42px 20px 70px}}.hero-inner,main,.footer-inner{{width:min(1080px,calc(100% - 32px));margin:auto}}.eyebrow{{margin:0 0 8px;letter-spacing:.15em;font-size:.78rem;font-weight:700;color:#bfe5ff}}h1{{margin:0;font-size:clamp(1.8rem,5vw,3rem);letter-spacing:.04em}}.hero-meta{{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}}.pill{{padding:5px 12px;border:1px solid #ffffff55;border-radius:999px;background:#ffffff12;font-size:.85rem}}main{{margin-top:-38px;padding-bottom:56px}}.summary,.route,.empty-card{{background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 30px #16324a12}}.summary{{padding:clamp(20px,4vw,34px);margin-bottom:28px}}.summary-label{{color:var(--blue);font-size:.78rem;font-weight:800;letter-spacing:.12em}}.summary h2{{font-size:clamp(1.15rem,3vw,1.55rem);margin:5px 0 22px;line-height:1.45}}.incidents{{list-style:none;margin:0;padding:0;display:grid;gap:0}}.incidents li{{display:grid;grid-template-columns:minmax(190px,280px) 1fr;gap:18px;padding:15px 0;border-top:1px solid var(--line)}}.incidents time{{font-size:.88rem;font-weight:700;color:var(--muted)}}.incidents p{{margin:0;font-weight:600}}.section-title{{display:flex;align-items:end;justify-content:space-between;margin:36px 2px 14px}}.section-title h2{{font-size:1.35rem;margin:0}}.section-title span{{font-size:.85rem;color:var(--muted)}}.routes{{display:grid;gap:18px}}.route{{overflow:hidden}}.route-head{{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;background:var(--sky);border-bottom:1px solid var(--line)}}.route-head h2{{margin:0;font-size:1.08rem}}.route-head span{{font-size:.78rem;color:var(--muted);white-space:nowrap}}table{{width:100%;border-collapse:collapse;font-size:.91rem}}th,td{{padding:13px 18px;text-align:left;border-bottom:1px solid var(--line)}}th{{color:var(--muted);font-size:.76rem;letter-spacing:.08em}}tr:last-child td{{border-bottom:0}}th:nth-child(2),td:nth-child(2){{width:15%;white-space:nowrap}}th:nth-child(3),td:nth-child(3){{width:22%;white-space:nowrap}}.status{{font-weight:750}}.status.delay{{color:var(--delay)}}.status.danger{{color:var(--danger)}}.empty,.empty-card{{padding:24px;color:var(--muted)}}footer{{border-top:1px solid var(--line);background:#fff;padding:25px 0;color:var(--muted);font-size:.8rem}}.footer-inner{{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}}.source{{color:var(--blue);font-weight:700;text-decoration:none}}@media(max-width:700px){{.hero{{padding-top:30px}}.incidents li{{grid-template-columns:1fr;gap:3px}}thead{{display:none}}tr{{display:block;padding:11px 16px;border-bottom:1px solid var(--line)}}tr:last-child{{border:0}}td{{display:grid;grid-template-columns:66px 1fr;width:auto!important;padding:4px 0;border:0;white-space:normal!important}}td:before{{content:attr(data-label);color:var(--muted);font-size:.75rem;font-weight:700}}}}
</style><script src="/assets/js/back-navigation.js" defer></script><script src="/assets/js/freight-status-client.js?v=20261105-live" defer></script><script src="/assets/js/freight-report-health.js?v=20261105-live" defer></script></head><body><header class="hero"><div class="hero-inner"><p class="eyebrow">FREIGHT OPERATION STATUS</p><h1>JR貨物 輸送状況</h1><div class="hero-meta"><span class="pill">公式発表 {esc(data.published_date)}</span><span class="pill">{esc(data.as_of)}</span></div></div></header><main><section class="summary"><div class="summary-label">運行への影響</div><h2>{esc(data.title)}</h2><ol class="incidents">{incidents}</ol></section><div class="section-title"><h2>遅延列車</h2><span>{len(data.sections)}線区・{train_count}列車</span></div><div class="routes">{routes}</div></main><footer><div class="footer-inner"><span>最終取得: {esc(fetched)} JST</span><a class="source" href="{SOURCE_URL}" target="_blank" rel="noopener">JR貨物 公式情報 ↗</a></div></footer></body></html>'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="テスト用の取得済みHTML")
    parser.add_argument("--output", type=Path, default=Path("index.html"))
    parser.add_argument("--json-output", type=Path, help="同じ取得結果を輸送計画画面のJSONにも出力")
    parser.add_argument("--health-output", type=Path, help="取得結果と監視時刻を保存")
    args = parser.parse_args()
    attempted_at = datetime.now(JST).isoformat()
    previous_health = {}
    if args.health_output:
        try:
            previous_health = json.loads(args.health_output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    def health(ok, error=None, available=True, reason=None):
        if args.health_output:
            atomic_write(args.health_output, json.dumps({"ok": ok, "checkedAt": attempted_at,
                "lastSuccessAt": datetime.now(JST).isoformat() if ok and available else previous_health.get("lastSuccessAt"),
                "error": error, "available": available, "reason": reason, "source": SOURCE_URL}, ensure_ascii=False, indent=2) + "\n")
    try:
        if args.input:
            source = args.input.read_bytes()
            data = parse(source)
        else:
            for attempt in range(3):
                try:
                    source = fetch(SOURCE_URL)
                    data = parse(source)
                    break
                except (OSError, TimeoutError, ValueError):
                    if attempt == 2:
                        raise
                    time.sleep(2 ** attempt)
        fetched_at = datetime.now(JST)
        output = render(data, fetched_at)
        json_output = json.dumps(as_json(data, fetched_at), ensure_ascii=False, indent=2) + "\n"
        atomic_write(args.output, output)
        if args.json_output:
            atomic_write(args.json_output, json_output)
        health(True)
        print(f"生成完了: {args.output} ({len(data.incidents)}件の概要、{len(data.sections)}線区)")
        return 0
    except OutsideServiceHours as exc:
        health(True, available=False, reason="outside_service_hours")
        print(f"{exc}。前回の輸送情報と取得成功日時を保持します。")
        return 0
    except Exception as exc:
        health(False, f"{type(exc).__name__}: {exc}")
        print(f"エラー: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
