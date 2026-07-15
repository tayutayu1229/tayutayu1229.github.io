# JR貨物 輸送状況ビューア

JR貨物公式サイトの公開情報を定期取得し、スマートフォンでも見やすい `index.html` を生成します。

## 使い方

1. このフォルダーをGitHubリポジトリへpushします。
2. GitHubの **Settings → Pages** で、`Deploy from a branch`、対象を `main` / `(root)` に設定します。
3. Actionsが毎時15分に更新します。最初だけ **Actions → JR Freight status update → Run workflow** から手動実行できます。

ローカル実行は次のとおりです。

```bash
python -m pip install -r requirements.txt
python scraper.py
```

取得や解析に失敗した場合、処理はエラー終了し、公開済みの `index.html` は上書きされません。

## 注意

- 表示内容はJR貨物公式サイトの公開情報を再構成したものです。正確な最新情報は必ず公式ページで確認してください。
- 取得頻度は先方サイトへの負荷を考慮して毎時1回にしています。
- JR貨物公式サイトのHTML構造が変わった場合は `scraper.py` の調整が必要になることがあります。
