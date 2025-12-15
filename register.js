document.addEventListener('DOMContentLoaded', function() {
    // --------------------------------------------------------------------------
    // 🚨 【重要】ご自身の Firebase 設定に置き換えてください (login.js と同じ設定)
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

    const registerForm = document.getElementById('register-form');
    const messageDisplay = document.getElementById('message');
    const loadingIndicator = document.getElementById('loading');
    const registerButton = document.getElementById('register-button');
    const userIdInput = document.getElementById('username'); // IDをusernameに変更
    const passwordInput = document.getElementById('password'); 
    const confirmPasswordInput = document.getElementById('confirm-password'); 
    const inputs = registerForm.querySelectorAll('input');

    // ユーザーIDをFirebase認証用のメールアドレス形式に変換する関数
    function convertUserIdToEmail(userId) {
        return `${userId.trim()}@system.local`;
    }

    // メッセージの表示 (エラーと成功の両方に対応)
    function showMessage(message, isSuccess = false) {
        messageDisplay.textContent = message;
        messageDisplay.style.display = 'block';
        if (isSuccess) {
            messageDisplay.classList.add('success');
        } else {
            messageDisplay.classList.remove('success');
        }
        setTimeout(() => {
            messageDisplay.style.display = 'none';
        }, 8000); 
    }

    // フォームのバリデーション
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

        if (!isValid) {
             showMessage('すべての項目を入力してください。');
             return false;
        }

        if (passwordInput.value.length < 6) {
            passwordInput.classList.add('error');
            showMessage('パスワードは6文字以上で設定してください。');
            return false;
        }

        if (passwordInput.value !== confirmPasswordInput.value) {
            passwordInput.classList.add('error');
            confirmPasswordInput.classList.add('error');
            showMessage('パスワードと確認用パスワードが一致しません。');
            return false;
        }
        
        return true;
    }

    // 新規登録処理（Firebase APIを使用）
    async function registerUser(userId, password) {
        registerButton.disabled = true;
        loadingIndicator.style.display = 'block';

        // ユーザーIDをメールアドレス形式に変換
        const email = convertUserIdToEmail(userId);

        try {
            await auth.createUserWithEmailAndPassword(email, password);
            
            showMessage('アカウントの作成が完了しました。自動でログインページに移動します。', true);
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 3000); 

        } catch (error) {
            let displayMessage = '登録に失敗しました。';
            
            if (error.code === 'auth/email-already-in-use') {
                displayMessage = 'このユーザーIDは既に使用されています。';
            } else if (error.code === 'auth/invalid-email') {
                displayMessage = 'ユーザーIDの形式が不適切です。';
            } else if (error.code === 'auth/weak-password') {
                displayMessage = 'パスワードが弱すぎます（6文字以上）。';
            }

            console.error('Firebase 登録エラー:', error.code, error.message);
            showMessage(displayMessage);
            
        } finally {
            registerButton.disabled = false;
            loadingIndicator.style.display = 'none';
        }
    }

    // イベントリスナーの設定
    registerForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        const userId = userIdInput.value.trim();
        const password = passwordInput.value;
        
        registerUser(userId, password);
    });

    // 入力フィールドのバリデーション/エラークリア
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            this.classList.remove('error');
            messageDisplay.style.display = 'none';
        });
    });
});
