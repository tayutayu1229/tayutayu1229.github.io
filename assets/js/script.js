document.getElementById('login-form').addEventListener('submit', function(e) {
    e.preventDefault();

    // ユーザー入力の取得
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // サンプルのユーザーデータ（実際にはサーバーから取得することが一般的）
    const users = [
        { username: 'trombone1727', password: 'hvPNh8qZ' },
        { username: 'Yoshihito', password: 'yoshi1229' },
        { username: 'Ayakawa', password: 'tXdQb8bfjBa6'}
    ];

    // ログイン情報を検証
    const user = users.find(user => user.username === username && user.password === password);

    if (user) {
        // ログイン成功
        alert('ログインに成功しました！');
        window.location.href = './TOKYO-ATAMI.html'; // メインページへ遷移
    } else {
        // ログイン失敗
        document.getElementById('error-message').style.display = 'block';
    }
});
