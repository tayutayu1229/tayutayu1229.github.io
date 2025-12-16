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
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        const auth = firebase.auth(); 
        const db = firebase.firestore();

        const mainContent = document.getElementById('main-content');
        const userInfo = document.getElementById('user-info');
        const logoutButton = document.getElementById('firebase-logout-button');
        const changeEmailButton = document.getElementById('change-email-button');
        const changePasswordButton = document.getElementById('change-password-button');
        const adminPanel = document.getElementById('admin-panel'); 
        const pendingUsersList = document.getElementById('pending-users-list');
        
        // 認証状態の監視とページアクセスガード
        auth.onAuthStateChanged(async (user) => { 
            if (user) {
                try {
                    const userDocRef = db.collection("users").doc(user.uid);
                    const userDoc = await userDocRef.get();
                    
                    // 1. 承認チェック
                    if (!userDoc.exists || !userDoc.data().approved) {
                        console.warn("GUARD: ユーザーは未承認またはデータ不完全。アクセス拒否。");
                        await auth.signOut();
                        alert("アクセス権限がありません。管理者による承認を確認してください。");
                        window.location.href = 'index.html';
                        return;
                    }
                    
                    // 2. 認証・承認OK: コンテンツを表示
                    const userData = userDoc.data();
                    mainContent.style.display = 'block';
                    userInfo.textContent = `(${user.email})でログイン中`;

                    // 3. 管理者権限チェックとパネル表示
                    if (userData.isAdmin) {
                        console.log("DEBUG: 管理者権限あり。管理者パネルを表示します。");
                        adminPanel.style.display = 'block';
                        loadPendingUsers(); 
                    } else {
                        adminPanel.style.display = 'none';
                    }

                } catch (error) {
                    console.error('ERROR: Firestore/承認チェックでエラー', error);
                    alert("システムエラーが発生しました。管理者にご連絡ください。");
                    await auth.signOut();
                    window.location.href = 'index.html';
                }

            } else {
                // 未認証
                console.log("DEBUG: 未認証。ログインページへリダイレクト。");
                window.location.href = 'index.html';
            }
        });

        // ------------------------------------------------------------------
        // 管理者機能の実装
        // ------------------------------------------------------------------

        function loadPendingUsers() {
            console.log("DEBUG: 承認待ちユーザーリストをロード中...");
            db.collection("users")
              .where("approved", "==", false)
              .get()
              .then((snapshot) => {
                if (snapshot.empty) {
                    pendingUsersList.innerHTML = "承認待ちユーザーはいません。";
                    return;
                }

                let html = '<table>';
                html += '<thead><tr><th>メールアドレス</th><th>申請日時</th><th>操作</th></tr></thead>';
                html += '<tbody>';
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const userId = doc.id;
                    const registrationTime = data.registeredAt ? 
                        data.registeredAt.toDate().toLocaleString('ja-JP') : 'N/A';
                    
                    html += `
                        <tr>
                            <td>${data.email}</td>
                            <td>${registrationTime}</td>
                            <td>
                                <button onclick="window.approveUser('${userId}')">承認</button>
                            </td>
                        </tr>
                    `;
                });
                
                html += '</tbody></table>';
                pendingUsersList.innerHTML = html;
            })
            .catch(error => {
                console.error("ERROR: 承認待ちユーザーの取得エラー: ", error);
                pendingUsersList.innerHTML = "ユーザーリストのロード中にエラーが発生しました。";
            });
        }
        
        window.approveUser = async function(uid) {
            console.log(`DEBUG: ユーザー承認処理開始 - UID: ${uid}`);
            if (confirm(`ユーザー ${uid} を承認し、アクセスを許可しますか？`)) {
                try {
                    await db.collection("users").doc(uid).update({ approved: true });
                    alert(`ユーザー ${uid} を承認しました。次回ログイン時からアクセス可能になります。`);
                    loadPendingUsers(); // リストを再ロード
                } catch (error) {
                    console.error("ERROR: ユーザー承認エラー: ", error);
                    alert("ユーザー承認中にエラーが発生しました。セキュリティルールの問題かもしれません。");
                }
            }
        };


        // ------------------------------------------------------------------
        // 一般ユーザー向けアカウント管理機能
        // ------------------------------------------------------------------

        changeEmailButton.addEventListener('click', async () => {
            const user = auth.currentUser;
            if (!user) { return; }

            const newEmail = prompt(`現在のメールアドレス: ${user.email}\n新しいメールアドレスを入力してください:`);
            
            if (newEmail && newEmail.trim() !== user.email) {
                alert("セキュリティのため、メールアドレス変更後は自動的にログアウトし、再ログインが必要です。");
                try {
                    await user.updateEmail(newEmail.trim());
                    await db.collection("users").doc(user.uid).update({ email: newEmail.trim() });
                    
                    alert(`メールアドレスを ${newEmail.trim()} に変更しました。再度ログインしてください。`);
                    await auth.signOut();
                } catch (error) {
                    let errMsg = "メールアドレスの変更に失敗しました。";
                    if (error.code === 'auth/requires-recent-login') {
                        errMsg += 'セキュリティ上の理由から、この操作には最近のログインが必要です。一度ログアウトし、すぐに再ログインしてからお試しください。';
                    } else if (error.code === 'auth/email-already-in-use') {
                        errMsg += 'そのメールアドレスは既に使用されています。';
                    }
                    alert(errMsg);
                }
            }
        });

        changePasswordButton.addEventListener('click', async () => {
            const user = auth.currentUser;
            if (!user) { return; }
            if (confirm("パスワード変更用のメールを送信しますか？\n(変更はメール内のリンクから行ってください)")) {
                try {
                    await auth.sendPasswordResetEmail(user.email);
                    alert(`パスワード変更用のメールを ${user.email} に送信しました。ご確認ください。`);
                } catch (error) {
                    alert("パスワード変更メールの送信に失敗しました。時間をおいてお試しください。");
                }
            }
        });

        async function firebaseLogout() {
            const confirmed = confirm("本当にログアウトしますか？");
            if (confirmed) {
                try {
                    await auth.signOut();
                } catch (error) {
                    alert('ログアウトに失敗しました。');
                }
            }
        }

        if (logoutButton) {
            logoutButton.addEventListener('click', firebaseLogout);
        }
    } catch (e) {
        console.error("FATAL ERROR: Firebase SDK 初期化失敗 (account_management.js)", e);
        // エラー発生時は安全のためリダイレクト
        window.location.href = 'index.html';
    }
});
