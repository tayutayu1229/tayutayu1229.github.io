# 貨物情報の定期取得

本番の更新はGitHub ActionsのスケジュールやGitHub Pagesの公開待ちに依存しません。
既存の監視プロセスに独立した取得スレッドを追加し、7分周期で公式HPを取得します。
画面の読み込みで公式HPへの追加アクセスは発生しません。

## 配信と保護

- 公開URL：`https://incident-api.tayunet-traininfo.com/server-monitor/freight-status`
- 応答：`data`（列車・概要）、`health`（試行と成功の日時・失敗・時間外）、`collector`（周期と次回予定）を1つのJSONで返します。
- 公開するのはJR貨物の公開情報だけです。管理APIの認証は維持しています。
- 既存のCloudflare Tunnel経路を使用し、新しいポートやDNSは外部へ公開しません。
- 更新は成功・失敗・時間外を区別し、失敗時は直前の情報を保持します。書き込みは置換して途中の内容を返しません。
- 20分以上確認できない場合は古い情報として扱い、到着見込へ自動反映しません。
- APIに接続できない場合のみ、画面はGitHub Pagesの予備データへ切り替え、代替表示と取得日時を示します。APIが返した公式取得失敗を、古い成功結果で隠しません。

## サーバーの設定

`monitor_service.py` と同じ場所に `freight_feed.py` と設定ファイル `freight-feed.config.json` を配置します。
設定ファイルがなければ取得機能は無効で、従来の監視だけが動作します。
実際の配置前に既存コードの差分を確認し、バックアップと復旧手順を用意します。

```json
{
  "directory": "/path/to/private-state/freight",
  "python": "/path/to/freight-venv/bin/python",
  "scraper": "/path/to/freight_scraper.py",
  "intervalSeconds": 420
}
```

- `freight_scraper.py` は `JRF_status/scraper.py` のコピーです。
- 専用venvへ `JRF_status/requirements.txt` をインストールします。監視本体のPython環境は変更しません。
- 初回配置時は既存の `freight-status.json` / `fetch-health.json` を状態フォルダーへコピーしておくと、起動直後にも前回情報を使えます。
- PM2の既存監視プロセスを再起動します。起動直後に取得し、以降は7分周期。取得中に重複実行しません。
- `live-bundle.json` に最後の配信内容を保存し、再起動後も引き継ぎます。
- 設定が壊れても管理監視まで停止しないよう、貨物取得を無効化してエラーを記録します。

## 検証

```sh
python3 -m unittest discover -s server-monitor/tests -p test_freight_feed.py
python3 -m unittest discover -s JRF_status/tests
node tests/freight-status-client.test.js
node tests/freight-monitor.test.js
```

本番では以下を確認します。

1. `health.checkedAt` と `collector.nextCheckAt` が返ること。
2. 約7分後、手動起動なしで `health.checkedAt` が進むこと。
3. 同じホストの `/server-monitor/api/status` が匿名で401になること。
4. 貨物画面・輸送状況HTML・監視画面が同じ取得結果を表示すること。

## GitHubの予備更新

`.github/workflows/update-status.yml` は毎時17分を目安に静的な予備データを更新します。
GitHubの遅延はあり得るため、本番の7分周期の役割は持たせません。
画面の公開はコード変更時に必要ですが、日々の貨物更新ごとには不要です。

## 復旧

貨物機能の問題が監視本体へ波及する場合は、設定ファイルを退避して監視プロセスを再起動すると追加機能を止められます。
必要なら配置前に保存した監視スクリプトへ復元します。
フロントエンドはAPIの接続失敗時、静的な予備データへ自動で切り替わります。
停止した取得を正常と誤認しないよう、予備データの実際の取得時刻も表示します。
