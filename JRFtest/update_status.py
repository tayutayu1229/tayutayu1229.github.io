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

    raw_sections = re.split(r'(<.+?>)', data["status_text"])
    
    section_html = ""
    if len(raw_sections) > 1:
        for i in range(1, len(raw_sections), 2):
            if i + 1 < len(raw_sections):
                header = raw_sections[i].strip()
                content_text = raw_sections[i+1].strip()
                
                content_lines = [highlight_keywords(line) for line in content_text.split('\n') if line.strip()]
                
                # 列車情報を格納する部分
                content = ''.join([f'<div class="train-line">{line}</div>' for line in content_lines])
                
                # 検索対象のテキスト（路線名 + 詳細情報）
                search_content = f"{header} {content_text}"
                
                section_html += f"""
                <div class="status-section" data-search-content="{search_content}">
                    <div class="status-header">{header}</div>
                    <div class="status-details">
                        {content if content else '<p class="no-info-in-section">詳細情報はありません。</p>'}
                    </div>
                </div>
                """

    overview_text_formatted = data["overview_text"].replace('<br>', '\n')

    # --- HTML & CSS TEMPLATE (Redesigned) ---
    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況ダッシュボード</title>
        <style>
            :root {
                --jrf-blue: #0054A5;
                --dark-header: #2c3e50;
                --body-bg: #f4f7f9;
                --card-bg: #ffffff;
                --text-primary: #343a40;
                --text-secondary: #6c757d;
                --border-color: #e1e5e8;
                --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                --font-mono: "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            }
            
            body {
                font-family: var(--font-sans);
                background-color: var(--body-bg);
                color: var(--text-primary);
                margin: 0;
            }
            
            .page-header {
                background-color: var(--dark-header);
                color: white;
                padding: 20px;
                text-align: center;
            }
            .page-header h1 {
                margin: 0;
                font-size: 24px;
                font-weight: 600;
            }
            .page-header .update-time {
                opacity: 0.8;
                font-size: 14px;
                margin-top: 4px;
            }

            .container {
                max-width: 1000px;
                margin: 0 auto;
                padding: 24px;
            }
            
            .search-wrapper {
                position: relative;
                margin-bottom: 24px;
            }
            .search-icon {
                position: absolute;
                top: 50%;
                left: 16px;
                transform: translateY(-50%);
                width: 20px;
                height: 20px;
                fill: #999;
            }
            .search-input {
                width: 100%;
                padding: 14px 14px 14px 48px;
                border: 1px solid var(--border-color);
                border-radius: 8px;
                font-size: 16px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                transition: border-color .2s, box-shadow .2s;
            }
            .search-input:focus {
                outline: none;
                border-color: var(--jrf-blue);
                box-shadow: 0 0 0 3px rgba(0, 84, 165, 0.2);
            }

            .info-card {
                background-color: var(--card-bg);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                margin-bottom: 24px;
                border-top: 4px solid var(--jrf-blue);
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            }
            .card-header {
                padding: 12px 16px;
                font-weight: 600;
                font-size: 16px;
                border-bottom: 1px solid var(--border-color);
            }
            .card-body {
                padding: 16px;
                white-space: pre-line;
                line-height: 1.7;
            }

            .section-title-header {
                font-size: 20px;
                font-weight: 600;
                text-align: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 2px solid var(--jrf-blue);
            }

            .status-section {
                background: var(--card-bg);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                margin-bottom: 16px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                overflow: hidden;
            }
            .status-header {
                background-color: var(--jrf-blue);
                color: white;
                padding: 10px 16px;
                font-weight: 600;
            }
            .status-details {
                padding: 12px 16px;
                font-family: var(--font-mono);
                font-size: 13px;
                line-height: 1.5; /* Tight but readable */
                background: #fdfdfd;
                white-space: pre-wrap;
                word-break: break-all;
            }
            .train-line {
                padding: 1.5px 0;
            }
            .no-info-in-section {
                font-family: var(--font-sans);
                color: var(--text-secondary);
            }

            .status-badge {
                display: inline-block;
                padding: 2px 7px;
                border-radius: 4px;
                font-weight: 600;
                font-size: 11px;
                font-family: var(--font-sans);
            }
            .status-stopped { background-color: #fee2e2; color: #991b1b; }
            .status-delay { background-color: #fef3c7; color: #92400e; }
            .status-cancelled { background-color: #f3f4f6; color: #374151; }
            .status-suspended { background-color: #dbeafe; color: #1e40af; }

            .no-results {
                display: none;
                text-align: center;
                padding: 40px;
                background-color: var(--card-bg);
                border-radius: 8px;
                color: var(--text-secondary);
                font-style: italic;
            }
            
            .footer {
                margin-top: 32px;
                padding-top: 24px;
                border-top: 1px solid var(--border-color);
                color: var(--text-secondary);
                text-align: center;
                font-size: 13px;
            }
        </style>
    </head>
    <body>
        <header class="page-header">
            <h1>JR貨物 輸送状況ダッシュボード</h1>
            <div class="update-time">サイト更新: {data["update_time"]}</div>
        </header>

        <div class="container">
            <div class="search-wrapper">
                <svg class="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"></path></svg>
                <input type="text" class="search-input" id="searchInput" placeholder="路線名、列車番号、状況 (遅れ、運休など) で検索">
            </div>

            <div class="info-card">
                <div class="card-header">輸送状況の標題</div>
                <div class="card-body">{data["title"]}</div>
            </div>
            
            <div class="info-card">
                <div class="card-header">{data["overview_title"]}</div>
                <div class="card-body">{overview_text_formatted}</div>
            </div>
            
            <h2 class="section-title-header">{data["status_title"]}</h2>
            
            <div id="status-list-container">
                {section_html}
            </div>
            
            <div class="no-results" id="noResults">
                検索条件に一致する情報が見つかりませんでした。
            </div>
            
            <footer class="footer">
                このページはGitHub Actionsにより自動生成されています。<br>
                最終取得時刻 (JST): {current_time_str}
            </footer>
        </div>
        
        <script>
            // === 検索機能 (修正済み) ===
            document.addEventListener('DOMContentLoaded', function() {{
                const searchInput = document.getElementById('searchInput');
                const statusContainer = document.getElementById('status-list-container');
                const allSections = statusContainer.querySelectorAll('.status-section');
                const noResults = document.getElementById('noResults');

                if (searchInput) {{
                    searchInput.addEventListener('input', function() {{
                        const searchTerm = searchInput.value.toLowerCase().trim();
                        let visibleCount = 0;
                        
                        allSections.forEach(function(section) {{
                            const searchContent = section.getAttribute('data-search-content').toLowerCase();
                            
                            if (searchContent.includes(searchTerm)) {{
                                section.style.display = 'block';
                                visibleCount++;
                            }} else {{
                                section.style.display = 'none';
                            }}
                        }});
                        
                        if (visibleCount === 0 && searchTerm) {{
                            noResults.style.display = 'block';
                        }} else {{
                            noResults.style.display = 'none';
                        }}
                    }});
                }}
            }});
        </script>
    </body>
    </html>
    """
    return html_template
