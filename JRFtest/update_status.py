import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import os
import json

# --- 設定項目 ---
# あなたのGitHub情報に書き換えてください。前回お聞きした内容で設定済みです。
USER_NAME = "tayutayu1229"
REPO_NAME = "tayutayu1229.github.io"
TARGET_FILE = "JRFtest/jr_freight_status.html" # 生成するHTMLファイルの場所
BRANCH_NAME = "main" # GitHub Pagesで使っているブランチ名 (通常は "main" or "master")
# ----------------

def fetch_and_parse_data():
    """
    JR貨物の輸送状況ページからデータを取得し、解析します。
    """
    url = "https://www.jrfreight.co.jp/i_daiya"
    try:
        response = requests.get(url)
        response.encoding = 'shift_jis'
        soup = BeautifulSoup(response.text, 'html.parser')

        update_time_element = soup.find('div', align='right')
        update_time = update_time_element.text.strip() if update_time_element else "不明"

        tables = soup.find_all('table')
        status_data = []
        if len(tables) > 1:
            rows = tables[1].find_all('tr')
            for row in rows[1:]:
                cols = row.find_all('td')
                if len(cols) >= 3:
                    direction = cols[0].text.strip()
                    area = cols[1].text.strip()
                    status = cols[2].text.strip().replace('\n', '<br>')
                    status_data.append({
                        "direction": direction,
                        "area": area,
                        "status": status,
                    })
        return {"update_time": update_time, "status_data": status_data}
    except requests.exceptions.RequestException as e:
        print(f"データ取得エラー: {e}")
        return None

def create_html(data):
    """
    取得したデータからHTMLコンテンツを生成します。
    """
    if not data:
        return ""

    jst = timezone(timedelta(hours=+9), 'JST')
    current_time_str = datetime.now(jst).strftime('%Y-%m-%d %H:%M:%S')

    table_rows = ""
    for item in data["status_data"]:
        table_rows += f"""
        <tr>
            <td>{item['direction']}</td>
            <td>{item['area']}</td>
            <td>{item['status']}</td>
        </tr>
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
            body {{ padding: 2em; }}
            .footer {{ margin-top: 2em; font-size: 0.9em; color: #6c757d; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1 class="my-4">JR貨物 輸送状況</h1>
            <p><strong>サイト更新日時:</strong> {data["update_time"]}</p>
            <div class="table-responsive">
                <table class="table table-bordered table-striped">
                    <thead class="thead-dark">
                        <tr>
                            <th>方面</th>
                            <th>地区</th>
                            <th>状況</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table_rows}
                    </tbody>
                </table>
            </div>
            <p class="footer">このページは <a href="https://github.com/{USER_NAME}/{REPO_NAME}" target="_blank" rel="noopener">GitHub Actions</a> により自動生成されています。<br>
            最終取得時刻 (JST): {current_time_str}</p>
        </div>
    </body>
    </html>
    """
    return html_template

def update_github_file(content):
    """
    GitHub APIを使ってファイルを更新します。デバッグ情報を多く出力します。
    """
    token = os.getenv('GITHUB_TOKEN')
    if not token:
        print("デバッグ: GITHUB_TOKENが設定されていません。処理を中断します。")
        return

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    url = f"https://api.github.com/repos/{USER_NAME}/{REPO_NAME}/contents/{TARGET_FILE}"
    
    print(f"デバッグ: GitHub API URL: {url}")

    # ファイルの現在のSHAを取得
    sha = None
    try:
        print("デバッグ: 既存ファイルのSHAを取得します...")
        r = requests.get(url, headers=headers)
        r.raise_for_status()
        sha = r.json().get('sha')
        print(f"デバッグ: 既存ファイルを発見しました。SHA: {sha}")
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            print("デバッグ: ファイルはまだ存在しません。新規作成します。")
            sha = None
        else:
            print(f"デバッグ: SHA取得中にHTTPエラーが発生しました: {e}")
            raise

    # ファイルを更新または作成
    data = {
        "message": f"Update JR Freight status ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})",
        "content": content.encode('utf-8').hex(),
        "branch": BRANCH_NAME
    }
    if sha:
        data["sha"] = sha

    print(f"デバッグ: ファイルを {BRANCH_NAME} ブランチに書き込みます...")
    r = requests.put(url, headers=headers, data=json.dumps(data))
    
    print(f"デバッグ: GitHub APIからのレスポンスコード: {r.status_code}")
    print(f"デバッグ: レスポンス内容: {r.text}")

    if r.status_code not in [200, 201]:
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
        print("データのスクレイピングに失敗しました。")
