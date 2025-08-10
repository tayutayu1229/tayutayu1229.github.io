import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import os
import json
import base64
import re

# --- 設定項目 ---
USER_NAME = "tayutayu1229"
REPO_NAME = "tayutayu1229.github.io"
TARGET_FILE = "JRFtest/jr_freight_status.html"
BRANCH_NAME = "main"
# ----------------

def highlight_keywords(line):
    highlights = {
        "停車中": "status-stopped", "遅れ": "status-delay",
        "運休": "status-cancelled", "見合わせ": "status-suspended",
    }
    for keyword, css_class in highlights.items():
        if keyword in line:
            line = line.replace(keyword, f'<span class="status-badge {css_class}">{keyword}</span>')
    return line

def fetch_and_parse_data():
    url = "https://www.jrfreight.co.jp/i_daiya"
    try:
        response = requests.get(url)
        response.encoding = 'utf-8'
        soup = BeautifulSoup(response.text, 'html.parser')

        update_time_elem = soup.find('div', id='pbBlock91534')
        update_time = update_time_elem.text.strip() if update_time_elem else "不明"
        
        title_elem = soup.find('div', id='pbBlock91536')
        title = title_elem.text.strip() if title_elem else "（標題なし）"

        content_elem = soup.find('div', class_='base_daiya-content')
        if not content_elem: return None

        h2_tags = content_elem.find_all('h2')
        p_tags = content_elem.find_all('p')
        
        overview_title = h2_tags[0].text.strip() if len(h2_tags) > 0 else "概要"
        overview_text = p_tags[0].get_text('<br>', strip=True) if len(p_tags) > 0 else "情報なし"
        
        status_title = h2_tags[1].text.strip() if len(h2_tags) > 1 else "線区情報"

        status_text = ""
        if len(p_tags) > 1:
            for br in p_tags[1].find_all("br"):
                br.replace_with("\n")
            status_text = p_tags[1].text.strip()
        
        return {
            "update_time": update_time, "title": title, "overview_title": overview_title,
            "overview_text": overview_text, "status_title": status_title, "status_text": status_text,
        }
    except Exception as e:
        print(f"解析中に予期せぬエラーが発生しました: {e}")
        return None

def create_html(data):
    if not data: return ""

    jst = timezone(timedelta(hours=+9), 'JST')
    current_time_str = datetime.now(jst).strftime('%Y-%m-%d %H:%M:%S')

    overview_text_formatted = data["overview_text"].replace('<br>', '\n').lstrip('\n')

    sections = re.split(r'(<.+?>)', data["status_text"])
    status_html = ""
    if len(sections) > 1:
        for i in range(1, len(sections), 2):
            header = sections[i].strip()
            
            # ★★★★★ ここからが表を作成する新しいロジック ★★★★★
            table_rows_html = ""
            lines = [line.strip() for line in sections[i+1].strip().split('\n') if line.strip()]
            
            for line in lines:
                # 連続する空白を区切り文字に変換し、それで分割して列データを作成
                parts = re.sub(r'[\s　]{2,}', '@@@', line).split('@@@')
                
                # 3つの要素（列車情報、場所、状態）に整える
                train_info = parts[0] if len(parts) > 0 else ""
                location = parts[1] if len(parts) > 1 else ""
                status = parts[2] if len(parts) > 2 else ""

                # 状態のセルにのみキーワードハイライトを適用
                status_highlighted = highlight_keywords(status)

                table_rows_html += f"""
                <tr>
                    <td>{train_info}</td>
                    <td>{location}</td>
                    <td>{status_highlighted}</td>
                </tr>
                """
            
            status_html += f"""
            <div class="status-card">
                <h5>{header}</h5>
                <div class="table-responsive">
                    <table class="table table-sm table-striped table-hover">
                        <thead class="thead-light">
                            <tr>
                                <th scope="col">列車情報</th>
                                <th scope="col">場所</th>
                                <th scope="col">状態</th>
                            </tr>
                        </thead>
                        <tbody>
                            {table_rows_html}
                        </tbody>
                    </table>
                </div>
            </div>
            """

    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況</title>
        <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
            :root {{
                --primary-color: #005ab3;
                --light-gray: #f8f9fa;
                --medium-gray: #e9ecef;
                --text-color: #343a40;
                --card-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
            }}
            body {{
                font-family: 'Noto Sans JP', sans-serif;
                background-color: var(--light-gray);
                color: var(--text-color);
            }}
            .container {{ max-width: 960px; }}
            .header-bar {{
                background-color: var(--primary-color);
                color: white; padding: 1.5rem; margin-bottom: 2rem; border-radius: 0.5rem;
            }}
            .header-bar h1 {{ font-weight: 700; font-size: 2rem; margin: 0; }}
            .header-bar p {{ margin: 0; opacity: 0.9; }}
            .summary-card {{
                background: #ffffff; padding: 1.5rem 2rem; border-radius: 0.5rem;
                box-shadow: var(--card-shadow); margin-bottom: 2rem;
            }}
            .summary-card .title {{
                font-weight: 500; font-size: 1.2rem;
                color: var(--primary-color); margin-bottom: 0.75rem;
            }}
            .summary-card .content {{ white-space: pre-wrap; line-height: 1.7; }}
            .section-title {{
                font-weight: 700; color: var(--text-color);
                padding-bottom: 0.5rem; border-bottom: 2px solid var(--medium-gray);
                margin-bottom: 1.5rem;
            }}
            .status-card {{
                background: #ffffff; margin-bottom: 1.5rem;
                box-shadow: var(--card-shadow); border-radius: 0.5rem;
                overflow: hidden; /* For border-radius to work with table */
            }}
            .status-card h5 {{
                font-weight: 500; padding: 0.8rem 1.2rem;
                background-color: #f7f9fc;
                border-bottom: 1px solid var(--medium-gray); margin: 0;
            }}
            .table-responsive {{
                /* テーブル自体にpaddingやmarginは不要 */
            }}
            .table {{
                margin-bottom: 0; /* status-cardの底にくっつける */
                font-size: 0.9rem;
            }}
            .table td, .table th {{ vertical-align: middle; }}
            .footer {{
                margin-top: 3rem; padding-top: 1.5rem;
                border-top: 1px solid var(--medium-gray); color: #6c757d;
                text-align: center; font-size: 0.85rem;
            }}
            .status-badge {{
                display: inline-block; padding: 0.3em 0.6em; font-size: 90%;
                font-weight: 700; line-height: 1; text-align: center;
                white-space: nowrap; vertical-align: baseline;
                border-radius: 0.25rem; color: #fff;
            }}
            .status-stopped {{ background-color: #d9534f; }}
            .status-delay {{ background-color: #f0ad4e; }}
            .status-cancelled {{ background-color: #777; }}
            .status-suspended {{ background-color: #5bc0de; color: #fff; }}
        </style>
    </head>
    <body>
        <div class="container py-4">
            <header class="header-bar text-center">
                <h1>JR貨物 輸送状況</h1>
                <p>サイト更新: {data["update_time"]}</p>
            </header>
            <section class="summary-card">
                <h4 class="title">{data["title"]}</h4>
                <p class="content">{overview_text_formatted}</p>
            </section>
            <h2 class="section-title">{data["status_title"]}</h2>
            <section>
                {status_html}
            </section>
            <footer class="footer">
                このページはGitHub Actionsにより自動生成されています。<br>
                最終取得時刻 (JST): {current_time_str}
            </footer>
        </div>
    </body>
    </html>
    """
    return html_template

def update_github_file(content):
    token = os.getenv('GITHUB_TOKEN')
    if not token:
        print("デバッグ: GITHUB_TOKENが設定されていません。")
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
            raise

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
        print(f"エラー: ファイルの更新に失敗しました。Status Code: {r.status_code}")
        print(f"レスポンス: {r.text}")
        raise Exception("ファイルの更新/作成に失敗しました。")
    
    print("ファイルが正常に更新/作成されました。")

if __name__ == "__main__":
    print("処理を開始します。")
    scraped_data = fetch_and_parse_data()
    if scraped_data:
        html_content = create_html(scraped_data)
        if html_content:
            update_github_file(html_content)
            print("処理が正常に完了しました。")
        else:
            print("HTMLコンテンツの生成に失敗しました。")
    else:
        print("データのスクレイピングに失敗しました。処理を終了します。")
