# JR東日本 新着Webサイト・Discord通知

JR東日本の[ニュースリリース](https://www.jreast.co.jp/press/)と[お知らせ](https://www.jreast.co.jp/information/)を確認し、一覧サイトを `tayutayu1229.github.io/JREgyoumu/press/` へ公開するとともに、新着だけをDiscord Webhookへ通知します。外部ライブラリは不要です。

## 最初の設定

1. Discordで通知先チャンネルの「連携サービス」→「ウェブフック」からWebhookを作ります。
2. `tayutayu1229/tayutayu1229.github.io` リポジトリへ、下記の配置でファイルを登録します。
3. 同リポジトリの `Settings` → `Secrets and variables` → `Actions` に `DISCORD_WEBHOOK_URL` を登録します。値はDiscordで作成したWebhook URLです。
4. `Settings` → `Actions` → `General` → `Workflow permissions` で **Read and write permissions** を選択します。
5. GitHubの `Actions` からワークフローを一度手動実行します。初回は現在の記事を通知済みとして登録するため、過去分は一斉通知されません。
6. 実行後、<https://tayutayu1229.github.io/JREgyoumu/press/> でサイトを確認します。以後は毎時7分・37分（約30分ごと）にサイト更新と新着通知が動きます。

## GitHub上の配置

```text
tayutayu1229.github.io/
├── .github/
│   └── workflows/
│       └── notify.yml
└── JREgyoumu/
    └── press/
        ├── scraper.py
        ├── README.md
        ├── index.html
        ├── .nojekyll
        └── tests/
            └── test_scraper.py
```

`notify.yml` だけはGitHubの仕様により、`JREgyoumu/press` ではなくリポジトリ直下の `.github/workflows` に置きます。`data/state.json`、`data/items.json`、`items.json` は最初のActions実行時に自動作成されます。

`SITE_DEPLOY_TOKEN` は不要です。同じリポジトリ内なので、GitHub Actions標準の権限だけで更新します。

## 手元で確認

Discordへ送らず取得内容を見るには次を実行します。

```sh
python3 JREgyoumu/press/scraper.py --dry-run --output JREgyoumu/press
```

実行すると `JREgyoumu/press/index.html` と機械可読な `JREgyoumu/press/items.json` が生成されます。

テストは次で実行できます。

```sh
python3 -m unittest discover -s JREgyoumu/press/tests
```

## 注意

- Webhook URLはパスワードと同様に扱い、コードや画面共有へ載せないでください。
- JR東日本側のアクセス制限やページ構造変更時は処理が失敗します。解析結果が0件の場合は履歴を更新せず、安全側で停止します。
- アクセス拒否や通信障害時は、公開ページ上部に障害案内を表示し、取得済みの前回データを残します。初回から取得できなかった場合は案内のみ表示します。
- 短すぎる間隔での実行は避けてください。標準設定は約30分ごとです。
