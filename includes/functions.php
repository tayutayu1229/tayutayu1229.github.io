<?php
session_start();

function load_users() {
    // JSONファイルからユーザーデータを読み込む
    $json_data = file_get_contents(__DIR__ . '/users.json');
    return json_decode($json_data, true);
}

function login($username, $password) {
    // ユーザーデータを取得
    $users = load_users();
    foreach ($users['users'] as $user) {
        // ユーザー名とパスワードが一致するか確認
        if ($user['username'] === $username && password_verify($password, $user['password'])) {
            $_SESSION['loggedin'] = true;
            $_SESSION['username'] = $username;
            return true;
        }
    }
    return false;
}

function is_logged_in() {
    // ログイン状態を確認
    return isset($_SESSION['loggedin']) && $_SESSION['loggedin'] === true;
}
?>
