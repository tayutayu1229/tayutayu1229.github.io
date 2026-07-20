<?php
session_start();

function load_users() {
    // JSONファイルからユーザーデータを読み込む
    $json_data = file_get_contents(__DIR__ . '/users.json');
    return json_decode($json_data, true);
}

function login($username, $password) {
    // 静的サイト上のJSON認証は廃止しました。
    // 本番認証は Firebase Authentication に統一します。
    return false;
}

function is_logged_in() {
    // ログイン状態を確認
    return isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true;
}
?>
