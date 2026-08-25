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
    const SECURITY_STORAGE_PREFIX = 'tayunetOps:';
    const currentDeviceId = () => {
        const key = `${SECURITY_STORAGE_PREFIX}deviceId`;
        let id = localStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
            localStorage.setItem(key, id);
        }
        return id;
    };
    const environmentSignature = () => {
        const text = [navigator.userAgent, navigator.platform, navigator.language, `${screen.width}x${screen.height}`, Intl.DateTimeFormat().resolvedOptions().timeZone || ''].join('|');
        let hash = 2166136261;
        for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(36);
    };
    const shortHash = value => {
        let hash = 2166136261;
        for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
        return (hash >>> 0).toString(36);
    };
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

    async function isTrustedDevice(db, uid, deviceId) {
        const snapshot = await db.collection('security_trusted_devices').doc(`${uid}_${shortHash(deviceId)}`).get();
        return snapshot.exists && snapshot.data().uid === uid && snapshot.data().deviceId === deviceId;
    }

    async function recordBlockedDevice(db, user, deviceId) {
        const ref = db.collection('security_device_requests').doc(`${user.uid}_${shortHash(deviceId)}`);
        const base = {
            uid: user.uid,
            email: user.email || '',
            deviceId,
            environmentSignature: environmentSignature(),
            userAgent: String(navigator.userAgent || '').slice(0, 500),
            platform: String(navigator.platform || '').slice(0, 80),
            screen: `${screen.width}x${screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
            path: String(location.pathname || '').slice(0, 300),
            status: 'blocked',
            lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            const snapshot = await ref.get();
            if (snapshot.exists) {
                await ref.update({
                    email: base.email,
                    environmentSignature: base.environmentSignature,
                    userAgent: base.userAgent,
                    platform: base.platform,
                    screen: base.screen,
                    timezone: base.timezone,
                    path: base.path,
                    lastSeenAt: base.lastSeenAt,
                    attemptCount: firebase.firestore.FieldValue.increment(1)
                });
            } else {
                await ref.set({ ...base, firstSeenAt: firebase.firestore.FieldValue.serverTimestamp(), attemptCount: 1 });
            }
        } catch (error) {
            console.warn('未確認端末の記録を保存できませんでした。', error);
        }
    }

    function showProtectedDeviceScreen(auth, user) {
        document.documentElement.style.background = '#f4f6f5';
        document.body.innerHTML = `
            <main role="main" style="min-height:100vh;display:grid;place-items:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif;color:#18352d">
                <section style="max-width:560px;background:#fff;border:1px solid #b9c9c2;border-top:6px solid #087f5b;border-radius:12px;padding:28px;box-shadow:0 10px 35px rgba(0,0,0,.11)">
                    <div style="font-size:2rem" aria-hidden="true">🛡️</div>
                    <h1 style="font-size:1.35rem;margin:10px 0">この端末からの利用を自動保護しました</h1>
                    <p style="line-height:1.75;margin:0 0 12px">普段と異なる端末からのアクセスを検出したため、アカウントの操作を止めています。普段使っている登録時端末、または確認済み端末から利用してください。</p>
                    <p style="line-height:1.65;color:#52635d;font-size:.9rem">パスワード変更や2段階認証の入力は不要です。この画面が出た端末ではデータの閲覧・変更・削除は行われません。</p>
                    <button id="tayunetProtectedLogout" type="button" style="margin-top:10px;border:0;border-radius:7px;background:#087f5b;color:#fff;padding:12px 18px;font-weight:700;cursor:pointer">ログアウトして戻る</button>
                    <p style="font-size:.78rem;color:#687872;margin:16px 0 0">利用者: ${String(user.email || '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]))}</p>
                </section>
            </main>`;
        document.getElementById('tayunetProtectedLogout').addEventListener('click', async () => {
            await auth.signOut();
            location.replace('/index.html?reason=protected_device');
        });
    }

    async function enforceAutomaticProtection({ auth, db, user, profile }) {
        if (profile.isAdmin === true || profile.securityProtection !== 'automatic') return true;
        const deviceId = currentDeviceId();
        const registrationMatch = profile.registrationDeviceId && profile.registrationDeviceId === deviceId;
        let trusted = false;
        if (!registrationMatch) trusted = await isTrustedDevice(db, user.uid, deviceId);
        if (registrationMatch || trusted) return true;
        await recordBlockedDevice(db, user, deviceId);
        showProtectedDeviceScreen(auth, user);
        return false;
    }

    function startTelemetry(context) {
        const launch = () => global.TayunetTelemetry && global.TayunetTelemetry.start(context).catch(error => {
            console.warn('運用計測を開始できませんでした。', error);
        });
        if (global.TayunetTelemetry) { launch(); return; }
        if (document.querySelector('script[data-tayunet-telemetry]')) return;
        const script = document.createElement('script');
        script.src = '/assets/js/system-telemetry.js?v=2026.08.25.4';
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

                if (!await enforceAutomaticProtection({ auth, db, user, profile })) {
                    resolveReady({ ok: false, reason: 'protected_device', user, profile });
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
