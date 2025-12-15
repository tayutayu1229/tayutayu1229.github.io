document.addEventListener('DOMContentLoaded', function() {
    // --------------------------------------------------------------------------
    // 🚨 【重要】ご自身の Firebase 設定に置き換えてください
    // --------------------------------------------------------------------------
    const firebaseConfig = {
        apiKey: "AIzaSyAjMS_UwsMRm3XkXBqRnt4mgugR1LhWz4I",
  authDomain: "tokyo-pass.firebaseapp.com",
  projectId: "tokyo-pass",
  storageBucket: "tokyo-pass.firebasestorage.app",
  messagingSenderId: "950120670058",
  appId: "1:950120670058:web:3cd13fca317d87baeb7b13",
  measurementId: "G-DSQQ31EZE9"
    };

    // Firebase の初期化
    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth(); 

    const loginForm = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const loadingIndicator = document.getElementById('loading');
    const loginButton = document.getElementById('login-button');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password'); 
    const inputs = loginForm.querySelectorAll('input[type="text"], input[type="password"]');
    const resetPasswordLink = document.getElementById('reset-password-link');

    // エラーメッセージの表示
    function showError(message, isSuccess = false) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        errorMessage.classList.toggle('success', isSuccess);
        setTimeout(() => {
            errorMessage.style.display = 'none';
            errorMessage.classList.remove('success');
        }, 5000); 
    }

    // ログイン処理（Firebase APIを使用）
    async function login(email, password) {
        loginButton.disabled = true;
        loadingIndicator.style.display = 'block';

        try {
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            if (!user.emailVerified) {
                // メール未確認の場合、ログインをブロックし、確認を促す
                await auth.signOut();
                showError('ログインできません。メールアドレスの確認が完了していません。受信トレイをご確認ください。');
                return;
            }
            
            // ログイン成功: トップページへリダイレクト
            window.location.href = 'toppage.html';

        } catch (error) {
            let displayMessage = 'ログインに失敗しました。メールアドレスまたはパスワードを確認してください。';
            
            if (error.code === 'auth/invalid-email' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                displayMessage = 'メールアドレスまたはパスワードが正しくありません。';
            } else if (error.code === 'auth/user-disabled') {
                displayMessage = 'このアカウントは無効化されています。管理者にお問い合わせください。';
            }

            console.error('Firebase 認証エラー:', error.code, error.message);
            showError(displayMessage);
            passwordInput.value = '';

        } finally {
            loginButton.disabled = false;
            loadingIndicator.style.display = 'none';
        }
    }

    // パスワード再設定メール送信処理
    async function resetPassword() {
        const email = emailInput.value.trim();
        
        if (!email) {
            showError('パスワードをリセットするには、まずメールアドレスを入力してください。');
            return;
        }

        if (!confirm(`「${email}」宛にパスワード再設定メールを送信しますか？`)) {
            return;
        }

        loadingIndicator.style.display = 'block';
        
        try {
            await auth.sendPasswordResetEmail(email);
            showError(`パスワード再設定用のメールを ${email} に送信しました。確認してください。`, true);
        } catch (error) {
            let displayMessage = 'パスワード再設定メールの送信に失敗しました。';
            
            if (error.code === 'auth/user-not-found') {
                displayMessage = 'そのメールアドレスのアカウントは見つかりませんでした。';
            }
            
            console.error('Firebase リセットエラー:', error.code, error.message);
            showError(displayMessage);
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    // イベントリスナーの設定
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (!emailInput.value.trim() || !passwordInput.value) {
            showError('すべての項目を入力してください。');
            return;
        }

        login(emailInput.value.trim(), passwordInput.value);
    });

    // パスワード再設定リンクのイベント
    resetPasswordLink.addEventListener('click', function(e) {
        e.preventDefault();
        resetPassword();
    });
    
    // 入力フィールドのエラークリア
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            this.classList.remove('error');
            errorMessage.style.display = 'none';
            errorMessage.classList.remove('success');
        });
    });
});
