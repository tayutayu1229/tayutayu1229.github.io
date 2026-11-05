# Ubuntuバックアップ

`backup.sh local` はHDD、`backup.sh cloud` は暗号化restic/rcloneのGoogle Drive保存先を使う。共有ロックで並行保存を防ぎ、失敗も `backup-status.json` に記録する。認証キーの内容はログへ出さない。

## 履歴SQLite

稼働中のDB本体とWALを別々にコピーすると、ファイル転送が成功しても復元したDBに時点のずれが生じる。履歴は次の方法で保存する。

1. 既存の履歴コンテナと同じSQLite実行環境を使う。入力領域は完全に読み取り専用。DB本体やWAL/SHMの権限は変えない。
2. 読取トランザクションで時点を固定し、SQLite Online Backup APIで一時コピーを作る。別接続の同時更新を混ぜない。
3. 一時コピーをDELETEジャーナルの単独DBへ揃え、`PRAGMA quick_check` とSHA256を記録する。
4. その固定ファイルをresticのstdinへ渡す。保存上の名前は常に `/tayunet-history/history.sqlite3`。一時ディレクトリ名が変わっても保持グループを増やさない。
5. 保存後は一時コピーを削除する。保存・整理に失敗した場合も実行結果を失敗として記録し、古い保存世代を無理に整理しない。

既存mainソース配列は保ち、元の履歴DB本体・WAL・SHMのみを除外する。photo保存領域、PM2 dump、Cloudflare設定、監視コード、既存のBotデータ2種類は従来の対象を維持する。

一時コピー先は既定で `/home/yoshi/.cache`。`TAYUNET_HISTORY_SNAPSHOT_ROOT` で変更できる。作業後も12GiB以上の空きが残る場合に開始し、コピー中も残量を確認する。利用可能メモリ3GiB未満では開始しない。処理用コンテナはCPU1コア・メモリ2GiB上限、追加スワップなし・外部通信なし。作業領域の空き不足や30分の上限超過は失敗として通知する。履歴が増えたら、一時領域の拡張や保持方針の見直しが必要。

## 保持と容量

- local：7日・4週・6月。
- cloud：host/pathsの各対象ごと直近2世代。
- cloud開始前に未参照データを整理し、失敗アップロードの残骸を蓄積させない。
- この保存先のresticが不要と判断したオブジェクトはDriveのゴミ箱に残さない。通常の利用者ファイルは整理対象にしない。
- Drive容量は監視で10分キャッシュして照会。空き20%以下または2GiB以下で警告、5%以下または512MiB以下で重大扱い。照会不能を正常とは表示しない。

## 復元確認

転送成功・コピー作成時の内部検査・クラウドからの実復元は別々の確認。管理画面では保存先ごとの実行結果と、`backup-restore-validation.json` の最終復元確認を区別する。

履歴の復元例：

```sh
restic -r rclone:tayunet-drive:tayunet-server-backup snapshots --tag cloud --path /tayunet-history/history.sqlite3
restic -r rclone:tayunet-drive:tayunet-server-backup restore SNAPSHOT_ID --target ISOLATED_DIRECTORY --verify
```

既存のRESTIC_PASSWORD_FILE/RCLONE_CONFIGを使い、実データを上書きしない。復元したファイルのSHA256を該当実行の `runs.cloud.historySnapshot.sha256` と照合する。元コピーの内部検査合格と全バイト一致を確認してから復元合格を記録する。過去の不合格世代の証拠は残す。

## 範囲の限界

この処理だけで全サービス・全クラウドDBの復元を保証しない。活休/private領域の専用ユーザーDBは対象外。Supabase/Firestoreの定期エクスポートや、他のDBの個別復元確認も別に整える。復旧手順・暗号化キー・保存対象の一覧を保管し、原本と未確認データを保全する。
