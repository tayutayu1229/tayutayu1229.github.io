document.addEventListener('DOMContentLoaded', function() {
    // --------------------------------------------------------------------------
    // 🚨 【重要】ご自身の Firebase 設定に置き換えてください
    // --------------------------------------------------------------------------
    const firebaseConfig = {
        apiKey: "YOUR_API_KEY", 
        authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT_ID.appspot.com",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID"
    };

    try {
        // Firebaseがまだ初期化されていない場合は初期化
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        
        const auth = firebase.auth(); 
        const db = firebase.firestore(); 

        // 認証状態の変化を監視し、アクセスを制限する
        auth.onAuthStateChanged(async (user) => { 
            if (user) {
                // 認証済みの処理: Firestoreで承認状態をチェック
                const userDoc = await db.collection("users").doc(user.uid).get();
                
                if (!userDoc.exists || !userDoc.data().approved) {
                    // Firestoreデータがない、または承認されていない場合
                    console.warn("GUARD: ユーザーは未承認またはデータ不完全。アクセス拒否。");
                    await auth.signOut();
                    alert("アクセス権限がありません。管理者による承認を確認してください。");
                    window.location.href = 'index.html';
                    return;
                }
                
                // 承認済み: 何もせずページコンテンツを表示 (処理終了)
                console.log("GUARD: 認証・承認済み。アクセス許可。");

                // 【追加】もし「ちらつき防止」のためのメインコンテンツ非表示を行っている場合は、ここで表示を解除
                const mainContent = document.getElementById('main-content');
                if (mainContent) {
                    mainContent.style.display = 'block';
                }

            } else {
                // 未認証の処理: ログインページへリダイレクト
                console.log("GUARD: 未認証ユーザー。ログインページへリダイレクト。");
                window.location.href = 'index.html';
            }
        });

    } catch (e) {
        console.error("FATAL ERROR: Firebase SDK 初期化失敗 (認証ガード)", e);
        alert('システムエラー: 認証システムの初期化に失敗しました。');
        // エラー発生時は安全のためログインページへ強制リダイレクト
        window.location.href = 'index.html'; 
    }
});
