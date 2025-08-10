import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import os
import json

# --- 設定項目 ---
# このスクリプトを置いているGitHubリポジトリの情報に書き換えてください
# 例: "https://github.com/TaroYamada/my-website" の場合
USER_NAME = "tayutayu1229"  # あなたのGitHubユーザー名
REPO_NAME = "tayutayu1229.github.io"  # あなたのGitHubリポジトリ名
TARGET_FILE = "JRFtest/jr_freight_status.html" # 生成するHTMLファイル名
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
    GitHub APIを使ってファイルを更新します。
    """
    token = os.getenv('GITHUB_TOKEN')
    if not token:
        print("エラー: GITHUB_TOKENが設定されていません。")
        return

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    url = f"https://api.github.com/repos/{USER_NAME}/{REPO_NAME}/contents/{TARGET_FILE}"

    # ファイルの現在のSHAを取得
    try:
        r = requests.get(url, headers=headers)
        r.raise_for_status()
        sha = r.json().get('sha')
    except requests.exceptions.HTTPError:
        sha = None # ファイルが存在しない場合

    # ファイルを更新または作成
    data = {
        "message": f"Update JR Freight status ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})",
        "content": content.encode('utf-8').hex(), # contentはhexでエンコード
        "branch": "main" # ご自身のブランチ名に合わせてください (例: master)
    }
    if sha:
        data["sha"] = sha

    r = requests.put(url, headers=headers, data=json.dumps(data))
    if r.status_code == 200 or r.status_code == 201:
        print(f"ファイルが正常に更新/作成されました: {r.json()['content']['html_url']}")
    else:
        print(f"ファイルの更新に失敗しました: {r.status_code}")
        print(r.text)


if __name__ == "__main__":
    scraped_data = fetch_and_parse_data()
    if scraped_data:
        html_content = create_html(scraped_data)
        # スクリプトをローカルでテストする場合は以下の行をコメントアウトしてください
        update_github_file(html_content)
        # ローカルでのテスト用にHTMLファイルを出力する場合は以下の行のコメントを外してください
        # with open(TARGET_FILE, "w", encoding="utf-8") as f:
        #     f.write(html_content)
        # print(f"{TARGET_FILE} を生成しました。")
