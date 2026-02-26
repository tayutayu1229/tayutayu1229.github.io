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
