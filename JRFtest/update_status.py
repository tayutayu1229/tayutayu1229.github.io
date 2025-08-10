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
            accordion_html += f"""
            <div class="status-section" data-search-content="{header} {sections[i+1].strip()}">
                <div class="status-header">
                    <span class="section-title">{header}</span>
                </div>
                <div class="status-content">
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
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                background-color: #ffffff;
                color: #333333;
                line-height: 1.7;
                font-size: 14px;
            }}
            
            .container {{
                max-width: 1000px;
                margin: 0 auto;
                padding: 40px 20px;
            }}
            
            .header {{
                background-color: #ffffff;
                color: #333333;
                padding: 40px 0 30px 0;
                text-align: center;
                border-bottom: 2px solid #f0f0f0;
                margin-bottom: 40px;
            }}
            
            .header h1 {{
                font-size: 32px;
                font-weight: 600;
                margin-bottom: 12px;
                letter-spacing: 1px;
                color: #2c3e50;
            }}
            
            .header .update-time {{
                font-size: 16px;
                color: #666666;
                font-weight: 400;
            }}
            
            .search-container {{
                background: #fafafa;
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                padding: 20px;
                margin-bottom: 30px;
            }}
            
            .search-box {{
                position: relative;
                max-width: 400px;
                margin: 0 auto;
            }}
            
            .search-input {{
                width: 100%;
                padding: 12px 16px;
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                font-size: 16px;
                background-color: #ffffff;
                transition: border-color 0.2s ease;
            }}
            
            .search-input:focus {{
                outline: none;
                border-color: #4a90e2;
            }}
            
            .search-label {{
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
                color: #555555;
                text-align: center;
            }}
            
            .info-card {{
                background: #ffffff;
                border: 1px solid #e8e8e8;
                border-radius: 8px;
                margin-bottom: 30px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.04);
            }}
            
            .info-card-header {{
                background: #f8f9fa;
                padding: 20px 24px;
                border-bottom: 1px solid #e8e8e8;
                font-weight: 600;
                color: #333333;
                font-size: 16px;
            }}
            
            .info-card-body {{
                padding: 24px;
                white-space: pre-line;
                line-height: 1.8;
                color: #555555;
            }}
            
            .status-section {{
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 6px;
                margin-bottom: 20px;
                box-shadow: 0 1px 2px rgba(0,0,0,0.03);
                transition: opacity 0.3s ease;
            }}
            
            .status-section.hidden {{
                display: none;
            }}
            
            .status-header {{
                background: #f8f9fa;
                padding: 16px 24px;
                border-bottom: 1px solid #e8e8e8;
                border-radius: 6px 6px 0 0;
            }}
            
            .section-title {{
                font-weight: 600;
                color: #2c3e50;
                font-size: 16px;
                display: block;
            }}
            
            .status-content {{
                display: block;
                border-radius: 0 0 6px 6px;
            }}
            
            .status-details {{
                padding: 20px 24px;
                font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace;
                font-size: 13px;
                line-height: 1.6;
                color: #555555;
                white-space: pre-line;
                background: #fafafa;
                max-height: 600px;
                overflow-y: auto;
                border-radius: 0 0 6px 6px;
            }}
            
            .status-details::-webkit-scrollbar {{
                width: 8px;
            }}
            
            .status-details::-webkit-scrollbar-track {{
                background: #f0f0f0;
                border-radius: 4px;
            }}
            
            .status-details::-webkit-scrollbar-thumb {{
                background: #c0c0c0;
                border-radius: 4px;
            }}
            
            .status-details::-webkit-scrollbar-thumb:hover {{
                background: #a0a0a0;
            }}
            
            .status-badge {{
                display: inline-block;
                padding: 3px 8px;
                border-radius: 4px;
                font-weight: 500;
                font-size: 12px;
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            }}
            
            .status-stopped {{
                background-color: #fee2e2;
                color: #991b1b;
                border: 1px solid #fca5a5;
            }}
            
            .status-delay {{
                background-color: #fef3c7;
                color: #92400e;
                border: 1px solid #fcd34d;
            }}
            
            .status-cancelled {{
                background-color: #f3f4f6;
                color: #374151;
                border: 1px solid #d1d5db;
            }}
            
            .status-suspended {{
                background-color: #dbeafe;
                color: #1e40af;
                border: 1px solid #93c5fd;
            }}
            
            .section-header {{
                text-align: center;
                margin: 50px 0 30px 0;
                font-size: 24px;
                font-weight: 600;
                color: #2c3e50;
                position: relative;
            }}
            
            .section-header::after {{
                content: '';
                position: absolute;
                bottom: -12px;
                left: 50%;
                transform: translateX(-50%);
                width: 40px;
                height: 2px;
                background: #4a90e2;
                border-radius: 1px;
            }}
            
            .no-results {{
                text-align: center;
                padding: 40px;
                color: #888888;
                font-style: italic;
                display: none;
            }}
            
            .footer {{
                margin-top: 60px;
                padding-top: 30px;
                border-top: 1px solid #f0f0f0;
                color: #888888;
                text-align: center;
                font-size: 13px;
                line-height: 1.6;
            }}
            
            @media (max-width: 768px) {{
                .container {{
                    padding: 20px 15px;
                }}
                
                .header {{
                    padding: 30px 0 20px 0;
                    margin-bottom: 30px;
                }}
                
                .header h1 {{
                    font-size: 26px;
                }}
                
                .search-container {{
                    padding: 15px;
                }}
                
                .search-box {{
                    max-width: 100%;
                }}
                
                .search-input {{
                    font-size: 16px;
                    padding: 12px 14px;
                }}
                
                .info-card-header {{
                    padding: 16px 18px;
                    font-size: 15px;
                }}
                
                .info-card-body {{
                    padding: 18px;
                }}
                
                .status-header {{
                    padding: 12px 18px;
                }}
                
                .section-title {{
                    font-size: 15px;
                }}
                
                .status-details {{
                    padding: 16px 18px;
                    font-size: 12px;
                    max-height: 400px;
                }}
                
                .section-header {{
                    font-size: 20px;
                    margin: 40px 0 25px 0;
                }}
            }}
            
            @media (max-width: 480px) {{
                .container {{
                    padding: 15px 10px;
                }}
                
                .header h1 {{
                    font-size: 22px;
                }}
                
                .status-badge {{
                    font-size: 11px;
                    padding: 2px 6px;
                }}
                
                .status-details {{
                    max-height: 300px;
                    font-size: 11px;
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
            
            <div class="search-container">
                <label class="search-label">線区名・状況でフィルタ検索</label>
                <div class="search-box">
                    <input type="text" class="search-input" id="searchInput" placeholder="例: 東海道、遅れ、運休" />
                </div>
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
            
            <div class="no-results" id="noResults">
                検索条件に一致する線区情報が見つかりませんでした。
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
                    icon.textContent = '−';
                }} else {{
                    content.classList.remove('expanded');
                    content.classList.add('collapsed');
                    icon.textContent = '+';
                }}
            }}
            
            // 検索フィルター機能
            document.addEventListener('DOMContentLoaded', function() {{
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {{
                    searchInput.addEventListener('input', function(e) {{
                        const searchTerm = e.target.value.toLowerCase();
                        const sections = document.querySelectorAll('.status-section');
                        const noResults = document.getElementById('noResults');
                        let visibleCount = 0;
                        
                        sections.forEach(function(section) {{
                            const searchContent = section.getAttribute('data-search-content').toLowerCase();
                            
                            if (searchContent.includes(searchTerm)) {{
                                section.style.display = 'block';
                                section.classList.remove('hidden');
                                visibleCount++;
                            }} else {{
                                section.style.display = 'none';
                                section.classList.add('hidden');
                            }}
                        }});
                        
                        if (visibleCount === 0 && searchTerm.length > 0) {{
                            noResults.style.display = 'block';
                        }} else {{
                            noResults.style.display = 'none';
                        }}
                    }});
                }}
            }});
        }}
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
