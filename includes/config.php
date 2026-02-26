<?php
// データベースの設定
define('DB_SERVER', 'localhost');
define('DB_USERNAME', 'root');
define('DB_PASSWORD', '');
define('DB_NAME', 'your_database');

// データベース接続
$conn = mysqli_connect(DB_SERVER, DB_USERNAME, DB_PASSWORD, DB_NAME);

// 接続チェック
if ($conn === false) {
    die("エラー: データベースに接続できません。" . mysqli_connect_error());
}
?>
