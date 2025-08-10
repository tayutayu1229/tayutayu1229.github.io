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

    sections = re.split(r'(<.+?>)', data["status_text"])
    accordion_html = ""
    if len(sections) > 1:
        for i in range(1, len(sections), 2):
            header = sections[i].strip()
            content_lines = [highlight_keywords(line) for line in sections[i+1].strip().split('\n')]
            content = '<br>'.join(content_lines)
            collapse_id = "collapse" + str(i)
            accordion_html += f"""
            <div class="status-section">
                <div class="status-header" onclick="toggleSection('{collapse_id}')">
                    <span class="section-title">{header}</span>
                    <span class="toggle-icon" id="icon-{collapse_id}">▼</span>
                </div>
                <div id="{collapse_id}" class="status-content collapsed">
                    <div class="status-details">{content}</div>
                </div>
            </div>
            """

    # エラーを回避するため、文字列の置換をf-stringの外で行う
    overview_text_formatted = data["overview_text"].replace('<br>', '\n')

    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況</title>
        <style>
            * {{
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }}
            
            body {{
                font-family: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
                background-color: #f8f9fa;
                color: #333;
                line-height: 1.6;
            }}
            
            .container {{
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }}
            
            .header {{
                background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
                color: white;
                padding: 30px 0;
                margin: -20px -20px 30px -20px;
                text-align: center;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            
            .header h1 {{
                font-size: 2.5rem;
                font-weight: 300;
                margin-bottom: 10px;
                letter-spacing: 2px;
            }}
            
            .header .update-time {{
                font-size: 1.1rem;
                opacity: 0.9;
                font-weight: 300;
            }}
            
            .info-card {{
                background: white;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                margin-bottom: 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                overflow: hidden;
            }}
            
            .info-card-header {{
                background: #f8f9fa;
                padding: 15px 20px;
                border-bottom: 1px solid #e9ecef;
                font-weight: 600;
                color: #495057;
                font-size: 1.1rem;
            }}
            
            .info-card-body {{
                padding: 20px;
                white-space: pre-line;
                line-height: 1.8;
            }}
            
            .status-section {{
                background: white;
                border: 1px solid #dee2e6;
                border-radius: 6px;
                margin-bottom: 10px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
            }}
            
            .status-header {{
                background: linear-gradient(90deg, #f8f9fa 0%, #e9ecef 100%);
                padding: 15px 20px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #dee2e6;
                transition: background-color 0.2s ease;
            }}
            
            .status-header:hover {{
                background: linear-gradient(90deg, #e9ecef 0%, #dee2e6 100%);
            }}
            
            .section-title {{
                font-weight: 600;
                color: #495057;
                font-size: 1.05rem;
            }}
            
            .toggle-icon {{
                font-size: 0.9rem;
                color: #6c757d;
                transition: transform 0.3s ease;
            }}
            
            .status-content {{
                overflow: hidden;
                transition: max-height 0.3s ease, padding 0.3s ease;
            }}
            
            .status-content.collapsed {{
                max-height: 0;
                padding: 0 20px;
            }}
            
            .status-content.expanded {{
                max-height: 1000px;
                padding: 20px;
            }}
            
            .status-details {{
                font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
                font-size: 0.9rem;
                line-height: 1.7;
                color: #495057;
                white-space: pre-line;
            }}
            
            .status-badge {{
                display: inline-block;
                padding: 4px 8px;
                border-radius: 4px;
                font-weight: 600;
                font-size: 0.8rem;
                text-align: center;
                min-width: 60px;
            }}
            
            .status-stopped {{
                background-color: #dc3545;
                color: white;
            }}
            
            .status-delay {{
                background-color: #fd7e14;
                color: white;
            }}
            
            .status-cancelled {{
                background-color: #6c757d;
                color: white;
            }}
            
            .status-suspended {{
                background-color: #ffc107;
                color: #212529;
            }}
            
            .section-header {{
                text-align: center;
                margin: 40px 0 20px 0;
                font-size: 1.8rem;
                font-weight: 300;
                color: #2c3e50;
                position: relative;
            }}
            
            .section-header::after {{
                content: '';
                position: absolute;
                bottom: -10px;
                left: 50%;
                transform: translateX(-50%);
                width: 60px;
                height: 3px;
                background: linear-gradient(90deg, #3498db, #2c3e50);
                border-radius: 2px;
            }}
            
            .footer {{
                margin-top: 50px;
                padding-top: 30px;
                border-top: 1px solid #e9ecef;
                color: #6c757d;
                text-align: center;
                font-size: 0.9rem;
                line-height: 1.8;
            }}
            
            @media (max-width: 768px) {{
                .container {{
                    padding: 10px;
                }}
                
                .header h1 {{
                    font-size: 2rem;
                }}
                
                .status-header {{
                    padding: 12px 15px;
                }}
                
                .status-details {{
                    font-size: 0.85rem;
                }}
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>JR貨物 輸送状況</h1>
                <div class="update-time">サイト更新: {data["update_time"]}</div>
            </div>
            
            <div class="info-card">
                <div class="info-card-header">標題</div>
                <div class="info-card-body">{data["title"]}</div>
            </div>
            
            <div class="info-card">
                <div class="info-card-header">{data["overview_title"]}</div>
                <div class="info-card-body">{overview_text_formatted}</div>
            </div>
            
            <h2 class="section-header">{data["status_title"]}</h2>
            
            <div class="status-accordion">
                {accordion_html}
            </div>
            
            <div class="footer">
                このページはGitHub Actionsにより自動生成されています。<br>
                最終取得時刻 (JST): {current_time_str}
            </div>
        </div>
        
        <script>
            function toggleSection(sectionId) {{
                const content = document.getElementById(sectionId);
                const icon = document.getElementById('icon-' + sectionId);
                
                if (content.classList.contains('collapsed')) {{
                    content.classList.remove('collapsed');
                    content.classList.add('expanded');
                    icon.textContent = '▲';
                    icon.style.transform = 'rotate(180deg)';
                }} else {{
                    content.classList.remove('expanded');
                    content.classList.add('collapsed');
                    icon.textContent = '▼';
                    icon.style.transform = 'rotate(0deg)';
                }}
            }}
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
