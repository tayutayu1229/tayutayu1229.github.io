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
        const registrationDeviceId = (() => {
            const key = 'tayunetOps:deviceId';
            let id = localStorage.getItem(key);
            if (!id) {
                id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
                localStorage.setItem(key, id);
            }
            return id;
        })();
        const registrationEnvironment = (() => {
            const text = [navigator.userAgent, navigator.platform, navigator.language, `${screen.width}x${screen.height}`, Intl.DateTimeFormat().resolvedOptions().timeZone || ''].join('|');
            let hash = 2166136261;
            for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
            return {
                signature: (hash >>> 0).toString(36),
                userAgent: navigator.userAgent.slice(0, 500),
                platform: String(navigator.platform || '').slice(0, 80),
                language: String(navigator.language || '').slice(0, 30),
                screen: `${screen.width}x${screen.height}`,
                timezone: String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 80)
            };
        })();
        const registrationNetworkPromise = (async () => {
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

        function pendingProfile(email, network) {
            return {
                email,
                approved: false,
                disabled: false,
                isAdmin: false,
                status: "pending",
                registrationDeviceId,
                registrationEnvironmentSignature: registrationEnvironment.signature,
                registrationUserAgent: registrationEnvironment.userAgent,
                registrationPlatform: registrationEnvironment.platform,
                registrationLanguage: registrationEnvironment.language,
                registrationScreen: registrationEnvironment.screen,
                registrationTimezone: registrationEnvironment.timezone,
                registrationIpAddress: network.ipAddress || '',
                registrationCountryCode: network.countryCode || '',
                registeredAt: firebase.firestore.FieldValue.serverTimestamp()
            };
        }

        async function writePendingProfile(user, email) {
            const network = await registrationNetworkPromise;
            await db.collection("users").doc(user.uid).set(pendingProfile(email, network));
        }

        // 新規登録処理。Authだけ作成されてFirestore登録に失敗した場合は、
        // Authを取り消すか、同じ認証情報で次回の登録時に承認待ち情報を復旧する。
        async function registerUser(email, password) {
            registerButton.disabled = true;
            loadingIndicator.style.display = 'block';
            console.log(`DEBUG: ユーザー登録試行 - Email: ${email}`);

            let user = null;
            let createdNow = false;

            try {
                try {
                    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                    user = userCredential.user;
                    createdNow = true;
                    console.log(`DEBUG: Auth登録成功 - UID: ${user.uid}`);
                } catch (createError) {
                    if (createError.code !== 'auth/email-already-in-use') throw createError;

                    // 過去にAuthだけ作成された半端なアカウントを、本人の
                    // メールアドレスとパスワードで安全に復旧する。
                    try {
                        const existingCredential = await auth.signInWithEmailAndPassword(email, password);
                        user = existingCredential.user;
                    } catch (signInError) {
                        const accountExistsError = new Error('既存アカウントの認証情報と一致しません。');
                        accountExistsError.code = 'registration/account-exists';
                        throw accountExistsError;
                    }

                    const existingDoc = await db.collection("users").doc(user.uid).get();
                    if (existingDoc.exists) {
                        const profile = existingDoc.data();
                        await auth.signOut();
                        if (profile.disabled === true || profile.status === 'disabled') {
                            showMessage('このアカウントは利用停止中です。管理者へお問い合わせください。');
                        } else if (profile.approved === true && profile.status === 'active') {
                            showMessage('このアカウントは登録済みです。ログイン画面からログインしてください。', true);
                        } else {
                            showMessage('このメールアドレスの登録申請は承認待ちです。管理者の承認をお待ちください。', true);
                        }
                        return;
                    }
                    console.warn('WARN: Authだけ存在するアカウントを復旧します。');
                }

                try {
                    await writePendingProfile(user, email);
                } catch (profileError) {
                    if (createdNow && user) {
                        try {
                            await user.delete();
                            const rolledBackError = new Error('利用者情報を保存できなかったためAuth登録を取り消しました。');
                            rolledBackError.code = 'registration/rolled-back';
                            throw rolledBackError;
                        } catch (cleanupError) {
                            if (cleanupError.code === 'registration/rolled-back') throw cleanupError;
                            console.error('ERROR: Auth登録の取り消しにも失敗しました。', cleanupError);
                            const partialError = new Error('登録が途中で停止しました。');
                            partialError.code = 'registration/partial-account';
                            throw partialError;
                        }
                    }
                    const recoveryError = new Error(profileError.message || '承認待ち情報を保存できませんでした。');
                    recoveryError.code = 'registration/recovery-failed';
                    throw recoveryError;
                }

                console.log("DEBUG: Firestoreに承認待ちレコード作成成功");
                await auth.signOut();

                showMessage(
                    'アカウントの申請が完了しました。確認メールの操作はありません。管理者による利用承認が完了するまでお待ちください。',
                    true
                );

                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 8000);

            } catch (error) {
                let displayMessage = '登録に失敗しました。通信状態を確認して、もう一度お試しください。';

                console.error('ERROR: Firebase 登録エラー', error.code, error.message);
                if (auth.currentUser) {
                    try { await auth.signOut(); } catch (signOutError) {
                        console.warn('WARN: 登録エラー後のログアウトに失敗しました。', signOutError);
                    }
                }

                if (error.code === 'registration/account-exists') {
                    displayMessage = 'このメールアドレスは登録済みです。ログインするか、パスワード再設定をお試しください。';
                } else if (error.code === 'registration/rolled-back') {
                    displayMessage = '利用者情報を保存できなかったため、アカウント作成を取り消しました。通信状態を確認して再度登録してください。';
                } else if (error.code === 'registration/partial-account') {
                    displayMessage = '登録が途中で停止しました。同じメールアドレスとパスワードでもう一度登録すると復旧を試みます。解決しない場合は管理者へ連絡してください。';
                } else if (error.code === 'registration/recovery-failed') {
                    displayMessage = '承認待ち情報を復旧できませんでした。通信状態を確認し、同じ内容でもう一度登録してください。';
                } else if (error.code === 'auth/invalid-email') {
                    displayMessage = 'メールアドレスの形式が正しくありません。';
                } else if (error.code === 'auth/weak-password') {
                    displayMessage = 'パスワードが弱すぎます（6文字以上）。';
                } else if (error.code === 'auth/network-request-failed') {
                    displayMessage = '認証サーバーへ接続できません。通信状態を確認して再度お試しください。';
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
