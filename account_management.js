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

    let CURRENT_USER_UID = null;

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
                CURRENT_USER_UID = user.uid; // 自分のUIDを保存
                try {
                    const userDocRef = db.collection("users").doc(user.uid);
                    const userDoc = await userDocRef.get();
                    
                    if (!userDoc.exists || !userDoc.data().approved) {
                        console.warn("GUARD: ユーザーは未承認またはデータ不完全。アクセス拒否。");
                        await auth.signOut();
                        alert("アクセス権限がありません。管理者による承認を確認してください。");
                        window.location.href = 'index.html';
                        return;
                    }
                    
                    const userData = userDoc.data();
                    mainContent.style.display = 'block';
                    userInfo.textContent = `(${user.email})でログイン中`;

                    // 管理者権限チェックとパネル表示
                    if (userData.isAdmin) {
                        console.log("DEBUG: 管理者権限あり。管理者パネルを表示します。");
                        adminPanel.style.display = 'block';
                        loadAllUsers(); // 全ユーザーリストをロードするように変更
                    } else {
                        // 管理者権限がない場合は管理パネルは表示しない
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
        // 管理者機能の実装 (全ユーザーリスト表示と各種操作)
        // ------------------------------------------------------------------

        // 全ユーザーリストをFirestoreから取得し、テーブル形式で表示
        function loadAllUsers() {
            console.log("DEBUG: 全ユーザーリストをロード中...");
            db.collection("users")
              .orderBy("registeredAt", "desc") // 登録順に表示
              .get()
              .then((snapshot) => {
                if (snapshot.empty) {
                    pendingUsersList.innerHTML = "システムに登録されているユーザーはいません。";
                    return;
                }

                let html = '<table>';
                html += '<thead><tr><th>メールアドレス</th><th>ステータス</th><th>権限</th><th>申請日時</th><th>操作</th></tr></thead>';
                html += '<tbody>';
                
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const userId = doc.id;
                    const registrationTime = data.registeredAt ? 
                        data.registeredAt.toDate().toLocaleString('ja-JP') : 'N/A';
                    
                    // ステータスバッジの決定
                    let statusHtml = '';
                    if (!data.approved) {
                        statusHtml = `<span class="status-badge status-pending">承認待ち</span>`;
                    } else if (data.disabled) {
                        statusHtml = `<span class="status-badge status-disabled">アクセス停止</span>`;
                    } else {
                        statusHtml = `<span class="status-badge status-approved">利用可能</span>`;
                    }

                    // 権限バッジの決定
                    const adminHtml = data.isAdmin 
                        ? `<span class="status-badge status-admin">管理者</span>` 
                        : '一般';
                    
                    // 操作ボタンの決定
                    let buttons = '';
                    
                    if (userId !== CURRENT_USER_UID) { // 自分自身には操作ボタンを表示しない
                        
                        // 1. 承認ボタン
                        if (!data.approved) {
                            buttons += `<button class="btn-approve" onclick="window.approveUser('${userId}')">承認</button>`;
                        }
                        
                        // 2. アクセス停止/再開ボタン
                        if (data.approved) { // 承認済みなら停止/再開可能
                            if (data.disabled) {
                                buttons += `<button class="btn-enable" onclick="window.toggleDisable('${userId}', false)">アクセス再開</button>`;
                            } else {
                                buttons += `<button class="btn-disable" onclick="window.toggleDisable('${userId}', true)">アクセス停止</button>`;
                            }
                        }

                        // 3. 管理者権限付与/剥奪ボタン
                        if (data.isAdmin) {
                            buttons += `<button class="btn-revoke" onclick="window.toggleAdmin('${userId}', false)">権限剥奪</button>`;
                        } else {
                            buttons += `<button class="btn-admin" onclick="window.toggleAdmin('${userId}', true)">管理者付与</button>`;
                        }

                        // 4. 強制ログアウトボタン (ログアウト機能はAuth SDKの機能ではないため、Firestoreでフラグを立ててガード側で強制ログアウトさせるロジックが必要)
                        // 今回はシンプルにパスワードリセットを推奨
                        // buttons += `<button class="btn-revoke" onclick="window.forceLogout('${userId}')">強制ログアウト</button>`; 
                    } else {
                        buttons = '自分自身';
                    }

                    html += `
                        <tr>
                            <td>${data.email}</td>
                            <td>${statusHtml}</td>
                            <td>${adminHtml}</td>
                            <td>${registrationTime}</td>
                            <td>${buttons}</td>
                        </tr>
                    `;
                });
                
                html += '</tbody></table>';
                pendingUsersList.innerHTML = html;
                console.log(`DEBUG: 全ユーザー ${snapshot.size} 件をロードしました。`);
            })
            .catch(error => {
                console.error("ERROR: ユーザーリストの取得エラー: ", error);
                pendingUsersList.innerHTML = "ユーザーリストのロード中にエラーが発生しました。";
            });
        }
        
        // ユーザーを承認する処理
        window.approveUser = async function(uid) {
            if (confirm(`ユーザー ${uid} を承認し、アクセスを許可しますか？`)) {
                try {
                    await db.collection("users").doc(uid).update({ approved: true, disabled: false }); // 承認時は停止を解除
                    alert(`ユーザー ${uid} を承認しました。`);
                    loadAllUsers(); 
                } catch (error) {
                    console.error("ERROR: ユーザー承認エラー: ", error);
                    alert("ユーザー承認中にエラーが発生しました。");
                }
            }
        };

        // ユーザーのアクセス停止/再開を切り替える処理
        window.toggleDisable = async function(uid, shouldDisable) {
            const action = shouldDisable ? 'アクセスを停止' : 'アクセスを再開';
            if (confirm(`ユーザー ${uid} の${action}しますか？\n(アクセス停止後はログインできなくなります)`)) {
                try {
                    await db.collection("users").doc(uid).update({ disabled: shouldDisable });
                    alert(`ユーザー ${uid} のアクセス状態を${action}しました。`);
                    loadAllUsers(); 
                } catch (error) {
                    console.error("ERROR: アクセス制御エラー: ", error);
                    alert(`アクセス状態の変更中にエラーが発生しました。`);
                }
            }
        };

        // ユーザーの管理者権限を切り替える処理
        window.toggleAdmin = async function(uid, shouldBeAdmin) {
            const action = shouldBeAdmin ? '管理者権限を付与' : '管理者権限を剥奪';
            if (confirm(`ユーザー ${uid} に${action}しますか？\n(剥奪後は管理者パネルが表示されなくなります)`)) {
                try {
                    await db.collection("users").doc(uid).update({ isAdmin: shouldBeAdmin });
                    alert(`ユーザー ${uid} に${action}しました。`);
                    loadAllUsers(); 
                } catch (error) {
                    console.error("ERROR: 管理者権限変更エラー: ", error);
                    alert(`管理者権限の変更中にエラーが発生しました。`);
                }
            }
        };

        // ------------------------------------------------------------------
        // 一般ユーザー向けアカウント管理機能 (変更なし)
        // ------------------------------------------------------------------
        
        // ... (changeEmailButton, changePasswordButton, firebaseLogout のロジックは前のバージョンから変更なし) ...

        changeEmailButton.addEventListener('click', async () => {
            // ... (ロジックは割愛: 前のバージョンのまま) ...
        });

        changePasswordButton.addEventListener('click', async () => {
            // ... (ロジックは割愛: 前のバージョンのまま) ...
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
        window.location.href = 'index.html';
    }
});
