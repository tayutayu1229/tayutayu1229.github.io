#!/usr/bin/env python3
"""JR東日本のニュースリリース・お知らせをDiscordへ通知する。"""

from __future__ import annotations

import argparse
import html as html_module
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


SOURCES = {
    "press": ("ニュースリリース", "https://www.jreast.co.jp/press/"),
    "information": ("お知らせ", "https://www.jreast.co.jp/information/"),
}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36"
)


@dataclass(frozen=True)
class Item:
    source: str
    source_label: str
    date: str
    title: str
    url: str
    areas: tuple[str, ...]
    genres: tuple[str, ...]

    @property
    def key(self) -> str:
        return self.url


class ListingParser(HTMLParser):
    """現在のJR東日本一覧ページのli構造を解析する。"""

    def __init__(self, source: str, source_label: str, base_url: str):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.source_label = source_label
        self.base_url = base_url
        self.depth = 0
        self.current: dict | None = None
        self.capture: str | None = None
        self.items: list[Item] = []

    @staticmethod
    def _classes(attrs: list[tuple[str, str | None]]) -> set[str]:
        value = dict(attrs).get("class") or ""
        return set(value.split())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        classes = self._classes(attrs)
        if tag == "li" and self.current is None:
            self.current = {"depth": self.depth, "date": "", "title": "", "url": "", "areas": [], "genres": []}
        self.depth += 1
        if self.current is None:
            return
        if tag == "p" and "date" in classes:
            self.capture = "date"
        elif tag == "span" and "area" in classes:
            self.capture = "area"
        elif tag == "span" and "genre" in classes:
            self.capture = "genre"
        elif tag == "a" and self.capture != "title":
            href = dict(attrs).get("href") or ""
            if "/press/" in href or "/info/" in href:
                self.current["url"] = urljoin(self.base_url, href)
                self.capture = "title"

    def handle_data(self, data: str) -> None:
        if self.current is None or not self.capture:
            return
        text = " ".join(data.split())
        if not text or "別ウィンドウ" in text:
            return
        if self.capture in ("date", "title"):
            self.current[self.capture] += text
        elif self.capture == "area":
            self.current["areas"].append(text)
        elif self.capture == "genre":
            self.current["genres"].append(text)

    def handle_endtag(self, tag: str) -> None:
        self.depth -= 1
        if tag in ("p", "span", "a"):
            self.capture = None
        if tag == "li" and self.current is not None and self.depth == self.current["depth"]:
            row = self.current
            self.current = None
            if row["date"] and row["title"] and row["url"]:
                title = re.sub(r"\s*\[PDF/[^]]+\]\s*$", "", row["title"], flags=re.I)
                self.items.append(Item(
                    self.source, self.source_label, row["date"], title, row["url"],
                    tuple(row["areas"]), tuple(row["genres"]),
                ))


def fetch(url: str, attempts: int = 3) -> str:
    request = Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en-US;q=0.9",
    })
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
            if "Access Denied" in body or "errors.edgesuite.net" in body:
                raise RuntimeError("JR東日本サイトからアクセスを拒否されました")
            return body
        except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{url} の取得に失敗しました: {last_error}")


def parse_listing(source: str, html: str) -> list[Item]:
    label, url = SOURCES[source]
    parser = ListingParser(source, label, url)
    parser.feed(html)
    if not parser.items:
        raise RuntimeError(f"{label}を1件も解析できませんでした（ページ構造が変わった可能性があります）")
    return parser.items


def load_seen(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    return set(data.get("seen", []))


def save_seen(path: Path, seen: Iterable[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    values = list(dict.fromkeys(seen))[-5000:]
    path.write_text(json.dumps({"seen": values}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save_items(path: Path, items: list[Item]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_items(path: Path) -> list[Item]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Item(
        row["source"], row["source_label"], row["date"], row["title"], row["url"],
        tuple(row.get("areas", [])), tuple(row.get("genres", [])),
    ) for row in data]


def discord_embed(item: Item) -> dict:
    tags = " / ".join((*item.areas, *item.genres)) or "区分なし"
    return {
        "title": item.title[:256],
        "url": item.url,
        "description": f"{item.date}\n{tags}"[:4096],
        "color": 0x008542 if item.source == "press" else 0x4A90E2,
        "footer": {"text": f"JR東日本・{item.source_label}"},
    }


def post_discord(webhook_url: str, items: list[Item]) -> None:
    for offset in range(0, len(items), 10):
        batch = items[offset:offset + 10]
        payload = json.dumps({
            "username": "JR東日本 新着通知",
            "content": f"JR東日本から新着が{len(batch)}件あります。",
            "embeds": [discord_embed(item) for item in batch],
        }, ensure_ascii=False).encode("utf-8")
        request = Request(webhook_url, data=payload, headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}, method="POST")
        try:
            with urlopen(request, timeout=30) as response:
                response.read()
        except (HTTPError, URLError, TimeoutError) as error:
            raise RuntimeError(f"Discordへの送信に失敗しました: {error}") from error


def render_site(items: list[Item], output_dir: Path, error_message: str | None = None) -> None:
    """取得結果からGitHub Pages用の静的サイトを生成する。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    updated_at = datetime.now(ZoneInfo("Asia/Tokyo")).strftime("%Y年%m月%d日 %H:%M")
    rows = []
    for item in items:
        tags = (*item.areas, *item.genres)
        tag_html = "".join(f'<span class="tag">{html_module.escape(tag)}</span>' for tag in tags)
        searchable = " ".join((item.title, item.source_label, *tags)).lower()
        rows.append(f'''<article class="card" data-source="{item.source}" data-search="{html_module.escape(searchable, quote=True)}">
  <div class="meta"><span class="kind {item.source}">{html_module.escape(item.source_label)}</span><time>{html_module.escape(item.date)}</time></div>
  <h2><a href="{html_module.escape(item.url, quote=True)}" target="_blank" rel="noopener noreferrer">{html_module.escape(item.title)}</a></h2>
  <div class="tags">{tag_html}</div>
</article>''')

    alert_html = ""
    if error_message:
        alert_html = f'''<aside class="alert" role="status"><strong>最新情報を取得できませんでした</strong><br>
        JR東日本サイトへのアクセスが拒否されたか、一時的な通信障害が発生しています。前回取得できた情報を表示しています。<br>
        <small>{html_module.escape(error_message)}</small></aside>'''
    document = f'''<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="JR東日本のニュースリリースとお知らせの新着一覧">
  <title>JR東日本 新着ウォッチ</title>
  <style>
    :root{{--green:#007a45;--deep:#0b2b22;--blue:#176b9c;--paper:#f4f7f5;--line:#dce5e0;--muted:#61716a}}
    *{{box-sizing:border-box}} body{{margin:0;color:#17221e;background:var(--paper);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif}}
    header{{background:linear-gradient(125deg,var(--deep),#075b3b);color:white;padding:56px 20px 46px}}
    .wrap{{width:min(1040px,calc(100% - 32px));margin:auto}} .eyebrow{{font-size:.78rem;letter-spacing:.15em;font-weight:700;opacity:.75}}
    h1{{font-size:clamp(2rem,5vw,3.5rem);line-height:1.1;margin:.35em 0 .25em}} header p{{margin:0;opacity:.82}}
    .controls{{display:grid;grid-template-columns:1fr auto;gap:12px;margin:28px 0 16px}}
    .alert{{margin:24px 0 -10px;padding:16px 18px;border:1px solid #e2ad43;border-left:5px solid #d88916;border-radius:10px;background:#fff7e5;color:#67430b;line-height:1.65}} .alert small{{opacity:.78}}
    input{{width:100%;font:inherit;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:white;outline:none}}
    input:focus{{border-color:var(--green);box-shadow:0 0 0 3px #007a4522}}
    .filters{{display:flex;gap:8px}} button{{border:1px solid var(--line);background:white;border-radius:999px;padding:10px 14px;font-weight:700;cursor:pointer}}
    button.active{{color:white;background:var(--green);border-color:var(--green)}} .summary{{color:var(--muted);font-size:.9rem;margin-bottom:14px}}
    #list{{display:grid;gap:12px;padding-bottom:60px}} .card{{background:white;border:1px solid var(--line);border-radius:14px;padding:20px 22px;box-shadow:0 4px 16px #173b2c0b}}
    .meta{{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:.85rem}} .kind{{color:white;background:var(--green);border-radius:5px;padding:4px 8px;font-weight:700}}
    .kind.information{{background:var(--blue)}} h2{{font-size:1.05rem;line-height:1.6;margin:10px 0}} h2 a{{color:inherit;text-decoration:none}} h2 a:hover{{color:var(--green);text-decoration:underline}}
    .tags{{display:flex;flex-wrap:wrap;gap:6px}} .tag{{font-size:.75rem;background:#eef3f0;color:#51615a;padding:4px 7px;border-radius:4px}}
    .empty{{display:none;text-align:center;padding:60px;color:var(--muted)}} footer{{border-top:1px solid var(--line);padding:26px 16px;text-align:center;color:var(--muted);font-size:.78rem;background:white}}
    @media(max-width:700px){{header{{padding-top:40px}}.controls{{grid-template-columns:1fr}}.filters button{{flex:1;padding:9px 5px;font-size:.8rem}}.card{{padding:17px}}}}
  </style>
</head>
<body>
  <header><div class="wrap"><div class="eyebrow">EAST JAPAN RAILWAY NEWS</div><h1>JR東日本 新着ウォッチ</h1><p>ニュースリリースとお知らせを、ひとつの場所で。</p></div></header>
  <main class="wrap">
    {alert_html}
    <div class="controls"><input id="search" type="search" placeholder="キーワード・地域・ジャンルで検索" aria-label="一覧を検索"><div class="filters" aria-label="種別で絞り込み"><button class="active" data-filter="all">すべて</button><button data-filter="press">ニュース</button><button data-filter="information">お知らせ</button></div></div>
    <div class="summary"><span id="count">{len(items)}</span>件を表示 ・ 最終更新 {updated_at}</div>
    <section id="list">{''.join(rows)}</section><div class="empty" id="empty">条件に一致する情報はありません。</div>
  </main>
  <footer>JR東日本の公式サイトではありません。掲載内容の詳細はリンク先の公式資料をご確認ください。</footer>
  <script>
    const cards=[...document.querySelectorAll('.card')], search=document.querySelector('#search'), count=document.querySelector('#count'), empty=document.querySelector('#empty'); let filter='all';
    function update(){{const q=search.value.trim().toLowerCase();let n=0;cards.forEach(c=>{{const show=(filter==='all'||c.dataset.source===filter)&&(!q||c.dataset.search.includes(q));c.hidden=!show;if(show)n++}});count.textContent=n;empty.style.display=n?'none':'block'}}
    search.addEventListener('input',update);document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));update()}}));
  </script>
</body></html>'''
    (output_dir / "index.html").write_text(document, encoding="utf-8")
    (output_dir / "items.json").write_text(
        json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / ".nojekyll").touch()


def main() -> int:
    argp = argparse.ArgumentParser(description=__doc__)
    argp.add_argument("--state", type=Path, default=Path("data/state.json"))
    argp.add_argument("--items-cache", type=Path, default=Path("data/items.json"), help="前回取得データの保存先")
    argp.add_argument("--output", type=Path, default=Path("public"), help="Webサイトの出力先")
    argp.add_argument("--dry-run", action="store_true", help="Discordへ送らず取得結果を表示")
    argp.add_argument("--initialize", action="store_true", help="現在の掲載分を通知済みとして登録")
    args = argp.parse_args()

    items: list[Item] = []
    try:
        for source, (label, url) in SOURCES.items():
            parsed = parse_listing(source, fetch(url))
            print(f"{label}: {len(parsed)}件を取得", file=sys.stderr)
            items.extend(parsed)
    except RuntimeError as error:
        cached_items = load_items(args.items_cache)
        render_site(cached_items, args.output, str(error))
        print(f"取得エラーの案内をWebサイトへ表示しました: {error}", file=sys.stderr)
        return 0

    save_items(args.items_cache, items)
    render_site(items, args.output)
    print(f"Webサイトを {args.output} に生成しました。", file=sys.stderr)

    seen = load_seen(args.state)
    new_items = [item for item in items if item.key not in seen]
    if args.dry_run:
        print(json.dumps([asdict(item) for item in new_items], ensure_ascii=False, indent=2))
        return 0
    if args.initialize or not args.state.exists():
        save_seen(args.state, [item.key for item in items])
        print(f"初期化しました（{len(items)}件）。通知は送っていません。")
        return 0
    if not new_items:
        print("新着はありません。")
        return 0

    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("環境変数 DISCORD_WEBHOOK_URL が設定されていません")
    post_discord(webhook_url, list(reversed(new_items)))
    save_seen(args.state, [*seen, *(item.key for item in items)])
    print(f"{len(new_items)}件をDiscordへ通知しました。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"エラー: {error}", file=sys.stderr)
        raise SystemExit(1)
