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
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/assets/css/site-brand.css">
<script src="/assets/js/site-brand.js" defer></script>
</head>
<body>
    <h2>ようこそ、<?php echo $_SESSION['username']; ?>さん</h2>
    <p>これはログイン後のダッシュボードページです。</p>
</body>
</html>
