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
        auth.languageCode = 'ja';

        console.log("DEBUG: Firebase SDK 初期化成功 (login.js)");

        const loginForm = document.getElementById('login-form');
        const errorMessage = document.getElementById('error-message');
        const loadingIndicator = document.getElementById('loading');
        const loginButton = document.getElementById('login-button');
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password'); 
        const inputs = loginForm.querySelectorAll('input[type="email"], input[type="password"]');
        const resetPasswordLink = document.getElementById('reset-password-link');
        const showPassword = document.getElementById('show-password');
        let resetInProgress = false;
        const deviceId = (() => {
            const key = 'tayunetOps:deviceId';
            let id = localStorage.getItem(key);
            if (!id) {
                id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
                localStorage.setItem(key, id);
            }
            return id;
        })();
        const environmentSignature = (() => {
            const text = [navigator.userAgent, navigator.platform, navigator.language, `${screen.width}x${screen.height}`, Intl.DateTimeFormat().resolvedOptions().timeZone || ''].join('|');
            let hash = 2166136261;
            for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
            return (hash >>> 0).toString(36);
        })();
        const networkContextPromise = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3500);
            try {
                const response = await fetch('https://1.1.1.1/cdn-cgi/trace', { cache: 'no-store', signal: controller.signal });
                if (!response.ok) return {};
                const values = Object.fromEntries((await response.text()).trim().split('\n').map(line => line.split('=')));
                return { ipAddress: String(values.ip || '').slice(0, 64), countryCode: String(values.loc || '').slice(0, 8), networkEdge: String(values.colo || '').slice(0, 12) };
            } catch (_) {
                return {};
            } finally {
                clearTimeout(timer);
            }
        })();

        function rememberLoginAttempt(status, email, detail) {
            const entry = {
                status,
                email: String(email || '').toLowerCase().slice(0, 254),
                detail: String(detail || '').slice(0, 300),
                at: new Date().toISOString(),
                userAgent: navigator.userAgent.slice(0, 400)
            };
            try {
                const history = JSON.parse(localStorage.getItem('tayunetOps:loginAttempts') || '[]');
                history.push(entry);
                localStorage.setItem('tayunetOps:loginAttempts', JSON.stringify(history.slice(-100)));
            } catch (_) {}
            return entry;
        }

        async function recordSuccessfulLogin(user) {
            const entry = rememberLoginAttempt('success', user.email, '認証・利用承認成功');
            try {
                const network = await networkContextPromise;
                await db.collection('login_events').add({
                    uid: user.uid,
                    email: user.email || '',
                    status: 'success',
                    detail: entry.detail,
                    userAgent: entry.userAgent,
                    deviceId,
                    environmentSignature,
                    platform: String(navigator.platform || '').slice(0, 80),
                    language: String(navigator.language || '').slice(0, 30),
                    screen: `${screen.width}x${screen.height}`,
                    timezone: String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 80),
                    ipAddress: network.ipAddress || '',
                    countryCode: network.countryCode || '',
                    networkEdge: network.networkEdge || '',
                    clientTime: entry.at,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.warn('ログイン履歴を記録できませんでした。', error);
            }
        }

        // エラーメッセージの表示 (成功メッセージも兼用)
        function showError(message, isSuccess = false, persistent = false) {
            errorMessage.textContent = message;
            errorMessage.style.display = 'block';
            errorMessage.classList.toggle('success', isSuccess);
            if (!persistent) {
                setTimeout(() => {
                    errorMessage.style.display = 'none';
                    errorMessage.classList.remove('success');
                }, isSuccess ? 10000 : 8000);
            }
        }

        function returnTarget() {
            const requested = new URLSearchParams(location.search).get('return');
            if (!requested) return '/toppage.html';
            try {
                const target = new URL(requested, location.origin);
                if (target.origin !== location.origin || /\/(?:index|register)\.html$/.test(target.pathname)) {
                    return '/toppage.html';
                }
                return `${target.pathname}${target.search}${target.hash}`;
            } catch (_error) {
                return '/toppage.html';
            }
        }

        const reasonMessages = {
            login_required: 'この機能を使うにはログインが必要です。ログイン後、自動で元の画面に戻ります。',
            approval_required: 'メールアドレスとパスワードは確認できましたが、管理者の利用承認がまだ完了していません。管理者へ承認を依頼してください。',
            disabled: 'このアカウントは利用停止中です。管理者へお問い合わせください。',
            session_revoked: '管理者によりこの端末のセッションが終了されました。もう一度ログインしてください。',
            auth_error: '認証サーバーへの接続を確認できませんでした。通信状態を確認して、もう一度ログインしてください。'
        };
        const reason = new URLSearchParams(location.search).get('reason');
        if (reasonMessages[reason]) showError(reasonMessages[reason], false, true);

        // ログイン処理
        async function login(email, password) {
            loginButton.disabled = true;
            loadingIndicator.style.display = 'block';
            console.log(`DEBUG: ログイン試行 - Email: ${email}`);

            try {
                await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
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
                if (profile.disabled === true || profile.status === 'disabled') {
                    console.warn("DEBUG: ユーザーは利用停止中。ログアウト処理中...");
                    await auth.signOut();
                    showError('このアカウントは利用停止中です。管理者へお問い合わせください。');
                    return;
                }
                if (profile.approved !== true || profile.status !== 'active') {
                    console.warn("DEBUG: ユーザーは承認待ち。ログアウト処理中...");
                    await auth.signOut();
                    showError('登録申請は承認待ちです。管理者による利用承認が完了するまでお待ちください。');
                    return;
                }

                // 管理画面で利用者ごとの最終ログインを確認できるよう記録する。
                // serverTimestamp は Firestore ルール側でも検証し、本人が任意時刻を設定できないようにする。
                try {
                    await userDoc.ref.update({
                        lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                } catch (loginRecordError) {
                    console.warn('WARN: 最終ログイン日時を記録できませんでした。', loginRecordError);
                }
                await recordSuccessfulLogin(user);
                
                console.log("DEBUG: 認証・承認ステップ全てクリア。リダイレクトします。");
                // 認証・承認成功: トップページへリダイレクト
                window.location.href = returnTarget();

            } catch (error) {
                let displayMessage = 'ログインに失敗しました。メールアドレスまたはパスワードを確認してください。';
                
                console.error('ERROR: Firebase 認証エラー', error.code, error.message);
                rememberLoginAttempt('failure', email, `${error.code || 'auth/error'}: ${error.message || ''}`);
                // Authenticationだけ成功して利用者情報の確認に失敗した場合も、
                // 中途半端なログイン状態をブラウザへ残さない。
                if (auth.currentUser) {
                    try {
                        await auth.signOut();
                    } catch (signOutError) {
                        console.warn('WARN: エラー後のログアウトに失敗しました。', signOutError);
                    }
                }
                
                if (error.code === 'auth/invalid-email' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                    displayMessage = 'メールアドレスまたはパスワードが正しくありません。';
                } else if (error.code === 'auth/user-disabled') {
                    displayMessage = 'このアカウントは無効化されています。管理者にお問い合わせください。';
                } else if (error.code === 'auth/too-many-requests') {
                    displayMessage = '連続で試行しすぎました。しばらく時間をおいてから再度お試しください。';
                } else if (error.code === 'auth/network-request-failed') {
                    displayMessage = '認証サーバーへ接続できません。通信状態を確認して再度お試しください。';
                }

                showError(displayMessage);
                passwordInput.value = '';

            } finally {
                loginButton.disabled = false;
                loadingIndicator.style.display = 'none';
                console.log("DEBUG: ログイン処理終了");
            }
        }

        // パスワード再設定メール送信処理
        async function resetPassword() {
            if (resetInProgress) return;

            const email = emailInput.value.trim();
            console.log(`DEBUG: パスワードリセット試行 - Email: ${email}`);

            if (!email) {
                showError('パスワードをリセットするには、まずメールアドレスを入力してください。');
                return;
            }

            if (!emailInput.checkValidity()) {
                showError('メールアドレスの形式を確認してください。');
                emailInput.focus();
                return;
            }

            if (!confirm(`「${email}」宛にパスワード再設定メールを送信しますか？`)) {
                return;
            }

            resetInProgress = true;
            loadingIndicator.textContent = '再設定メールを申請中';
            loadingIndicator.style.display = 'block';
            resetPasswordLink.setAttribute('aria-disabled', 'true');
            resetPasswordLink.style.pointerEvents = 'none';
            
            try {
                await auth.sendPasswordResetEmail(email);
                console.log("DEBUG: パスワードリセット申請受付");
                showError(
                    `再設定の申請を受け付けました。${email} が登録メールと一致する場合にメールが届きます。5分待っても届かない場合は、迷惑メールを確認し、登録時と同じアドレスか管理者へ確認してください。`,
                    true,
                    true
                );
            } catch (error) {
                let displayMessage = 'パスワード再設定メールの送信に失敗しました。';
                
                console.error('ERROR: Firebase リセットエラー', error.code, error.message);

                if (error.code === 'auth/user-not-found') {
                    displayMessage = 'そのメールアドレスのアカウントは見つかりませんでした。';
                } else if (error.code === 'auth/invalid-email') {
                    displayMessage = 'メールアドレスの形式を確認してください。';
                } else if (error.code === 'auth/too-many-requests') {
                    displayMessage = '再設定を連続で試行しすぎました。しばらく時間をおいてからお試しください。';
                } else if (error.code === 'auth/network-request-failed') {
                    displayMessage = '認証サーバーへ接続できません。通信状態を確認して再度お試しください。';
                }
                
                showError(displayMessage);
            } finally {
                resetInProgress = false;
                loadingIndicator.style.display = 'none';
                loadingIndicator.textContent = 'ログイン中';
                resetPasswordLink.removeAttribute('aria-disabled');
                resetPasswordLink.style.pointerEvents = '';
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
        if (showPassword) {
            showPassword.addEventListener('change', () => {
                passwordInput.type = showPassword.checked ? 'text' : 'password';
            });
        }
        
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
