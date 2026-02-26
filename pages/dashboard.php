<?php
include 'includes/functions.php';

// ログインしていない場合はログインページへリダイレクト
if (!is_logged_in()) {
    header("Location: index.php");
    exit;
}
?>

<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>ダッシュボード</title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <h2>ようこそ、<?php echo $_SESSION['username']; ?>さん</h2>
    <p>これはログイン後のダッシュボードページです。</p>
</body>
</html>
