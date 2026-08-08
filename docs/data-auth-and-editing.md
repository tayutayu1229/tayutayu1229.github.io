# 保護データの利用・承認・追加手順

## 利用者が最初に行うこと

1. `https://tayunet-traininfo.com/index.html` からメールアドレスとパスワードでログインする。
2. 未承認の場合は管理者へ承認を依頼する。
3. 管理者は `account_management.html` の「承認」を押す。
4. 時刻表・DocuBase・D-TACを開く。
5. 時刻表・DocuBase・D-TACでも同じログイン状態が自動で使われる。別の「データ用ログイン」は不要。

Firebaseでログインした利用者のIDトークンは、画面からUbuntuの保護APIへ自動送信されます。
パスワードをAPIへ送ることはありません。

## 現在の認証判定

次のすべてを満たす場合だけ保護データを利用できます。

- Firebase Authenticationでログイン済み
- Firestore `users/{uid}` の `approved` が `true`
- `status` が `active`
- `disabled` が `true` ではない

Cloudflareは保護APIへの経路として使用しますが、利用者がCloudflareへ別途ログインする必要はありません。

利用停止または承認解除は最大約1分で保護APIにも反映されます。

## 時刻表を追加する方法

### JSONを直接編集する場合

1. 非公開リポジトリ `tayutayu1229/tayunet-private-data` の `data/timetables-manifest.json` を確認し、対象の `data/timetables*.json` を開く。
2. 新しいブランチを作り、既存形式に合わせて列車を追加する。
3. Pull Requestを作る。
4. `Validate private timetable data` の成功を確認する。
5. 内容を確認して `main` へマージする。
6. Ubuntuへ通常5分以内に反映される。

### `timeedit.html`を使う場合

1. TAYUNETへ通常ログインし、管理者の利用承認が済んでいることを確認する。
2. `https://tayunet-traininfo.com/timeedit.html` を開く。
3. 列車を作成し「全件JSONを保存」を押す。
4. 保存された全件JSONから対象列車を、非公開リポジトリで一覧末尾の `data/timetables*.json` へ追加し、新しいブランチとして保存する。
5. Pull Request、検証、確認、マージを行う。

`timeedit.html` からUbuntuへ直接保存しないのは、誤操作時にGitHubの履歴から戻せるようにするためです。

## 共同編集者へ伝える注意

- 公開リポジトリへ `timetables*.json`、`timetables-manifest.json` や `station.json` を置かない。
- 分割ファイルを追加するときは、次の連番 `timetables-N.json` を作り、`data/timetables-manifest.json` の配列末尾へファイル名を追加する。
- 列車を別ファイルへ移した場合は移動元から削除し、Pull Requestの検証と移動前後の総件数を確認する。
- JSONを公開Issue、チャット、公開ストレージへ貼らない。
- `main` を直接編集せずPull Requestを使う。
- 検証失敗中の変更はマージしない。
- 問題が起きたら対象Pull Requestをrevertする。
