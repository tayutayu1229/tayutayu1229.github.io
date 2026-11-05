# JRF Freight Flow

JR貨物コンテナ時刻表（GTFS）を、業務確認しやすい白ベースの画面に整理した静的Webアプリです。

## 主な機能

- 現在時刻を含む輸送計画、今後60分の発車、方面別件数のダッシュボード
- 列車番号・発着駅・経由駅・方面・状態による検索
- 全国貨物地点マップ、選択経路、時刻表上の推定位置
- 駅・ORS・営業所別の発着ボード
- 列車詳細タイムライン、印刷、最大3件の比較
- お気に入り、ライト／ダークテーマ、表示密度、自動更新設定
- 操作ガイドとデータ上の注意事項
- JR貨物公式発表に基づく遅延列車・現在地・遅れ分数の表示
- 遅れを反映した到着見込と推定位置
- 設定画面から開けるシステムコンソール

## 起動

```sh
npm run serve
```

ブラウザで `http://localhost:4173` を開きます。ローカルファイルを直接開く方式ではデータを読み込めません。

遅延情報は本番の定期取得APIを優先し、接続できない場合は取得済みの `data/freight-status.json` を表示します。更新にはPython 3とBeautiful Soupが必要です。リポジトリルートで `python3 -m pip install -r JRF_status/requirements.txt` を実行してください。

## GitHub Pagesで公開

このアプリは `tayutayu1229.github.io` リポジトリの次の場所へ配置します。

```text
tayutayu1229.github.io/
├── .github/
│   └── workflows/
│       └── update-status.yml
└── JRF_status/
    └── JRF-gtfs/
        ├── index.html
        ├── app.js
        ├── styles.css
        ├── scripts/
        └── data/
```

重要: `.github` フォルダは `JRF_status/JRF-gtfs` の中ではなく、リポジトリの最上部へ置きます。

1. このフォルダ内のWebアプリ一式を `JRF_status/JRF-gtfs/` へpushします。
2. `.github/workflows/update-status.yml` だけは、リポジトリ最上部の同じパスへpushします。
3. **Settings → Pages → Source** は、既存サイトと同じ **Deploy from a branch / main / (root)** のままにします。
4. **Actions → JR Freight status update → Run workflow** を一度実行します。

本番は既存サーバーから7分周期の取得結果を受け取ります。GitHub Actionsは毎時の静的予備データ更新です。APIに接続できない場合は取得日時を示して予備データを使います。手動更新はActions画面の **Run workflow**、ローカルでの遅延JSON生成は次で実行できます。

```sh
npm run fetch-status
```

GitHub Pagesではサーバーを常駐できないため、Actionsが `data/freight-status.json` を更新します。JSON更新のコミットを既存のGitHub Pagesが公開するため、リポジトリ内のほかのサイトには影響しません。

## データ更新

ODPTからGTFS zipを取得した後、次を実行します。

```sh
node scripts/prepare-data.mjs /path/to/JR-Freight-Train-GTFS-2500.zip
```

2500m版と1000m版は同じ処理で切り替えられます。ODPT接続はCloudflare Workerを経由し、資格情報をブラウザーに保持しません。

## 表示上の注意

- 本データは計画時刻表で、リアルタイム在線情報ではありません。
- 地図上の列車位置は時刻と経路形状からの概算です。
- 地図の緑線と「レ」は鉄道、橙の点線と「便」はオフレール輸送です。「配送」はGTFSの便番号が設定されていない道路接続を示します。
- 遅延は公式発表とGTFSの出発日・列車番号を照合します。直近20分以内に取得を確認できない情報や取得失敗後の前回情報は、到着見込へ自動反映しません。表示される到着見込・推定位置は概算です。
- 配布元の説明に基づき、休日・曜日による運休情報は反映していません。
- 利用・公開時はODPTデータセットのライセンスとクレジット条件を確認してください。

背景地図は国土地理院の地理院タイルを利用し、連続した取得失敗時はOpenStreetMapへ切り替えます。共通処理の `assets/js/base-map.js` もリポジトリに含めてください。
