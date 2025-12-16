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
        // Firebaseがまだ初期化されていない場合は初期化
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        
        const auth = firebase.auth(); 
        const db = firebase.firestore(); 
        // HTML側で設定したIDを取得
        const mainContent = document.getElementById('main-content');
        const userInfo = document.getElementById('user-info');
        const logoutButton = document.getElementById('firebase-logout-button');

        // 認証状態の変化を監視し、アクセスを制限する
        auth.onAuthStateChanged(async (user) => { 
            if (user) {
                // 認証済みの処理: Firestoreで承認状態と停止状態をチェック
                try {
                    const userDoc = await db.collection("users").doc(user.uid).get();
                
                    // 1. ユーザーデータ存在および承認チェック
                    if (!userDoc.exists || !userDoc.data().approved) {
                        console.warn("GUARD: ユーザーは未承認またはデータ不完全。アクセス拒否。");
                        await auth.signOut();
                        alert("アクセス権限がありません。管理者による承認を確認してください。");
                        window.location.href = 'index.html';
                        return;
                    }
                    
                    // 2. アクセス停止(disabled)フラグのチェック
                    if (userDoc.data().disabled) {
                        console.warn("GUARD: ユーザーは管理者によりアクセス停止されています。アクセス拒否。");
                        await auth.signOut();
                        alert("このアカウントは管理者によりアクセスが停止されています。");
                        window.location.href = 'index.html';
                        return;
                    }
                    
                    // 承認済みかつ有効: ページコンテンツを表示
                    console.log("GUARD: 認証・承認済み。アクセス許可。");
                    if (mainContent) {
                        mainContent.style.display = 'block'; // コンテンツを表示
                    }
                    if (userInfo) {
                        userInfo.textContent = `(${user.email})でログイン中`; // ユーザー情報を表示
                    }
                } catch (error) {
                    console.error("ERROR: Firestoreアクセスエラー (認証ガード)", error);
                    await auth.signOut();
                    alert("認証システムエラーが発生しました。");
                    window.location.href = 'index.html';
                }

            } else {
                // 未認証の処理: ログインページへリダイレクト
                console.log("GUARD: 未認証ユーザー。ログインページへリダイレクト。");
                window.location.href = 'index.html';
            }
        });
        
        // ログアウト処理の追加 (全ページ共通)
        if (logoutButton) {
            logoutButton.addEventListener('click', async () => {
                const confirmed = confirm("本当にログアウトしますか？");
                if (confirmed) {
                    try {
                        await auth.signOut();
                        // ログアウト後のリダイレクトは onAuthStateChanged が処理します
                    } catch (error) {
                        console.error('ERROR: ログアウト失敗:', error);
                        alert('ログアウトに失敗しました。');
                    }
                }
            });
        }


    } catch (e) {
        console.error("FATAL ERROR: Firebase SDK 初期化失敗 (認証ガード)", e);
        alert('システムエラー: 認証システムの初期化に失敗しました。');
        // 致命的なエラー時は安全のためログインページへ強制リダイレクト
        window.location.href = 'index.html'; 
    }
});
