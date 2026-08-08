# ATOS駅別遅延履歴

ODPT在線データを20秒ごとに取得し、駅到着・駅発車時点の遅延秒数をUbuntuのSQLiteへ保存する常駐サービスです。ブラウザが開かれていない時間も収集します。

## 保存

- 既定DB: `/srv/atos-delay-history/history.sqlite3`
- SQLite WALモード
- 同一列車・駅・状態・遅延秒数の重複は保存しません
- 既定で120日（約4か月）保存し、運転日単位で自動削除します
- `ATOS_HISTORY_RETENTION_DAYS`で1～275日（約9か月）の範囲に変更できます
- 列車ごとの初回・最終在線、実際の行先、線区跨ぎを別テーブルへ軽量保存します

## API

- `GET /health`
- `GET /api/v1/train-history?date=YYYY-MM-DD&railway=...&trainNumber=...`
- `GET /api/v1/statistics?days=120`

列車履歴APIは`railway`を基準線区として取得します。直通・線区跨ぎを統合する場合は、時刻表上で接続を確認した線区を`relatedRailway`として複数指定します。
過去実績からの駅間遅延増減と、候補が一意に確定した継走列車も返します。候補が複数ある場合は誤表示防止のため返しません。

## 既存環境を120日保持へ変更

`/etc/atos-delay-history.env`の`ATOS_HISTORY_RETENTION_DAYS`を`120`へ変更してサービスを再起動してください。既に削除された過去データは復元されませんが、変更後のデータは120日間残ります。

書き込みAPIは公開せず、Ubuntu自身の収集処理だけがDBを更新します。

## 配置

1. 専用利用者 `atos-history` と `/srv/atos-delay-history` を作る
2. `atos_delay_history.py` を `/opt/atos-delay-history/` へ配置して実行可能にする
3. 環境ファイルを `/etc/atos-delay-history.env` へ配置
4. systemdユニットを `/etc/systemd/system/` へ配置
5. NginxまたはCloudflare Tunnelで `history.tayunet-traininfo.com` を `127.0.0.1:8787` へ接続
6. `systemctl enable --now atos-delay-history` を実行

Ubuntuでは、管理者権限なしで更新できるDocker構成も利用できます。`Dockerfile`をビルドし、`/mnt/hdd/atos-delay-history`をコンテナの`/data`へ割り当てます。公開用Cloudflare Tunnelは既存トンネルへ混在させず、`history.tayunet-traininfo.com`専用トンネルを使用します。
