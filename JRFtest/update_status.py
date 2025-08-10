def create_html(data):
    if not data: return ""

    jst = timezone(timedelta(hours=+9), 'JST')
    current_time_str = datetime.now(jst).strftime('%Y-%m-%d %H:%M:%S')

    # The original script splits by '<...>', which can be fragile.
    # A more robust way is to find all h2 and p tags within the content.
    # However, to stick to the original logic and avoid breaking changes,
    # we will process the status_text as requested.
    # Splitting by a known pattern like '<' followed by a line name '>'
    # is safer if the format is consistent.
    
    # We will assume the format is `<LINE NAME>...\n<LINE NAME>...`
    # The original regex `r'(<.+?>)'` works for this.
    raw_sections = re.split(r'(<.+?>)', data["status_text"])
    
    section_html = ""
    # The split results in ['', '<LINE 1>', 'details1', '<LINE 2>', 'details2', ...]. We iterate starting from index 1.
    if len(raw_sections) > 1:
        for i in range(1, len(raw_sections), 2):
            if i + 1 < len(raw_sections):
                header = raw_sections[i].strip()
                content_text = raw_sections[i+1].strip()
                
                content_lines = [highlight_keywords(line) for line in content_text.split('\n') if line.strip()]
                
                formatted_content = []
                for line in content_lines:
                    # Each train info line gets its own div for tight spacing
                    formatted_content.append(f'<div class="train-line">{line}</div>')
                
                content = ''.join(formatted_content)
                
                # The data-search-content attribute contains all text for filtering
                search_content = f"{header} {content_text}"
                
                section_html += f"""
                <div class="status-section" data-search-content="{search_content}">
                    <div class="card-header status-header">{header}</div>
                    <div class="card-body status-details">
                        {content if content else '<p class="no-info">詳細情報はありません。</p>'}
                    </div>
                </div>
                """

    overview_text_formatted = data["overview_text"].replace('<br>', '\n')

    # --- HTML & CSS TEMPLATE ---
    # The design is updated here.
    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況</title>
        <style>
            :root {{
                --jrf-blue: #0054A5; /* JR貨物のコーポレートカラー */
                --light-blue: #e7f0f7;
                --text-dark: #212529;
                --text-light: #6c757d;
                --bg-white: #ffffff;
                --bg-light: #f8f9fa;
                --border-color: #dee2e6;
                --font-family-sans-serif: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif;
                --font-family-monospace: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace;
            }}
            
            * {{
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }}
            
            body {{
                font-family: var(--font-family-sans-serif);
                background-color: var(--bg-light);
                color: var(--text-dark);
                line-height: 1.6;
                font-size: 16px;
            }}
            
            .container {{
                max-width: 960px;
                margin: 0 auto;
                padding: 30px 15px;
            }}
            
            .page-header {{
                text-align: center;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--border-color);
            }}

            .page-header h1 {{
                font-size: 28px;
                font-weight: 700;
                color: var(--jrf-blue);
                margin-bottom: 8px;
            }}
            
            .page-header .update-time {{
                font-size: 14px;
                color: var(--text-light);
            }}

            .card {{
                background-color: var(--bg-white);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                margin-bottom: 25px;
                box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
            }}

            .card-header {{
                padding: 12px 20px;
                background-color: var(--bg-light);
                border-bottom: 1px solid var(--border-color);
                font-weight: 600;
                border-radius: 8px 8px 0 0;
            }}

            .card-body {{
                padding: 20px;
                white-space: pre-line;
                line-height: 1.8;
                color: #343a40;
            }}

            .search-card .card-body {{
                padding: 20px;
            }}

            .search-input {{
                width: 100%;
                padding: 12px 16px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                font-size: 16px;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }}

            .search-input:focus {{
                outline: none;
                border-color: var(--jrf-blue);
                box-shadow: 0 0 0 3px var(--light-blue);
            }}

            .section-title-header {{
                text-align: center;
                font-size: 22px;
                font-weight: 600;
                margin: 40px 0 20px 0;
                color: var(--text-dark);
            }}

            .status-section {{
                background: var(--bg-white);
                border: 1px solid var(--border-color);
                border-radius: 8px;
                margin-bottom: 15px;
                box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
                overflow: hidden; /* Ensures child border-radius works */
            }}

            .status-header {{
                background-color: var(--jrf-blue);
                color: white;
                font-weight: 600;
                font-size: 16px;
            }}

            .status-details {{
                padding: 12px 16px;
                font-family: var(--font-family-monospace);
                font-size: 13px; /* Smaller font for dense info */
                line-height: 1.4; /* Tighter line height */
                color: #343a40;
                background: #fff;
                white-space: pre-wrap; /* Allows wrapping but respects newlines */
                word-break: break-all;
                border-radius: 0;
            }}

            .train-line {{
                padding: 1px 0; /* Minimal vertical padding */
                margin: 0;
            }}
            
            .no-info {{
                color: var(--text-light);
                font-style: italic;
            }}

            .status-badge {{
                display: inline-block;
                padding: 3px 8px;
                border-radius: 4px;
                font-weight: 500;
                font-size: 12px;
                font-family: var(--font-family-sans-serif);
                border: 1px solid transparent;
            }}
            
            .status-stopped {{ background-color: #f8d7da; color: #721c24; border-color: #f5c6cb; }}
            .status-delay {{ background-color: #fff3cd; color: #856404; border-color: #ffeeba; }}
            .status-cancelled {{ background-color: #e2e3e5; color: #383d41; border-color: #d6d8db; }}
            .status-suspended {{ background-color: #d1ecf1; color: #0c5460; border-color: #bee5eb; }}

            .no-results {{
                text-align: center;
                padding: 40px 20px;
                color: var(--text-light);
                font-style: italic;
                display: none; /* Hidden by default */
                background-color: var(--bg-white);
                border-radius: 8px;
            }}
            
            .page-footer {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 1px solid var(--border-color);
                color: var(--text-light);
                text-align: center;
                font-size: 13px;
                line-height: 1.6;
            }}

            @media (max-width: 768px) {{
                body {{ font-size: 14px; }}
                .container {{ padding: 20px 15px; }}
                .page-header h1 {{ font-size: 24px; }}
                .section-title-header {{ font-size: 20px; }}
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <header class="page-header">
                <h1>JR貨物 輸送状況</h1>
                <div class="update-time">サイト更新: {data["update_time"]}</div>
            </header>
            
            <div class="card search-card">
                <div class="card-header">フィルタ検索</div>
                <div class="card-body">
                    <input type="text" class="search-input" id="searchInput" placeholder="例: 東海道、遅れ、運休、列車番号など">
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">標題</div>
                <div class="card-body">{data["title"]}</div>
            </div>
            
            <div class="card">
                <div class="card-header">{data["overview_title"]}</div>
                <div class="card-body">{overview_text_formatted}</div>
            </div>
            
            <h2 class="section-title-header">{data["status_title"]}</h2>
            
            <div class="status-list">
                {section_html}
            </div>
            
            <div class="no-results" id="noResults">
                検索条件に一致する情報が見つかりませんでした。
            </div>
            
            <footer class="page-footer">
                このページはGitHub Actionsにより自動生成されています。<br>
                最終取得時刻 (JST): {current_time_str}
            </footer>
        </div>
        
        <script>
            // The search filter script remains compatible with the new structure.
            document.addEventListener('DOMContentLoaded', function() {{
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {{
                    searchInput.addEventListener('input', function(e) {{
                        const searchTerm = e.target.value.toLowerCase().trim();
                        const sections = document.querySelectorAll('.status-section');
                        const noResults = document.getElementById('noResults');
                        let visibleCount = 0;
                        
                        sections.forEach(function(section) {{
                            const searchContent = section.getAttribute('data-search-content').toLowerCase();
                            
                            if (searchContent.includes(searchTerm)) {{
                                section.style.display = 'block';
                                visibleCount++;
                            }} else {{
                                section.style.display = 'none';
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
        </script>
    </body>
    </html>
    """
    return html_template
