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

    try {
        const app = firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth(); 
        const db = firebase.firestore(); 

        console.log("DEBUG: Firebase SDK 初期化成功 (login.js)");

        const loginForm = document.getElementById('login-form');
        const errorMessage = document.getElementById('error-message');
        const loadingIndicator = document.getElementById('loading');
        const loginButton = document.getElementById('login-button');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password'); 
        const inputs = loginForm.querySelectorAll('input[type="text"], input[type="password"]');
        const resetPasswordLink = document.getElementById('reset-password-link');

        // エラーメッセージの表示 (成功メッセージも兼用)
        function showError(message, isSuccess = false) {
            errorMessage.textContent = message;
            errorMessage.style.display = 'block';
            errorMessage.classList.toggle('success', isSuccess);
            setTimeout(() => {
                errorMessage.style.display = 'none';
                errorMessage.classList.remove('success');
            }, isSuccess ? 8000 : 5000); 
        }

        // ログイン処理
        async function login(email, password) {
            loginButton.disabled = true;
            loadingIndicator.style.display = 'block';
            console.log(`DEBUG: ログイン試行 - Email: ${email}`);

            try {
                // 1. Firebase Authentication 認証
                const userCredential = await auth.signInWithEmailAndPassword(email, password);
                const user = userCredential.user;
                console.log(`DEBUG: 認証成功 - UID: ${user.uid}`);

                // 🚨 【変更点】メール確認チェックをスキップ

                // 2. Firestoreの承認フラグチェック
                const userDoc = await db.collection("users").doc(user.uid).get();
                
                if (!userDoc.exists) {
                    console.error("DEBUG: Firestoreにユーザーデータが見つかりません。");
                    await auth.signOut();
                    showError('アカウントデータが見つかりません。登録申請が完了しているか確認してください。');
                    return;
                }

                const profile = userDoc.data();
                if (profile.approved !== true || profile.status !== 'active' || profile.disabled === true) {
                    console.warn("DEBUG: ユーザーは未承認。ログアウト処理中...");
                    await auth.signOut();
                    showError('ログインできません。このアカウントは未承認または利用停止中です。');
                    return;
                }
                
                console.log("DEBUG: 認証・承認ステップ全てクリア。リダイレクトします。");
                // 認証・承認成功: トップページへリダイレクト
                window.location.href = 'toppage.html';

            } catch (error) {
                let displayMessage = 'ログインに失敗しました。メールアドレスまたはパスワードを確認してください。';
                
                console.error('ERROR: Firebase 認証エラー', error.code, error.message);
                
                if (error.code === 'auth/invalid-email' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
                    displayMessage = 'メールアドレスまたはパスワードが正しくありません。';
                } else if (error.code === 'auth/user-disabled') {
                    displayMessage = 'このアカウントは無効化されています。管理者にお問い合わせください。';
                } else if (error.code === 'auth/too-many-requests') {
                    displayMessage = '連続で試行しすぎました。しばらく時間をおいてから再度お試しください。';
                }

                showError(displayMessage);
                passwordInput.value = '';

            } finally {
                loginButton.disabled = false;
                loadingIndicator.style.display = 'none';
                console.log("DEBUG: ログイン処理終了");
            }
        }

        // パスワード再設定メール送信処理 (ロジックは変更なし)
        async function resetPassword() {
            const email = emailInput.value.trim();
            console.log(`DEBUG: パスワードリセット試行 - Email: ${email}`);

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
                console.log("DEBUG: パスワードリセットメール送信成功");
                showError(`パスワード再設定用のメールを ${email} に送信しました。確認してください。`, true);
            } catch (error) {
                let displayMessage = 'パスワード再設定メールの送信に失敗しました。';
                
                console.error('ERROR: Firebase リセットエラー', error.code, error.message);

                if (error.code === 'auth/user-not-found') {
                    displayMessage = 'そのメールアドレスのアカウントは見つかりませんでした。';
                }
                
                showError(displayMessage);
            } finally {
                loadingIndicator.style.display = 'none';
                console.log("DEBUG: パスワードリセット処理終了");
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
    } catch (e) {
        console.error("FATAL ERROR: Firebase SDK 初期化失敗 (login.js)", e);
        document.getElementById('error-message').textContent = 'システムエラー: 初期化に失敗しました。管理者にご連絡ください。';
        document.getElementById('error-message').style.display = 'block';
    }
});
