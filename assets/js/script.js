// この旧ログインは、ブラウザに認証情報を置いていたため廃止しました。
// 認証は Firebase Authentication のログイン画面に統一します。
document.getElementById('login-form')?.addEventListener('submit', function(e) {
    e.preventDefault();
    const error = document.getElementById('error-message');
    if (error) {
        error.textContent = 'このログイン方式は廃止されました。ログイン画面からやり直してください。';
        error.style.display = 'block';
    }
});
