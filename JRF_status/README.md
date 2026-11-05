# JR貨物 輸送状況ビューア

本番は既存サーバーで7分周期に公式サイトを取得し、画面へ直接配信します。GitHub Actionsは毎時の静的な予備データ更新を担当します。詳細は [定期取得の運用手順](../server-monitor/FREIGHT-FEED.md) を参照してください。

## 更新方法

リポジトリルートで実行します。

```sh
python3 -m pip install -r JRF_status/requirements.txt
python3 -m unittest discover -s JRF_status/tests
python3 JRF_status/scraper.py --output JRF_status/index.html --json-output JRF_status/JRF-gtfs/data/freight-status.json
```

GitHubでは **Actions → JR Freight status update → Run workflow** から更新できます。定期更新は `.github/workflows/update-status.yml` にまとめています。コミットの作成者はGitHub Actionsのbotです。

## 取得と表示

- 改行・段落で行を分け、列車情報は列車名・現在地・状況を意味に基づいて分離します。駅名内の桁揃え空白は列の区切りとして扱いません。
- 複数列車番号と出発日を保存します。月初に前月発の列車が掲載される場合にも対応します。
- 取得・解析に失敗した場合はエラー終了し、公開済みのデータを更新しません。未認識の行を捨てて正常扱いにしません。
- 掲載のない状態は公式本文に明示されている場合に受け付けます。
- 正確な最新情報は [JR貨物公式サイト](https://www.jrfreight.co.jp/i_daiya.html) も確認してください。
