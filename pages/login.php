<?php
include '../includes/functions.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'];
    $password = $_POST['password'];

    if (login($username, $password)) {
        header("Location: dashboard.php");
        exit;
    } else {
        $error = "ユーザー名またはパスワードが正しくありません。";
    }
}
?>

<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>ログイン</title>
    <link rel="stylesheet" href="../assets/css/style.css">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/css/site-brand.css">
<script src="/assets/js/site-brand.js" defer></script>
</head>
<body>
    <h2>ログイン</h2>
    <form action="login.php" method="POST">
        <label for="username">ユーザー名:</label>
        <input type="text" name="username" id="username" required><br><br>
        <label for="password">パスワード:</label>
        <input type="password" name="password" id="password" required><br><br>
        <input type="submit" value="ログイン">
    </form>
    <?php if (isset($error)) echo "<p>$error</p>"; ?>
</body>
</html>
