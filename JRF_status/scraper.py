#!/usr/bin/env python3
"""JR貨物の輸送状況を取得し、閲覧用の静的HTMLを生成する。"""

from __future__ import annotations

import argparse
import html
import re
import sys
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup


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


def parse(source: bytes) -> Status:
    soup = BeautifulSoup(source, "html.parser")
    content = soup.select_one(".base_daiya-content")
    if content is None:
        raise ValueError("輸送状況の本文が見つかりません（サイト構造が変わった可能性があります）")

    day = soup.select_one(".base_daiya .day")
    day_text = clean(day.get_text(" ", strip=True)) if day else ""
    date_match = re.search(r"\d{4}年\d{1,2}月\d{1,2}日", day_text)
    time_node = soup.select_one(".base_daiya .time")
    title_node = soup.select_one("#pbBlock91536")

    headings = content.find_all("h2")
    overview_heading = next((h for h in headings if "発生時刻" in clean(h.get_text())), None)
    route_heading = next((h for h in headings if "線" in clean(h.get_text()).replace(" ", "")), None)
    if overview_heading is None or route_heading is None:
        raise ValueError("概要または線区の見出しが見つかりません")

    overview_p = overview_heading.find_next("p")
    route_p = route_heading.find_next("p")
    if overview_p is None or route_p is None:
        raise ValueError("概要または列車情報が見つかりません")

    overview_lines = [clean(line) for line in overview_p.get_text("\n").splitlines() if clean(line)]
    incidents: list[tuple[str, str]] = []
    i = 0
    while i < len(overview_lines):
        if re.match(r"^\(\d+\)", overview_lines[i]):
            when = re.sub(r"^\(\d+\)", "", overview_lines[i]).strip()
            detail = overview_lines[i + 1] if i + 1 < len(overview_lines) else ""
            incidents.append((when, detail))
            i += 2
        else:
            if incidents:
                when, detail = incidents[-1]
                incidents[-1] = (when, clean(f"{detail} {overview_lines[i]}"))
            i += 1

    # 列車・現在地・状況の区切りには複数の全角空白が使われるため、
    # この段階では空白を正規化しない。
    route_lines = [line.strip() for line in route_p.get_text("\n").splitlines() if line.strip()]
    sections: list[Section] = []
    current: Section | None = None
    for line in route_lines:
        header = re.match(r"^[<＜](.+?)[>＞]$", line)
        if header:
            current = Section(clean(header.group(1)), [])
            sections.append(current)
            continue
        if current is None:
            continue
        # 元ページは列車・現在地・遅延を全角スペースで桁揃えしている。
        parts = [clean(p) for p in re.split(r"(?:\u3000| ){2,}", line) if clean(p)]
        if len(parts) >= 3:
            current.trains.append((parts[0], parts[1], " ".join(parts[2:])))
        else:
            # 空白の仕様変更時にもデータを捨てず、列車情報として表示する。
            current.trains.append((line, "—", "—"))

    if not incidents and not sections:
        raise ValueError("障害情報も列車情報も取得できませんでした")

    return Status(
        published_date=date_match.group(0) if date_match else "日付不明",
        as_of=clean(time_node.get_text(" ", strip=True)) if time_node else "時刻不明",
        title=clean(title_node.get_text(" ", strip=True)) if title_node else "JR貨物 輸送状況",
        incidents=incidents,
        sections=[s for s in sections if s.trains],
    )


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
</style></head><body><header class="hero"><div class="hero-inner"><p class="eyebrow">FREIGHT OPERATION STATUS</p><h1>JR貨物 輸送状況</h1><div class="hero-meta"><span class="pill">公式発表 {esc(data.published_date)}</span><span class="pill">{esc(data.as_of)}</span></div></div></header><main><section class="summary"><div class="summary-label">運行への影響</div><h2>{esc(data.title)}</h2><ol class="incidents">{incidents}</ol></section><div class="section-title"><h2>遅延列車</h2><span>{len(data.sections)}線区・{train_count}列車</span></div><div class="routes">{routes}</div></main><footer><div class="footer-inner"><span>最終取得: {esc(fetched)} JST</span><a class="source" href="{SOURCE_URL}" target="_blank" rel="noopener">JR貨物 公式情報 ↗</a></div></footer></body></html>'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="テスト用の取得済みHTML")
    parser.add_argument("--output", type=Path, default=Path("index.html"))
    args = parser.parse_args()
    try:
        source = args.input.read_bytes() if args.input else fetch(SOURCE_URL)
        data = parse(source)
        output = render(data, datetime.now(JST))
        args.output.write_text(output, encoding="utf-8")
        print(f"生成完了: {args.output} ({len(data.incidents)}件の概要、{len(data.sections)}線区)")
        return 0
    except Exception as exc:
        print(f"エラー: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
