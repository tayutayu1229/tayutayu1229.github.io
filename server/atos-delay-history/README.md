# ATOS駅別遅延履歴

ODPT在線データを既定10秒ごとに取得し、駅到着・駅発車時点の遅延秒数をUbuntuのSQLiteへ保存する常駐サービスです。ブラウザが開かれていない時間も収集します。

## 保存

- 既定DB: `/srv/atos-delay-history/history.sqlite3`
- SQLite WALモード
- 同一列車・駅・状態・遅延秒数の重複は保存しません
- 実績時刻はサーバー受信時刻ではなく、在線データの`dc:date`を優先して秒単位で保存します
- 行先を保存し、過去の通常行先と異なる運転を遅延分析へ出力します
- 過去日の駅間遅延変化を集計し、先駅での回復・増加予測へ利用します
- 30日を過ぎた実績は運転日単位で自動削除します（`ATOS_HISTORY_RETENTION_DAYS`で変更可能）

## API

- `GET /health`
- `GET /api/v1/train-history?date=YYYY-MM-DD&railway=...&trainNumber=...`
- `GET /api/v1/statistics?days=30`

列車履歴APIは`railway`を基準線区として取得します。直通・線区跨ぎを統合する場合は、時刻表上で接続を確認した線区を`relatedRailway`として複数指定します。

書き込みAPIは公開せず、Ubuntu自身の収集処理だけがDBを更新します。

## 配置

1. 専用利用者 `atos-history` と `/srv/atos-delay-history` を作る
2. `atos_delay_history.py` を `/opt/atos-delay-history/` へ配置して実行可能にする
3. 環境ファイルを `/etc/atos-delay-history.env` へ配置
4. systemdユニットを `/etc/systemd/system/` へ配置
5. NginxまたはCloudflare Tunnelで `history.tayunet-traininfo.com` を `127.0.0.1:8787` へ接続
6. `systemctl enable --now atos-delay-history` を実行

Ubuntuでは、管理者権限なしで更新できるDocker構成も利用できます。`Dockerfile`をビルドし、`/mnt/hdd/atos-delay-history`をコンテナの`/data`へ割り当てます。公開用Cloudflare Tunnelは既存トンネルへ混在させず、`history.tayunet-traininfo.com`専用トンネルを使用します。
