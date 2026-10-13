# PSP-01 第一段階 運用手順

## 認証方針

撮影地APIは、リクエストごとにFirebase IDトークンの署名・audience・issuerを検証し、Firestoreの利用者文書が承認済みかつ有効であることを確認する。Firestoreを確認できない場合は503で拒否する。無効なトークンは401、無効または未承認の利用者は403とする。

利用停止の反映を遅らせないため、第一段階ではFirestore利用者状態をアプリ内キャッシュしない。Firebase公開鍵のライブラリ内キャッシュだけを利用する。負荷が問題になった場合も、状態を許可するキャッシュを追加する前に別途承認を得る。

## install-photo-archive.sh が行うこと

1. 更新済みAPI、テスト、Dockerfile、起動スクリプトを `/opt/tayunet/photo-archive` へ配置する。
2. `/mnt/hdd/tayunet-photo-archive/shooting-spots/{originals,thumbnails}` をUID/GID 1000、モード0750で作成する。
3. systemdユニットを再読み込みし、自動起動を有効にする。既に稼働中の場合は `systemctl restart` を使わず、旧APIを動かしたまま安全入れ替え処理を呼ぶ。初回導入時だけsystemdから起動する。
4. Dockerイメージをビルドする。Dockerfile内の単体テストが失敗した場合は、稼働中の旧コンテナに触れず終了する。
5. ビルド成功後だけ旧コンテナを停止して一時名へ退避し、新コンテナを起動する。新コンテナの起動に失敗した場合は旧コンテナを元の名前へ戻して再起動する。
6. 新コンテナが起動できた場合だけ退避した旧コンテナを削除する。新コンテナは `restart unless-stopped` とsystemdからUbuntu再起動後も起動する。

本番では、下記バックアップとMacへのコピーが成功してから実行する。

## 反映順序

1. Ubuntu側のAPIだけを反映する。
2. `/health` と認証済みAPIを確認する。
3. 画面ファイルを更新する前に、現在本番で動いている旧PSP-01から新APIへ接続し、一覧が表示されることを確認する。
4. 旧画面互換が確認できた後だけ、`photo-spots.html`、CSS、JavaScriptを反映する。
5. Cloudflareの設定やキャッシュを変更する必要がある場合は、作業を止めて事前承認を得る。

## 反映後の確認

- `curl --fail http://127.0.0.1:8790/health` と公開側 `/health` が200で、版番号が `2026.10.13.3` であること。
- 撮影地が0件の状態でもAPIが `items: []` を返し、PSP-01では地図を残したまま一覧側だけに追加案内を表示すること。
- 認証済みのPC幅、390px、360pxで一覧・詳細・編集・履歴・ゴミ箱を確認すること。
- 一般職員に完全削除が表示されず、APIへ直接要求しても403になること。
- Ubuntuを再起動し、`tayunet-photo-archive.service` が自動起動して `/health` が200へ戻ること。
- Ubuntu監視画面で「撮影記録・撮影地・運転情報API」が正常となり、API版番号、撮影地件数、写真件数、保存容量が表示されること。
- 検査用ダミーデータとQA用ファイルが公開ディレクトリへ入っていないこと。

## 反映前バックアップ

バックアップ名は反映時に実日時を入れる。例として `20261013-psp01-stage1-before` を用いる。

Ubuntu上でSQLiteのオンラインバックアップ、写真、現行サーバーソース、Dockerイメージ名を同じ世代へ保存する。

```bash
sudo install -d -m 0700 /var/backups/tayunet/20261013-psp01-stage1-before
sudo docker exec tayunet-photo-archive python3 -c "import sqlite3; s=sqlite3.connect('/data/archive.sqlite3'); d=sqlite3.connect('/data/archive-stage1-before.sqlite3'); s.backup(d); d.close(); s.close()"
sudo cp /mnt/hdd/tayunet-photo-archive/archive-stage1-before.sqlite3 /var/backups/tayunet/20261013-psp01-stage1-before/archive.sqlite3
sudo rsync -a /mnt/hdd/tayunet-photo-archive/originals/ /var/backups/tayunet/20261013-psp01-stage1-before/originals/
sudo rsync -a /mnt/hdd/tayunet-photo-archive/thumbnails/ /var/backups/tayunet/20261013-psp01-stage1-before/thumbnails/
sudo rsync -a /mnt/hdd/tayunet-photo-archive/shooting-spots/ /var/backups/tayunet/20261013-psp01-stage1-before/shooting-spots/
sudo rsync -a /opt/tayunet/photo-archive/ /var/backups/tayunet/20261013-psp01-stage1-before/server-source/
sudo docker inspect tayunet-photo-archive --format '{{.Config.Image}}' | sudo tee /var/backups/tayunet/20261013-psp01-stage1-before/image-id.txt
sudo find /var/backups/tayunet/20261013-psp01-stage1-before -type f -exec sha256sum {} + | sudo tee /var/backups/tayunet/20261013-psp01-stage1-before/SHA256SUMS
```

Mac側にもコピーする。

```bash
mkdir -p "/Users/yoshi/Documents/東京圏輸送情報システム/本番バックアップ/20261013-psp01-stage1-before"
scp -r ubuntu-user@ubuntu-host:/var/backups/tayunet/20261013-psp01-stage1-before/. "/Users/yoshi/Documents/東京圏輸送情報システム/本番バックアップ/20261013-psp01-stage1-before/"
```

実行時には `ubuntu-user` と `ubuntu-host` を接続先に置き換え、Mac側でファイル数とSHA-256を照合する。

## 利用開始後のロールバック

利用開始後は、反映前バックアップを直ちに上書きしない。最初に現在の利用データを別の世代へ退避する。

1. APIを停止して新しい書き込みを止める。
2. 現在のSQLite、撮影地原本、サムネイル、サーバーソースを `rollback-latest` 世代へ書き出す。
3. `rollback-latest` をMacへコピーする。
4. 反映前バックアップの画像ディレクトリを先に復元する。
5. 反映前のSQLiteを最後に復元する。
6. 反映前のサーバーソースとDockerイメージへ戻す。
7. APIを起動し、`/health`、件数、画像取得、旧画面の一覧を確認する。
8. 画面側が反映済みなら対象コミットをrevertしてから再公開する。

API停止中の具体例:

```bash
sudo systemctl stop tayunet-photo-archive.service
sudo install -d -m 0700 /var/backups/tayunet/rollback-latest
sudo cp /mnt/hdd/tayunet-photo-archive/archive.sqlite3 /var/backups/tayunet/rollback-latest/archive.sqlite3
sudo rsync -a /mnt/hdd/tayunet-photo-archive/originals/ /var/backups/tayunet/rollback-latest/originals/
sudo rsync -a /mnt/hdd/tayunet-photo-archive/thumbnails/ /var/backups/tayunet/rollback-latest/thumbnails/
sudo rsync -a /mnt/hdd/tayunet-photo-archive/shooting-spots/ /var/backups/tayunet/rollback-latest/shooting-spots/
sudo rsync -a /opt/tayunet/photo-archive/ /var/backups/tayunet/rollback-latest/server-source/
sudo find /var/backups/tayunet/rollback-latest -type f -exec sha256sum {} + | sudo tee /var/backups/tayunet/rollback-latest/SHA256SUMS
# Mac側の別ターミナルで実行し、SHA-256を照合する
# mkdir -p "/Users/yoshi/Documents/東京圏輸送情報システム/本番バックアップ/rollback-latest"
# scp -r ubuntu-user@ubuntu-host:/var/backups/tayunet/rollback-latest/. "/Users/yoshi/Documents/東京圏輸送情報システム/本番バックアップ/rollback-latest/"
sudo rsync -a --delete /var/backups/tayunet/20261013-psp01-stage1-before/originals/ /mnt/hdd/tayunet-photo-archive/originals/
sudo rsync -a --delete /var/backups/tayunet/20261013-psp01-stage1-before/thumbnails/ /mnt/hdd/tayunet-photo-archive/thumbnails/
sudo rsync -a --delete /var/backups/tayunet/20261013-psp01-stage1-before/shooting-spots/ /mnt/hdd/tayunet-photo-archive/shooting-spots/
sudo cp /var/backups/tayunet/20261013-psp01-stage1-before/archive.sqlite3 /mnt/hdd/tayunet-photo-archive/archive.sqlite3
sudo rsync -a --delete /var/backups/tayunet/20261013-psp01-stage1-before/server-source/ /opt/tayunet/photo-archive/
sudo chown -R 1000:1000 /mnt/hdd/tayunet-photo-archive
sudo systemctl start tayunet-photo-archive.service
curl --fail http://127.0.0.1:8790/health
```

写真分離後に旧APIだけへ戻すと、旧APIは分離済み写真を表示できない。完全ロールバックではDB、撮影地画像、サーバーソースを必ず同じバックアップ世代へ戻す。
