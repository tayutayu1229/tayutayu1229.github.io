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
        
        console.log("DEBUG: Firebase SDK 初期化成功 (register.js)");

        const registerForm = document.getElementById('register-form');
        const messageDisplay = document.getElementById('message');
        const loadingIndicator = document.getElementById('loading');
        const registerButton = document.getElementById('register-button');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password'); 
        const confirmPasswordInput = document.getElementById('confirm-password'); 
        const inputs = registerForm.querySelectorAll('input');

        // メッセージの表示
        function showMessage(message, isSuccess = false) {
            messageDisplay.textContent = message;
            messageDisplay.style.display = 'block';
            messageDisplay.classList.toggle('success', isSuccess);
            setTimeout(() => {
                messageDisplay.style.display = 'none';
                messageDisplay.classList.remove('success');
            }, isSuccess ? 10000 : 5000); 
        }

        // フォームのバリデーション (変更なし)
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

        // 新規登録処理（メール確認をスキップ）
        async function registerUser(email, password) {
            registerButton.disabled = true;
            loadingIndicator.style.display = 'block';
            console.log(`DEBUG: ユーザー登録試行 - Email: ${email}`);

            try {
                // 1. Firebase Authentication にユーザーを作成
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;
                console.log(`DEBUG: Auth登録成功 - UID: ${user.uid}`);

                // 🚨 【削除】メール確認リンク送信処理を削除
                // await user.sendEmailVerification(); 
                // console.log("DEBUG: メール確認リンク送信成功 (スキップ)");
                
                // 2. Firestoreに承認待ちレコードを登録
                const docRef = db.collection("users").doc(user.uid);
                await docRef.set({
                    email: email,
                    approved: false, // 承認フラグを false に設定
                    isAdmin: false,
                    registeredAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log("DEBUG: Firestoreに承認待ちレコード作成成功");

                // 3. ユーザーをログアウトさせ、承認待ちを通知
                await auth.signOut();
                
                showMessage(
                    'アカウントの申請が完了しました。\n' +
                    '🚨 **管理者による承認が完了するまでログインできません**。承認をお待ちください。', 
                    true
                );
                
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 8000); 

            } catch (error) {
                let displayMessage = '登録に失敗しました。';
                
                console.error('ERROR: Firebase 登録エラー', error.code, error.message);

                if (error.code === 'auth/email-already-in-use') {
                    displayMessage = 'このメールアドレスは既に使用されています。';
                } else if (error.code === 'auth/invalid-email') {
                    displayMessage = 'メールアドレスの形式が正しくありません。';
                } else if (error.code === 'auth/weak-password') {
                    displayMessage = 'パスワードが弱すぎます（6文字以上）。';
                }

                showMessage(displayMessage);
                
            } finally {
                registerButton.disabled = false;
                loadingIndicator.style.display = 'none';
                console.log("DEBUG: 登録処理終了");
            }
        }

        // イベントリスナーの設定
        registerForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            if (!validateForm()) {
                return;
            }

            registerUser(emailInput.value.trim(), passwordInput.value);
        });

        // 入力フィールドのバリデーション/エラークリア
        inputs.forEach(input => {
            input.addEventListener('input', function() {
                this.classList.remove('error');
                messageDisplay.style.display = 'none';
                messageDisplay.classList.remove('success');
            });
        });
    } catch (e) {
        console.error("FATAL ERROR: Firebase SDK 初期化失敗 (register.js)", e);
        document.getElementById('message').textContent = 'システムエラー: 初期化に失敗しました。管理者にご連絡ください。';
        document.getElementById('message').style.display = 'block';
    }
});
