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
        line = re.sub(rf'\b{keyword}\b', f'<span class="status-badge {css_class}">{keyword}</span>', line)
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

    # Accordion HTML generation logic (no changes needed here)
    sections = re.split(r'(<.+?>)', data["status_text"])
    accordion_html = ""
    if len(sections) > 1:
        for i in range(1, len(sections), 2):
            header = sections[i].strip()
            content_lines = [highlight_keywords(line) for line in sections[i+1].strip().split('\n')]
            content = '<br>'.join(content_lines)
            collapse_id = "collapse" + str(i)
            # Bootstrap accordion structure
            accordion_html += f"""
            <div class="card">
                <div class="card-header" id="heading{i}">
                    <h2 class="mb-0">
                        <button class="btn btn-link btn-block text-left" type="button" data-toggle="collapse" data-target="#{collapse_id}" aria-expanded="false" aria-controls="{collapse_id}">
                            {header}
                        </button>
                    </h2>
                </div>
                <div id="{collapse_id}" class="collapse" aria-labelledby="heading{i}">
                    <div class="card-body detail-info">
                        {content}
                    </div>
                </div>
            </div>
            """
    
    # This logic remains the same to prevent errors.
    overview_text_formatted = data["overview_text"].replace('<br>', '\n')

    # ★★★★★ ここからHTMLとCSSのデザインを白ベースに変更 ★★★★★
    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況</title>
        <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
        <style>
            body {{
                background-color: #f4f7fa; /* Slightly off-white for a softer look */
                color: #333;
                font-family: 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif';
            }}
            .container {{
                max-width: 960px;
            }}
            .page-header {{
                background-color: #ffffff;
                border-radius: 0.25rem;
                padding: 2rem;
                margin-bottom: 2rem;
                border: 1px solid #dee2e6;
            }}
            .page-header h1 {{
                font-weight: 300;
                color: #0056b3; /* A professional blue */
            }}
            .card {{
                margin-bottom: 1.25rem;
                border: 1px solid #dee2e6;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }}
            .card-header {{
                background-color: #e9ecef;
                font-weight: bold;
                color: #495057;
            }}
            .info-card .card-body {{
                white-space: pre-wrap;
                font-size: 1rem;
                line-height: 1.6;
            }}
            #statusAccordion .card-header {{
                 background-color: #fff;
            }}
            #statusAccordion .btn-link {{
                font-weight: bold;
                color: #0056b3;
                text-decoration: none;
            }}
            #statusAccordion .btn-link:hover {{
                color: #003d82;
            }}
            .detail-info {{
                font-family: 'monospace';
                font-size: 0.9rem;
                white-space: pre-wrap;
                background-color: #fdfdfd;
                border-top: 1px solid #eee;
            }}
            .footer {{
                margin-top: 3rem;
                padding-top: 1.5rem;
                border-top: 1px solid #dee2e6;
                color: #6c757d;
                text-align: center;
                font-size: 0.875rem;
            }}
            /* Status badge styles remain the same but work well on a light background */
            .status-badge {{
                display: inline-block;
                padding: 0.25em 0.6em;
                font-size: 85%;
                font-weight: 700;
                line-height: 1;
                text-align: center;
                white-space: nowrap;
                vertical-align: baseline;
                border-radius: 0.25rem;
                color: #fff;
            }}
            .status-stopped {{ background-color: #dc3545; }} /* Red */
            .status-delay {{ background-color: #fd7e14; }} /* Orange */
            .status-cancelled {{ background-color: #6c757d; }} /* Gray */
            .status-suspended {{ background-color: #ffc107; color: #212529; }} /* Yellow */
        </style>
    </head>
    <body>
        <div class="container py-4">

            <div class="page-header text-center">
                <h1>JR貨物 輸送状況</h1>
                <p class="lead text-muted">サイト更新: {data["update_time"]}</p>
            </div>

            <div class="card info-card">
                <div class="card-header">{data["title"]}</div>
                <div class="card-body">
                    <p class="card-text">{overview_text_formatted}</p>
                </div>
            </div>
            
            <h3 class="mt-5 mb-3">{data["status_title"]}</h3>
            <div class="accordion" id="statusAccordion">
                {accordion_html}
            </div>

            <footer class="footer">
                このページはGitHub Actionsにより自動生成されています。<br>
                最終取得時刻 (JST): {current_time_str}
            </footer>

        </div>
        <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.5.4/dist/umd/popper.min.js"></script>
        <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>
    </body>
    </html>
    """
    # ★★★★★ 修正ここまで ★★★★★
    return html_template

# (以下、update_github_file と if __name__ == "__main__": の部分は変更ありません)
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
