# Ubuntu履歴サーバー更新

## 確認結果（2026-08-08 15:35 JST）

- API: 正常
- 連続失敗: 0
- 最終取得列車: 393列車
- 保存済み観測: 1,056,059件
- 保存範囲: 2026-08-03～2026-08-08
- 現在の保持設定: 30日

`server/atos-delay-history/`の更新版をUbuntuへ配置し、環境設定を次のように変更してください。

```text
ATOS_HISTORY_RETENTION_DAYS=120
```

サービス方式の場合はPythonファイルと環境設定を差し替えてから再起動します。

```bash
sudo systemctl restart atos-delay-history
sudo systemctl status atos-delay-history --no-pager
curl -fsS http://127.0.0.1:8787/health
```

Docker方式の場合は更新版Dockerfileで再ビルドしてください。DBの保存先ボリュームは削除せず、そのまま引き継ぎます。

更新版は起動時に`train_states`テーブルを自動追加します。既存の`observations`は維持されます。既に30日設定で削除されたデータは復元されません。

## 保存期間

- 標準: 120日（約4か月）
- 設定可能な上限: 275日（約9か月）
- まず120日でDB容量を監視し、余裕がある場合のみ275日へ延長してください。

## 更新後の確認

公開経路から次を確認します。

```bash
curl -fsS https://history.tayunet-traininfo.com/health
curl -fsS 'https://history.tayunet-traininfo.com/api/v1/statistics?days=120'
```

`retention_days`が`120`、`last_error`が`null`、`consecutive_failures`が`0`なら正常です。
