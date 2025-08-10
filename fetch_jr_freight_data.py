import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import re
import os
import base64
import json

USER_NAME = "tayutayu1229"
REPO_NAME = "tayutayu1229.github.io"
TARGET_FILE = "JRFtest/jr_freight_status.html"
BRANCH_NAME = "main"

URL = "https://www.jrfreight.co.jp/i_daiya"

def highlight_keywords(text):
    highlights = {
        "停車中": "status-stopped",
        "遅れ": "status-delay",
        "運休": "status-cancelled",
        "見合わせ": "status-suspended",
    }
    for keyword, css_class in highlights.items():
        if keyword in text:
            text = text.replace(keyword, f'<span class="status-badge {css_class}">{keyword}</span>')
    return text

def clean_text(text):
    return re.sub(r'\s+', ' ', text.strip())

def fetch_and_parse_data():
    try:
        response = requests.get(URL, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')

        jst = timezone(timedelta(hours=+9), 'JST')
        now = datetime.now(jst)

        # タイトル（標題）
        title = ""
        title_tag = soup.find("h2", string=re.compile("標"))
        if title_tag:
            p_tag = title_tag.find_parent("div").find_next("p")
            if p_tag:
                title = clean_text(p_tag.text)

        # 発生時刻・概要的な情報
        incidents = []
        incident_tag = soup.find("h2", string=re.compile("発生時刻"))
        if incident_tag:
            p_tag = incident_tag.find_parent("div").find_next("p")
            if p_tag:
                lines = [BeautifulSoup(l, "html.parser").text for l in p_tag.decode_contents().split("<br />") if l.strip()]
                for line in lines:
                    m = re.match(r'^\(\d+\)(?P<term>.+?)\s+(?P<location>.+?)\s+(?P<cause>.+?)\((?P<impact>.+)\)$', line)
                    if m:
                        incidents.append({
                            "time_period": clean_text(m.group("term")),
                            "location": clean_text(m.group("location")),
                            "cause": clean_text(m.group("cause")),
                            "impact": clean_text(m.group("impact")),
                        })
                    else:
                        incidents.append({
                            "time_period": "",
                            "location": "",
                            "cause": "",
                            "impact": clean_text(line)
                        })

        # 線区・影響貨物列車の情報抽出（表形式に変換）
        affected_trains = []
        trains_tag = soup.find("h2", string=re.compile("線"))
        if trains_tag:
            p_tag = trains_tag.find_parent("div").find_next("p")
            if p_tag:
                blocks = [b for b in p_tag.decode_contents().split("<br />") if b.strip()]
                current_line = None
                line_data = {}
                for b in blocks:
                    b_txt = BeautifulSoup(b, "html.parser").text.strip()
                    # <○○線 下り> 形式の線区名検出
                    if b_txt.startswith("<") and ">" in b_txt:
                        if current_line and "trains" in line_data:
                            affected_trains.append(line_data)
                        current_line = b_txt.strip("<>")
                        line_data = {"line": current_line, "trains": []}
                    else:
                        # 列車情報抽出
                        m = re.match(r'(?:(\d+日発))?(.+?列車\(.+?\))\s+(.+?)\s+(.+)', b_txt)
                        if m:
                            dep = m.group(1) or ""
                            number = clean_text(m.group(2))
                            location = clean_text(m.group(3))
                            status = clean_text(m.group(4))
                            route_m = re.search(r'\((.+?)\)', number)
                            route = route_m.group(1) if route_m else ""
                            train_number = number.split("列車")[0]
                            line_data["trains"].append({
                                "train_number": clean_text(number.replace(f"({route})", "")),
                                "route": route,
                                "current_location": location,
                                "status": status,
                            })
                if current_line and "trains" in line_data:
                    affected_trains.append(line_data)

        # 取扱いファイルリンク
        related_files = []
        file_tag = soup.find("h2", string=re.compile("ファイル"))
        if file_tag:
            ul_tag = file_tag.find_parent("div").find_next("ul")
            if ul_tag:
                for a in ul_tag.find_all("a"):
                    url = a.get("href")
                    if not url.startswith("http"):
                        url = "https://www.jrfreight.co.jp" + url.strip("[]/")
                    related_files.append({
                        "title": clean_text(a.text),
                        "url": url
                    })

        # データまとめ
        return {
            "company": "日本貨物鉄道株式会社",
            "fetched_time": now.strftime("%Y-%m-%d %H:%M:%S JST"),
            "title": title,
            "incidents": incidents,
            "affected_trains": affected_trains,
            "related_files": related_files
        }

    except Exception as e:
        print(f"エラー発生: {e}")
        return None

def create_html(data):
    if not data:
        return ""

    # HTML作成は「線区別貨物列車情報」を表形式に整形して表示
    train_status_html = ""
    for line_info in data.get("affected_trains", []):
        rows_html = ""
        for train in line_info.get("trains", []):
            status_highlighted = highlight_keywords(train["status"])
            rows_html += f"""
                <tr>
                    <td>{train['train_number']}</td>
                    <td>{train['route']}</td>
                    <td>{train['current_location']}</td>
                    <td>{status_highlighted}</td>
                </tr>
            """
        train_status_html += f"""
        <div class="status-card">
            <h5>{line_info['line']}</h5>
            <div class="table-responsive">
                <table class="table table-sm table-striped table-hover">
                    <thead class="thead-light">
                        <tr>
                            <th scope="col">列車番号</th>
                            <th scope="col">区間</th>
                            <th scope="col">現在地</th>
                            <th scope="col">状態</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows_html}
                    </tbody>
                </table>
            </div>
        </div>
        """

    # 発生時刻・概要の表示整形
    incidents_html = ""
    for inc in data.get("incidents", []):
        incidents_html += f"<p>時間: {inc['time_period']}, 場所: {inc['location']}, 原因: {inc['cause']}, 影響: {inc['impact']}</p>"

    related_files_html = ""
    for f in data.get("related_files", []):
        related_files_html += f'<p><a href="{f["url"]}" target="_blank">{f["title"]}</a></p>'

    html = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>JR貨物 輸送状況</title>
        <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" />
        <style>
            body {{ font-family: 'Noto Sans JP', sans-serif; background-color: #f8f9fa; color:#343a40; }}
            .status-badge {{ padding: 0.3em 0.6em; color: white; border-radius: 0.25rem; font-weight: 700; }}
            .status-stopped {{ background-color: #d9534f; }}
            .status-delay {{ background-color: #f0ad4e; }}
            .status-cancelled {{ background-color: #777; }}
            .status-suspended {{ background-color: #5bc0de; }}
            .status-card {{ background:#fff; margin-bottom:1.5rem; padding:1rem; border-radius:0.5rem; box-shadow:0 4px 6px rgba(0,0,0,0.05); }}
        </style>
    </head>
    <body>
        <div class="container py-4">
            <header class="mb-4">
                <h1>JR貨物 輸送状況</h1>
                <p>情報取得時刻: {data['fetched_time']}</p>
            </header>
            <section class="mb-4">
                <h4>{data['title']}</h4>
                <div>{incidents_html}</div>
            </section>
            <section class="mb-4">
                <h4>影響のある貨物列車</h4>
                {train_status_html}
            </section>
            <section class="mb-4">
                <h4>関連ファイル</h4>
                {related_files_html}
            </section>
            <footer class="text-center mt-5 mb-3 text-muted" style="font-size:0.85rem;">
                このページは自動生成されています。
            </footer>
        </div>
    </body>
    </html>
    """
    return html

def update_github_file(content):
    token = os.getenv('GITHUB_TOKEN')
    if not token:
        print("GITHUB_TOKENは設定されていません。")
        return

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    url = f"https://api.github.com/repos/{USER_NAME}/{REPO_NAME}/contents/{TARGET_FILE}"

    sha = None
    try:
        r = requests.get(url, headers=headers)
        r.raise_for_status()
        sha = r.json().get('sha')
    except requests.exceptions.HTTPError as e:
        if e.response.status_code != 404:
            print(f"GitHub APIの取得でエラー: {e}")
            return

    encoded_content = base64.b64encode(content.encode('utf-8')).decode('utf-8')

    data = {
        "message": f"Update JR Freight status ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})",
        "content": encoded_content,
        "branch": BRANCH_NAME
    }
    if sha:
        data["sha"] = sha

    r = requests.put(url, headers=headers, data=json.dumps(data))
    if r.status_code not in [200, 201]:
        print(f"ファイル更新失敗。Status: {r.status_code}\nレスポンス: {r.text}")
        raise Exception("ファイルの更新に失敗しました。")
    else:
        print("GitHubファイルが正常に更新されました。")

if __name__ == "__main__":
    print("処理開始")
    data = fetch_and_parse_data()
    if not data:
        print("データ取得失敗")
    else:
        html = create_html(data)
        if html:
            update_github_file(html)
            print("処理完了")
        else:
            print("HTML生成失敗")
