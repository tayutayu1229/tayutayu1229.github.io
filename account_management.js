document.addEventListener('DOMContentLoaded', function() {

    // Firebase 設定（あなたの設定そのまま）
    const firebaseConfig = {
        apiKey: "AIzaSyAjMS_UwsMRm3XkXBqRnt4mgugR1LhWz4I",
        authDomain: "tokyo-pass.firebaseapp.com",
        projectId: "tokyo-pass",
        storageBucket: "tokyo-pass.firebasestorage.app",
        messagingSenderId: "950120670058",
        appId: "1:950120670058:web:3cd13fca317d87baeb7b13",
        measurementId: "G-DSQQ31EZE9"
    };

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const db = firebase.firestore();

    let CURRENT_USER_UID = null;

    const mainContent = document.getElementById('main-content');
    const userInfo = document.getElementById('user-info');
    const logoutButton = document.getElementById('firebase-logout-button');
    const adminPanel = document.getElementById('admin-panel');
    const pendingUsersList = document.getElementById('pending-users-list');

    // ================================
    // 認証状態チェック
    // ================================
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }

        CURRENT_USER_UID = user.uid;

        const userDoc = await db.collection("users").doc(user.uid).get();
        if (!userDoc.exists) {
            alert("ユーザーデータが存在しません。");
            auth.signOut();
            return;
        }

        const data = userDoc.data();

        // status チェック
        if (data.status !== "active") {
            alert("アクセス権限がありません。管理者の承認をお待ちください。");
            auth.signOut();
            return;
        }

        mainContent.style.display = "block";
        userInfo.textContent = `${user.email} でログイン中`;

        // 管理者ならパネル表示
        if (data.role === "admin") {
            adminPanel.style.display = "block";
            loadAllUsers();
        }
    });

    // ================================
    // 管理者：ユーザー一覧ロード
    // ================================
    async function loadAllUsers() {
        const snapshot = await db.collection("users").orderBy("registeredAt", "desc").get();

        let html = `
            <h3>承認待ちユーザー</h3>
            <table>
                <thead>
                    <tr><th>メール</th><th>登録日</th><th>操作</th></tr>
                </thead>
                <tbody>
        `;

        snapshot.forEach(doc => {
            const u = doc.data();
            const uid = doc.id;

            if (u.status === "pending") {
                html += `
                    <tr>
                        <td>${u.email}</td>
                        <td>${u.registeredAt?.toDate().toLocaleString("ja-JP")}</td>
                        <td>
                            <button class="btn-approve" onclick="approveUser('${uid}')">承認</button>
                            <button class="btn-disable" onclick="rejectUser('${uid}')">削除</button>
                        </td>
                    </tr>
                `;
            }
        });

        html += `
                </tbody>
            </table>

            <h3 style="margin-top:2rem;">既存ユーザー</h3>
            <table>
                <thead>
                    <tr><th>メール</th><th>状態</th><th>権限</th><th>操作</th></tr>
                </thead>
                <tbody>
        `;

        snapshot.forEach(doc => {
            const u = doc.data();
            const uid = doc.id;

            if (u.status !== "pending") {
                const statusBadge =
                    u.status === "active"
                        ? `<span class="status-badge status-approved">利用可能</span>`
                        : `<span class="status-badge status-disabled">停止中</span>`;

                const roleBadge =
                    u.role === "admin"
                        ? `<span class="status-badge status-admin">管理者</span>`
                        : "一般";

                let buttons = "";

                if (uid !== CURRENT_USER_UID) {
                    if (u.status === "active") {
                        buttons += `<button class="btn-disable" onclick="disableUser('${uid}')">無効化</button>`;
                    } else {
                        buttons += `<button class="btn-enable" onclick="enableUser('${uid}')">再有効化</button>`;
                    }

                    if (u.role === "admin") {
                        buttons += `<button class="btn-revoke" onclick="revokeAdmin('${uid}')">権限剥奪</button>`;
                    } else {
                        buttons += `<button class="btn-admin" onclick="promoteAdmin('${uid}')">管理者付与</button>`;
                    }
                } else {
                    buttons = "自分自身";
                }

                html += `
                    <tr>
                        <td>${u.email}</td>
                        <td>${statusBadge}</td>
                        <td>${roleBadge}</td>
                        <td>${buttons}</td>
                    </tr>
                `;
            }
        });

        html += `</tbody></table>`;

        pendingUsersList.innerHTML = html;
    }

    // ================================
    // 管理者操作
    // ================================
    window.approveUser = async function(uid) {
        await db.collection("users").doc(uid).update({
            status: "active"
        });
        loadAllUsers();
    };

    window.rejectUser = async function(uid) {
        if (!confirm("このユーザーを完全に削除しますか？")) return;
        await db.collection("users").doc(uid).delete();
        loadAllUsers();
    };

    window.disableUser = async function(uid) {
        await db.collection("users").doc(uid).update({
            status: "disabled"
        });
        loadAllUsers();
    };

    window.enableUser = async function(uid) {
        await db.collection("users").doc(uid).update({
            status: "active"
        });
        loadAllUsers();
    };

    window.promoteAdmin = async function(uid) {
        await db.collection("users").doc(uid).update({
            role: "admin"
        });
        loadAllUsers();
    };

    window.revokeAdmin = async function(uid) {
        await db.collection("users").doc(uid).update({
            role: "user"
        });
        loadAllUsers();
    };

    // ================================
    // ログアウト
    // ================================
    logoutButton.addEventListener("click", async () => {
        await auth.signOut();
    });

});
