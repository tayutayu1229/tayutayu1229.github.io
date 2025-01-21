document.getElementById('login-form').addEventListener('submit', function(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const users = [
        { username: 'trombone1727', password: 'hvPNh8qZ' },
        { username: 'Yoshihito', password: 'yoshi1229' },
        { username: 'Ayakawa', password: 'tXdQb8bfjBa6' },
        { username: 'demo', password: 'oiahuwrgui' },
    ];
    const user = users.find(user => user.username === username && user.password === password);

    if (user) {
        // ログイン成功
        alert('ログインに成功しました！');
        window.location.href = './toppage.html'; // メインページへ遷移
    } else {
        // ログイン失敗
        document.getElementById('error-message').style.display = 'block';
    }
});
