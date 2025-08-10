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
        "停車中": "status-stopped", 
        "遅れ": "status-delay",
        "運休": "status-cancelled", 
        "見合わせ": "status-suspended",
    }
    for keyword, css_class in highlights.items():
        line = re.sub(rf'({keyword})', f'<span class="status-badge {css_class}">\\1</span>', line)
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
        if not content_elem: 
            return None

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
            "update_time": update_time, 
            "title": title, 
            "overview_title": overview_title,
            "overview_text": overview_text, 
            "status_title": status_title, 
            "status_text": status_text,
        }
    except Exception as e:
        print(f"解析中に予期せぬエラーが発生しました: {e}")
        return None

def create_html(data):
    if not data: 
        return ""

    jst = timezone(timedelta(hours=+9), 'JST')
    current_time_str = datetime.now(jst).strftime('%Y-%m-%d %H:%M:%S')

    sections = re.split(r'(<.+?>)', data["status_text"])
    accordion_html = ""
    if len(sections) > 1:
        for i in range(1, len(sections), 2):
            header = sections[i].strip()
            content_lines = [highlight_keywords(line) for line in sections[i+1].strip().split('\n')]
            content = '<br>'.join(content_lines)
            collapse_id = "collapse" + str(i)
            accordion_html += f"""
            <div class="status-section" data-keywords="{header}{sections[i+1]}">
                <div class="status-header" onclick="toggleSection('{collapse_id}')">
                    <span class="section-title">{header}</span>
                    <span class="toggle-icon" id="icon-{collapse_id}">＋</span>
                </div>
                <div id="{collapse_id}" class="status-content collapsed">
                    <div class="status-details">{content}</div>
                </div>
            </div>
            """

    overview_text_formatted = data["overview_text"].replace('<br>', '\n')

    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況</title>
        <style>
            body {{
                font-family: Arial, sans-serif;
                background-color: #fff;
                color: #333;
                line-height: 1.6;
                margin: 0;
                padding: 0;
            }}
            .container {{
                max-width: 1000px;
                margin: auto;
                padding: 20px;
            }}
            .header {{
                text-align: center;
                margin-bottom: 20px;
            }}
            .header h1 {{
                font-size: 2rem;
                font-weight: bold;
            }}
            .update-time {{
                font-size: 0.9rem;
                color: #666;
            }}
            .search-box {{
                margin-bottom: 20px;
                text-align: center;
            }}
            .search-box input {{
                padding: 8px;
                width: 80%;
                max-width: 400px;
                border: 1px solid #ccc;
                border-radius: 4px;
            }}
            .info-card {{
                border: 1px solid #ddd;
                border-radius: 4px;
                margin-bottom: 15px;
                padding: 15px;
                background: #fafafa;
            }}
            .status-section {{
                border: 1px solid #ddd;
                border-radius: 4px;
                margin-bottom: 10px;
            }}
            .status-header {{
                background: #f5f5f5;
                padding: 10px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }}
            .status-content {{
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.3s ease;
                padding: 0 10px;
            }}
            .status-content.expanded {{
                max-height: 500px;
                padding: 10px;
            }}
            .status-badge {{
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.8rem;
                margin-left: 4px;
            }}
            .status-stopped {{ background-color: #e74c3c; color: white; }}
            .status-delay {{ background-color: #e67e22; color: white; }}
            .status-cancelled {{ background-color: #7f8c8d; color: white; }}
            .status-suspended {{ background-color: #f1c40f; color: black; }}
            @media (max-width: 600px) {{
                .search-box input {{
                    width: 100%;
                }}
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>JR貨物 輸送状況</h1>
                <div class="update-time">サイト更新: {data["update_time"]} | 最終取得: {current_time_str}</div>
            </div>

            <div class="search-box">
                <input type="text" id="searchInput" placeholder="線区やキーワードで検索...">
            </div>

            <div class="info-card">
                <strong>標題:</strong><br>{data["title"]}
            </div>
            <div class="info-card">
                <strong>{data["overview_title"]}</strong><br>{overview_text_formatted}
            </div>

            <h2>{data["status_title"]}</h2>
            <div class="status-accordion">
                {accordion_html}
            </div>
        </div>

        <script>
            function toggleSection(sectionId) {{
                const content = document.getElementById(sectionId);
                const icon = document.getElementById('icon-' + sectionId);
                if (content.classList.contains('expanded')) {{
                    content.classList.remove('expanded');
                    icon.textContent = '＋';
                }} else {{
                    content.classList.add('expanded');
                    icon.textContent = '−';
                }}
            }}

            document.getElementById('searchInput').addEventListener('input', function() {{
                const keyword = this.value.toLowerCase();
                document.querySelectorAll('.status-section').forEach(section => {{
                    const text = section.getAttribute('data-keywords').toLowerCase();
                    section.style.display = text.includes(keyword) ? '' : 'none';
                }});
            }});
        </script>
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
