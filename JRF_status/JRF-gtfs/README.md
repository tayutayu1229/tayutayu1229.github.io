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

`npm run serve` は画面配信に加え、`/api/freight-status` でJR貨物公式発表を整形した既存システムから遅延情報を取得します。Pythonの簡易サーバーでは遅延情報を取得できません。

## GitHub Pagesで公開

このアプリは `tayutayu1229.github.io` リポジトリの次の場所へ配置します。

```text
tayutayu1229.github.io/
├── .github/
│   └── workflows/
│       └── update-jrf-gtfs-status.yml
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
2. `.github/workflows/update-jrf-gtfs-status.yml` だけは、リポジトリ最上部の同じパスへpushします。
3. **Settings → Pages → Source** は、既存サイトと同じ **Deploy from a branch / main / (root)** のままにします。
4. **Actions → Update JRF GTFS status → Run workflow** を一度実行します。

以後は毎時12分・42分に遅延情報を取得し、変更があると `JRF_status/JRF-gtfs/data/freight-status.json` だけを自動コミットします。手動更新はActions画面の **Run workflow**、ローカルでの遅延JSON生成は次で実行できます。

```sh
npm run fetch-status
```

GitHub Pagesではサーバーを常駐できないため、Actionsが `data/freight-status.json` を更新します。JSON更新のコミットを既存のGitHub Pagesが公開するため、リポジトリ内のほかのサイトには影響しません。

## データ更新

ODPTからGTFS zipを取得した後、次を実行します。

```sh
node scripts/prepare-data.mjs /path/to/JR-Freight-Train-GTFS-2500.zip
```

2500m版と1000m版は同じ処理で切り替えられます。このプロジェクトは非公開の業務利用を前提に、指定されたODPTアクセストークンを `app.js` に保持しています。公開環境へ移す場合は、サーバー側の環境変数へ移してください。

## 表示上の注意

- 本データは計画時刻表で、リアルタイム在線情報ではありません。
- 地図上の列車位置は時刻と経路形状からの概算です。
- 地図の緑線と「レ」は鉄道、橙の点線と「便」はオフレール輸送です。「配送」はGTFSの便番号が設定されていない道路接続を示します。
- 遅延は公式発表とGTFSの列車番号を照合し、同じ列車番号を含む輸送計画へ適用します。表示される到着見込・推定位置は概算です。
- 配布元の説明に基づき、休日・曜日による運休情報は反映していません。
- 利用・公開時はODPTデータセットのライセンスとクレジット条件を確認してください。
