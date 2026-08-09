# 撮影記録アーカイブ Ubuntu API

「撮影記録アーカイブ」の写真原本、サムネイル、検索索引をUbuntuのHDDへ保存するAPIです。Firebase AuthenticationのIDトークンを検証するため、Firebaseのメールアドレスやパスワードをこのサーバーへ保存しません。

## 保存場所

既定では `/mnt/hdd/tayunet-photo-archive` に保存します。

- `archive.sqlite3`: 撮影情報・EXIF・タグ・権限・共有リンク・フレンド・グループ
- `originals/<Firebase UID>/`: 原寸画像
- `thumbnails/<Firebase UID>/`: 一覧用JPEG
- `exports/`: ZIP作成中だけ使う一時領域（ダウンロード後に自動削除）

写真をゴミ箱へ入れてから30日後、次回の一覧取得またはアップロード時に原本とサムネイルを自動削除します。

## Ubuntuへの導入

Ubuntu上で最新のサイトリポジトリを取得し、このディレクトリから実行します。

```bash
cd /path/to/tayutayu1229.github.io/server/photo-archive
sudo sh install-photo-archive.sh
curl --fail http://127.0.0.1:8790/health
sudo docker ps --filter name=tayunet-photo-archive
```

フレンド検索は、写真アーカイブの利用履歴ではなく Firestore の検索専用 `photo_member_directory` を参照します。アカウント管理画面が承認済み一般利用者の名前・メール・有効状態だけを同期し、`users` 本体の権限・監査・ログイン情報は一般利用者へ公開しません。`firestore.rules` も同時に公開してください。フレンド申請時にはAPIが対象UIDを検索専用名簿へ再照会します。

再更新も同じコマンドです。Dockerイメージ構築時にサーバーテストが走り、失敗したイメージは起動しません。

## Cloudflare Tunnel

公開API名は `photo-api.tayunet-traininfo.com` です。既存のCloudflare Tunnel設定へ次を追加します。

```yaml
ingress:
  - hostname: photo-api.tayunet-traininfo.com
    service: http://127.0.0.1:8790
  # 既存の他ホストをこの下へ残す
```

反映後の確認:

```bash
curl --fail https://photo-api.tayunet-traininfo.com/health
```

アップロード上限はAPI側100MB/枚です。Nginxを間に置く場合は `nginx-photo-archive.conf.example` のように `client_max_body_size` と長めのタイムアウトを設定します。

## バックアップ

稼働中でもSQLiteのオンラインバックアップを作れます。写真原本と一緒に別ディスクへ同期してください。

```bash
sudo docker exec tayunet-photo-archive python3 -c "import sqlite3; s=sqlite3.connect('/data/archive.sqlite3'); d=sqlite3.connect('/data/archive-backup.sqlite3'); s.backup(d); d.close(); s.close()"
sudo rsync -a --delete /mnt/hdd/tayunet-photo-archive/ /path/to/backup/photo-archive/
```

画面の「バックアップ／出力」から、本人分のメタデータJSON・CSV、原本ZIPも取得できます。

## 主な環境変数

- `PHOTO_ARCHIVE_FIREBASE_PROJECT`: Firebase project ID（既定 `tokyo-pass`）
- `PHOTO_ARCHIVE_ALLOWED_ORIGINS`: 許可する画面のオリジン（カンマ区切り）
- `PHOTO_ARCHIVE_TRASH_DAYS`: ゴミ箱の保管日数（既定30日）
- `PHOTO_ARCHIVE_MAX_UPLOAD_MB`: 1枚あたりの最大容量（既定100MB）

## セキュリティ

- 原本・サムネイルは直接公開せず、毎回Firebase IDトークンと写真の閲覧権限を確認します。
- 公開リンクは推測困難なランダム値で、DBにはそのハッシュだけを保存します。
- 共有パスワードはscryptでソルト付きハッシュ化し、平文保存しません。
- 「自分のみ」「特定ユーザー／グループ」「限定リンク」「全体公開」を写真単位で指定できます。
- `admin@tayunet-traininfo.com` と `systemadmin@tayunet-traininfo.com` は管理専用として扱い、写真・アルバムの登録APIを403で拒否します。
- 管理専用アカウントは全写真の閲覧、撮影情報の修正、削除・復元、共有リンク作成、バックアップ出力ができます。
