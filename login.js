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
    const usernameInput = document.getElementById('username'); // メールアドレスとして使用
    const passwordInput = document.getElementById('password'); 
    const inputs = loginForm.querySelectorAll('input[type="text"], input[type="password"]');

    // フォームのバリデーション (空欄チェック)
    function validateForm() {
        let isValid = true;
        inputs.forEach(input => {
            if (!input.value.trim()) {
                isValid = false;
                input.classList.add('error');
            } else {
                input.classList.remove('error');
            }
        });
        return isValid;
    }

    // エラーメッセージの表示
    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = 'block';
        setTimeout(() => {
            errorMessage.style.display = 'none';
        }, 5000); 
    }

    // ログイン処理（Firebase APIを使用）
    async function login(email, password) {
        loginButton.disabled = true;
        loadingIndicator.style.display = 'block';

        try {
            // Firebaseのメール/パスワード認証を実行
            await auth.signInWithEmailAndPassword(email, password);
            
            // ログイン成功: トップページへリダイレクト
            window.location.href = 'toppage.html';

        } catch (error) {
            // 認証失敗
            let displayMessage = '認証に失敗しました。メールアドレスまたはパスワードを確認してください。';
            
            // エラーコードに基づいたメッセージ調整（必要に応じて）
            if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                // 攻撃者にヒントを与えないため、一律のメッセージ
                displayMessage = 'ユーザーIDまたはパスワードが正しくありません。';
            } else if (error.code === 'auth/invalid-email') {
                displayMessage = 'メールアドレスの形式が正しくありません。';
            }

            console.error('Firebase 認証エラー:', error.code, error.message);
            showError(displayMessage);
            
            // パスワード入力フィールドをクリア
            passwordInput.value = '';

        } finally {
            loginButton.disabled = false;
            loadingIndicator.style.display = 'none';
        }
    }

    // イベントリスナーの設定
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (!validateForm()) {
            showError('すべての項目を入力してください。');
            return;
        }

        const email = usernameInput.value.trim();
        const password = passwordInput.value;
        
        login(email, password);
    });

    // 入力フィールドのバリデーション/エラークリア
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            this.classList.remove('error');
            errorMessage.style.display = 'none';
        });
    });
});
