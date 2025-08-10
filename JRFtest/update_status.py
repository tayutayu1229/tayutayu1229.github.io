import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import os
import json
import base64
import re #正規表現ライブラリを追加

# --- 設定項目 ---
USER_NAME = "tayutayu1229"
REPO_NAME = "tayutayu1229.github.io"
TARGET_FILE = "JRFtest/jr_freight_status.html"
BRANCH_NAME = "main"
# ----------------

def highlight_keywords(line):
    """
    行の中に含まれるキーワードをハイライトするためのHTMLタグで置換する
    """
    # キーワードと、それに対応するCSSクラスのマッピング
    highlights = {
        "停車中": "status-stopped",
        "遅れ": "status-delay",
        "運休": "status-cancelled",
        "見合わせ": "status-suspended",
    }
    for keyword, css_class in highlights.items():
        # 正規表現で行全体ではなく、単語としてキーワードを置換する
        line = re.sub(rf'\b{keyword}\b', f'<span class="status-badge {css_class}">{keyword}</span>', line)
    return line

def fetch_and_parse_data():
    """
    JR貨物の新しいウェブサイト構造からデータを取得し、解析します。
    """
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
        overview_text = p_tags[0].get_text('\n', strip=True) if len(p_tags) > 0 else "情報なし"
        
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
    """
    新しいデザインのHTMLコンテンツを生成します。
    """
    if not data: return ""

    jst = timezone(timedelta(hours=+9), 'JST')
    current_time_str = datetime.now(jst).strftime('%Y-%m-%d %H:%M:%S')

    # 運行情報をセクションごとに分割する
    sections = re.split(r'(<.+?>)', data["status_text"])
    accordion_html = ""
    # 最初の要素は空なのでスライスで除外
    for i in range(1, len(sections), 2):
        header = sections[i].strip()
        # 各行をハイライト処理
        content_lines = [highlight_keywords(line) for line in sections[i+1].strip().split('\n')]
        content = '<br>'.join(content_lines)
        
        # ユニークなIDを生成
        collapse_id = "collapse" + str(i)
        
        accordion_html += f"""
        <div class="card bg-dark text-white">
            <div class="card-header" id="heading{i}">
                <h2 class="mb-0">
                    <button class="btn btn-link btn-block text-left text-white" type="button" data-toggle="collapse" data-target="#{collapse_id}" aria-expanded="false" aria-controls="{collapse_id}">
                        {header}
                    </button>
                </h2>
            </div>
            <div id="{collapse_id}" class="collapse" aria-labelledby="heading{i}">
                <div class="card-body">
                    {content}
                </div>
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
        <style>
            body {{ background-color: #212529; color: #f8f9fa; }}
            .container {{ padding-top: 2rem; padding-bottom: 2rem; }}
            .card {{ border: 1px solid #495057; margin-bottom: 1rem; }}
            .card-header {{ background-color: #343a40; }}
            .card-body {{ background-color: #2c3034; font-family: 'monospace'; font-size: 0.9rem; }}
            .footer {{ margin-top: 2rem; color: #6c757d; text-align: center; }}
            .status-badge {{
                padding: 0.2em 0.6em;
                border-radius: 0.25rem;
                font-weight: 700;
                color: #fff;
            }}
            .status-stopped {{ background-color: #dc3545; }} /* 赤 */
            .status-delay {{ background-color: #fd7e14; }}   /* オレンジ */
            .status-cancelled {{ background-color: #6c757d; }} /* グレー */
            .status-suspended {{ background-color: #ffc107; color: #212529; }} /* 黄 */
        </style>
    </head>
    <body>
        <div class="container">
            <div class="text-center mb-4">
                <h1 class="display-4">JR貨物 輸送状況</h1>
                <p class="lead">サイト更新: {data["update_time"]}</p>
            </div>

            <div class="card bg-secondary text-white shadow-sm mb-4">
                <div class="card-body">
                    <h5 class="card-title">標題</h5>
                    <p class="card-text">{data["title"]}</p>
                </div>
            </div>

            <div class="card bg-secondary text-white shadow-sm mb-4">
                <div class="card-body">
                    <h5 class="card-title">{data["overview_title"]}</h5>
                    <p class="card-text">{data["overview_text"].replace('<br>', '\\n')}</p>
                </div>
            </div>
            
            <h3 class="text-center mb-3">{data["status_title"]}</h3>
            <div class="accordion" id="statusAccordion">
                {accordion_html}
            </div>

            <p class="footer">
                このページはGitHub Actionsにより自動生成されています。<br>
                最終取得時刻 (JST): {current_time_str}
            </p>
        </div>
        <script src="https://code.jquery.com/jquery-3.5.1.slim.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@popperjs/core@2.5.4/dist/umd/popper.min.js"></script>
        <script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js"></script>
    </body>
    </html>
    """
    return html_template

# 以下の部分は前回から変更ありません
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
