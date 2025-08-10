import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import os
import json
import base64

# --- 設定項目 ---
USER_NAME = "tayutayu1229"
REPO_NAME = "tayutayu1229.github.io"
TARGET_FILE = "JRFtest/jr_freight_status.html"
BRANCH_NAME = "main"
# ----------------

def fetch_and_parse_data():
    """
    JR貨物の新しいウェブサイト構造からデータを取得し、解析します。
    """
    url = "https://www.jrfreight.co.jp/i_daiya"
    print("デバッグ: データ取得を開始します...")
    try:
        response = requests.get(url)
        # JR貨物サイトは現在UTF-8になりました
        response.encoding = 'utf-8'
        soup = BeautifulSoup(response.text, 'html.parser')

        # サイトの更新時刻を取得
        update_time_elem = soup.find('div', id='pbBlock91534')
        update_time = update_time_elem.text.strip() if update_time_elem else "不明"
        
        # 標題を取得
        title_elem = soup.find('div', id='pbBlock91536')
        title = title_elem.text.strip() if title_elem else "（標題なし）"

        # 輸送状況の詳細を取得
        content_elem = soup.find('div', class_='base_daiya-content')
        if not content_elem:
            print("デバッグ: 'base_daiya-content' の要素が見つかりませんでした。")
            return None

        # 概要と線区情報を取得
        h2_tags = content_elem.find_all('h2')
        p_tags = content_elem.find_all('p')
        
        overview_title = h2_tags[0].text.strip() if len(h2_tags) > 0 else "概要"
        overview_text = p_tags[0].get_text('\n', strip=True) if len(p_tags) > 0 else "情報なし"
        
        status_title = h2_tags[1].text.strip() if len(h2_tags) > 1 else "線区情報"
        # <br>タグを改行に変換してテキストを取得
        for br in p_tags[1].find_all("br"):
            br.replace_with("\n")
        status_text = p_tags[1].text.strip() if len(p_tags) > 1 else "情報なし"
        
        print("デバッグ: データの取得に成功しました。")
        return {
            "update_time": update_time,
            "title": title,
            "overview_title": overview_title,
            "overview_text": overview_text,
            "status_title": status_title,
            "status_text": status_text,
        }

    except requests.exceptions.RequestException as e:
        print(f"データ取得エラー: {e}")
        return None
    except Exception as e:
        print(f"解析中に予期せぬエラーが発生しました: {e}")
        return None

def create_html(data):
    """
    新しいデータ構造からHTMLコンテンツを生成します。
    """
    if not data:
        print("デバッグ: create_htmlにデータが渡されませんでした。")
        return ""

    jst = timezone(timedelta(hours=+9), 'JST')
    current_time_str = datetime.now(jst).strftime('%Y-%m-%d %H:%M:%S')

    # <pre>タグはテキストの改行やスペースをそのまま表示するのに便利です
    html_template = f"""
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>JR貨物 輸送状況</title>
        <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
        <style>
            body {{ padding: 2em; }}
            .footer {{ margin-top: 2em; font-size: 0.9em; color: #6c757d; }}
            .content-box {{
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: .25rem;
                padding: 1.25rem;
                white-space: pre-wrap; /* 改行を有効にする */
                word-wrap: break-word;
            }}
            h2 {{
                border-bottom: 2px solid #007bff;
                padding-bottom: .5rem;
                margin-top: 1.5rem;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1 class="my-4">JR貨物 輸送状況</h1>
            <p><strong>サイト更新日時:</strong> {data["update_time"]}</p>

            <h2>{data["title"]}</h2>
            
            <h2 class="mt-4">{data["overview_title"]}</h2>
            <div class="content-box">
                <p>{data["overview_text"]}</p>
            </div>
            
            <h2 class="mt-4">{data["status_title"]}</h2>
            <pre class="content-box">{data["status_text"]}</pre>
            
            <p class="footer">このページは <a href="https://github.com/{USER_NAME}/{REPO_NAME}" target="_blank" rel="noopener">GitHub Actions</a> により自動生成されています。<br>
            最終取得時刻 (JST): {current_time_str}</p>
        </div>
    </body>
    </html>
    """
    return html_template

def update_github_file(content):
    """
    GitHub APIを使ってファイルを更新します。
    """
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
