(function (global) {
    'use strict';

    const firebaseConfig = {
        apiKey: "AIzaSyAjMS_UwsMRm3XkXBqRnt4mgugR1LhWz4I",
        authDomain: "tokyo-pass.firebaseapp.com",
        projectId: "tokyo-pass",
        storageBucket: "tokyo-pass.firebasestorage.app",
        messagingSenderId: "950120670058",
        appId: "1:950120670058:web:3cd13fca317d87baeb7b13",
        measurementId: "G-DSQQ31EZE9"
    };

    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const currentReturnPath = () => `${location.pathname}${location.search}${location.hash}`;
    const loginUrl = reason => `/index.html?return=${encodeURIComponent(currentReturnPath())}&reason=${encodeURIComponent(reason || 'login_required')}`;

    function goToLogin(reason) {
        location.replace(loginUrl(reason));
    }

    function showConnectionProblem(error) {
        console.error('ERROR: Firebaseの利用者情報を確認できませんでした。', error);
        const panel = document.createElement('div');
        panel.setAttribute('role', 'alert');
        panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#f4f6f5;display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif';
        panel.innerHTML = `
            <div style="max-width:520px;background:#fff;border:1px solid #ccd8d2;border-radius:12px;padding:24px;box-shadow:0 8px 28px rgba(0,0,0,.12);text-align:center">
                <h2 style="margin:0 0 12px;color:#075f49">認証サーバーへ接続できません</h2>
                <p style="line-height:1.7;color:#333">ログイン状態は維持されています。通信状態を確認して、もう一度お試しください。</p>
                <button type="button" id="tayunetAuthRetry" style="border:0;border-radius:7px;background:#087f5b;color:#fff;padding:11px 18px;font-weight:700;cursor:pointer">もう一度確認</button>
                <a href="${loginUrl('auth_error')}" style="display:inline-block;margin-left:10px;color:#075f49">ログイン画面へ</a>
            </div>`;
        document.body.appendChild(panel);
        panel.querySelector('#tayunetAuthRetry').addEventListener('click', () => location.reload());
    }

    async function getProfile(db, uid) {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await db.collection('users').doc(uid).get();
            } catch (error) {
                lastError = error;
                if (attempt < 2) await wait(500 * (attempt + 1));
            }
        }
        throw lastError;
    }

    function startTelemetry(context) {
        const launch = () => global.TayunetTelemetry && global.TayunetTelemetry.start(context).catch(error => {
            console.warn('運用計測を開始できませんでした。', error);
        });
        if (global.TayunetTelemetry) { launch(); return; }
        if (document.querySelector('script[data-tayunet-telemetry]')) return;
        const script = document.createElement('script');
        script.src = '/assets/js/system-telemetry.js?v=2026.08.25.1';
        script.defer = true;
        script.dataset.tayunetTelemetry = 'true';
        script.addEventListener('load', launch, { once: true });
        document.head.appendChild(script);
    }

    function ensureBrandAndVersion() {
        if (!document.querySelector('link[href*="site-brand.css"]')) {
            const style = document.createElement('link');
            style.rel = 'stylesheet';
            style.href = '/assets/css/site-brand.css?v=2026.08.02.1';
            document.head.appendChild(style);
        }
        if (!document.querySelector('script[src*="site-brand.js"]')) {
            const script = document.createElement('script');
            script.src = '/assets/js/site-brand.js?v=2026.08.02.1';
            script.defer = true;
            document.head.appendChild(script);
        }
    }

    let resolveReady;
    global.TayunetAuthReady = new Promise(resolve => { resolveReady = resolve; });

    try {
        if (!global.firebase || typeof global.firebase.initializeApp !== 'function') {
            throw new Error('Firebase SDKが読み込まれていません。');
        }
        if (!global.firebase.apps.length) global.firebase.initializeApp(firebaseConfig);

        const auth = global.firebase.auth();
        const db = global.firebase.firestore();
        global.TayunetAuth = Object.freeze({ auth, db, loginUrl });

        auth.setPersistence(global.firebase.auth.Auth.Persistence.LOCAL).catch(error => {
            console.warn('Firebaseログイン状態の保存設定に失敗しました。', error);
        });

        auth.onAuthStateChanged(async user => {
            if (!user) {
                resolveReady({ ok: false, reason: 'login_required' });
                goToLogin('login_required');
                return;
            }

            try {
                const userDoc = await getProfile(db, user.uid);
                if (!userDoc.exists) {
                    resolveReady({ ok: false, reason: 'approval_required' });
                    await auth.signOut();
                    goToLogin('approval_required');
                    return;
                }
                const profile = userDoc.data();
                if (profile.disabled === true || profile.status === 'disabled') {
                    resolveReady({ ok: false, reason: 'disabled' });
                    await auth.signOut();
                    goToLogin('disabled');
                    return;
                }
                if (profile.approved !== true || profile.status !== 'active') {
                    resolveReady({ ok: false, reason: 'approval_required' });
                    await auth.signOut();
                    goToLogin('approval_required');
                    return;
                }

                const mainContent = document.getElementById('main-content');
                const userInfo = document.getElementById('user-info');
                if (mainContent) mainContent.style.display = 'block';
                if (userInfo) userInfo.textContent = `(${user.email || '利用者'})でログイン中`;
                ensureBrandAndVersion();
                startTelemetry({ auth, db, user, profile });
                resolveReady({ ok: true, user, profile });
            } catch (error) {
                resolveReady({ ok: false, reason: 'auth_error', error });
                showConnectionProblem(error);
            }
        }, error => {
            resolveReady({ ok: false, reason: 'auth_error', error });
            showConnectionProblem(error);
        });

        const logoutButton = document.getElementById('firebase-logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', async () => {
                if (!confirm('本当にログアウトしますか？')) return;
                try {
                    await auth.signOut();
                } catch (error) {
                    console.error('ログアウトに失敗しました。', error);
                    alert('ログアウトに失敗しました。通信状態を確認してください。');
                }
            });
        }
    } catch (error) {
        resolveReady({ ok: false, reason: 'firebase_unavailable', error });
        showConnectionProblem(error);
    }
})(window);
