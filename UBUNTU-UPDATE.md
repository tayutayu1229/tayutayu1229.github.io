# Ubuntu履歴サーバー更新

`server/atos-delay-history/`の更新版をUbuntuへ配置し、環境設定を次のように変更してください。

```text
ATOS_HISTORY_INTERVAL=3
ATOS_HISTORY_RETENTION_DAYS=120
ATOS_HISTORY_MAX_STORAGE_GB=230
```

サービス方式の場合はPythonファイルと環境設定を差し替えてから再起動します。

```bash
sudo systemctl restart atos-delay-history
sudo systemctl status atos-delay-history --no-pager
curl -fsS http://127.0.0.1:8787/health
```

Docker方式の場合は更新版Dockerfileで再ビルドしてください。DBの保存先ボリュームは削除せず、そのまま引き継ぎます。

既存の`observations`は維持されます。更新前にDBファイルを退避し、旧コンテナは動作確認が終わるまで停止状態で残してください。

## 保存期間

- 標準: 120日（約4か月）
- 容量上限: 230GB
- フォルダの実効使用量が上限の95%に達すると、古い実績から自動整理して90%まで戻します。

## 更新後の確認

公開経路から次を確認します。

```bash
curl -fsS https://history.tayunet-traininfo.com/health
curl -fsS 'https://history.tayunet-traininfo.com/api/v1/statistics?days=120'
```

`interval_seconds`が`3`、`retention_days`が`120`、`storage.maxGigabytes`が`230`、`last_error`が`null`、`consecutive_failures`が`0`なら正常です。
