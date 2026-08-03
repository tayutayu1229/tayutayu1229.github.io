# ATOS駅別遅延履歴

ODPT在線データを20秒ごとに取得し、駅到着・駅発車時点の遅延秒数をUbuntuのSQLiteへ保存する常駐サービスです。ブラウザが開かれていない時間も収集します。

## 保存

- 既定DB: `/srv/atos-delay-history/history.sqlite3`
- SQLite WALモード
- 同一列車・駅・状態・遅延秒数の重複は保存しません
- 自動削除は行いません

## API

- `GET /health`
- `GET /api/v1/train-history?date=YYYY-MM-DD&railway=...&trainNumber=...`

書き込みAPIは公開せず、Ubuntu自身の収集処理だけがDBを更新します。

## 配置

1. 専用利用者 `atos-history` と `/srv/atos-delay-history` を作る
2. `atos_delay_history.py` を `/opt/atos-delay-history/` へ配置して実行可能にする
3. 環境ファイルを `/etc/atos-delay-history.env` へ配置
4. systemdユニットを `/etc/systemd/system/` へ配置
5. NginxまたはCloudflare Tunnelで `history.tayunet-traininfo.com` を `127.0.0.1:8787` へ接続
6. `systemctl enable --now atos-delay-history` を実行

Ubuntuでは、管理者権限なしで更新できるDocker構成も利用できます。`Dockerfile`をビルドし、`/mnt/hdd/atos-delay-history`をコンテナの`/data`へ割り当てます。公開用Cloudflare Tunnelは既存トンネルへ混在させず、`history.tayunet-traininfo.com`専用トンネルを使用します。
