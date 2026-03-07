document.addEventListener("DOMContentLoaded", function () {

    /* ============================
       Firebase 初期化aa
    ============================ */
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

    /* ============================
       HTML 要素
    ============================ */
    const userInfo = document.getElementById("user-info");

    const pendingUsersList = document.getElementById("pending-users-list");
    const existingUsersList = document.getElementById("existing-users-list");
    const disabledUsersList = document.getElementById("disabled-users-list");

    const pendingBadge = document.getElementById("pending-badge");

    const logoutButton = document.getElementById("logout-button");
    const contentArea = document.querySelector(".content");

    /* ============================
       認証状態チェック
    ============================ */
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }

        CURRENT_USER_UID = user.uid;

        try {
            const userDoc = await db.collection("users").doc(user.uid).get();

            if (!userDoc.exists) {
                alert("ユーザーデータが存在しません。");
                await auth.signOut();
                return;
            }

            const data = userDoc.data();

            if (data.status !== "active") {
                alert("アクセス権限がありません。管理者の承認をお待ちください。");
                await auth.signOut();
                return;
            }

            userInfo.textContent = `${user.email} でログイン中`;

            if (data.isAdmin === true) {
                loadAllUsers();
            } else {
                document.getElementById("pending").style.display = "none";
                document.getElementById("users").style.display = "none";
                document.getElementById("disabled-users").style.display = "none";
            }

            contentArea.style.display = "block";

        } catch (e) {
            console.error("Auth check error:", e);
            await auth.signOut();
        }
    });

    /* ============================
       全ユーザー読み込み
    ============================ */
    async function loadAllUsers() {
        try {
            const snapshot = await db.collection("users").orderBy("registeredAt", "desc").get();

            let pendingHTML = `
                <table>
                    <thead>
                        <tr><th>メール</th><th>登録日</th><th>操作</th></tr>
                    </thead>
                    <tbody>
            `;

            let existingHTML = `
                <table>
                    <thead>
                        <tr><th>メール</th><th>状態</th><th>権限</th><th>操作</th></tr>
                    </thead>
                    <tbody>
            `;

            let disabledHTML = `
                <table>
                    <thead>
                        <tr><th>メール</th><th>状態</th><th>操作</th></tr>
                    </thead>
                    <tbody>
            `;

            let pendingCount = 0;

            snapshot.forEach(doc => {
                const u = doc.data();
                const uid = doc.id;

                /* ============================
                   承認待ち
                ============================ */
                if (u.status === "pending") {
                    pendingCount++;

                    pendingHTML += `
                        <tr>
                            <td>${u.email}</td>
                            <td>${u.registeredAt?.toDate().toLocaleString("ja-JP")}</td>
                            <td>
                                <button class="btn-approve" onclick="approveUser('${uid}')">承認</button>
                                <button class="btn-disable" onclick="disableUser('${uid}')">無効化</button>
                            </td>
                        </tr>
                    `;
                    return;
                }

                /* ============================
                   無効化ユーザー
                ============================ */
                if (u.status === "disabled") {
                    disabledHTML += `
                        <tr>
                            <td>${u.email}</td>
                            <td><span class="status-badge status-disabled">停止中</span></td>
                            <td>
                                <button class="btn-enable" onclick="enableUser('${uid}')">再有効化</button>
                                <button class="btn-delete" onclick="deleteUser('${uid}')">削除</button>
                            </td>
                        </tr>
                    `;
                    return;
                }

                /* ============================
                   アクティブユーザー
                ============================ */
                const statusBadge = `<span class="status-badge status-active">利用可能</span>`;
                const roleBadge = u.isAdmin ? `<span class="status-badge status-admin">管理者</span>` : "一般";

                let buttons = "";

                if (uid !== CURRENT_USER_UID) {
                    buttons += `<button class="btn-disable" onclick="disableUser('${uid}')">無効化</button>`;

                    if (u.isAdmin) {
                        buttons += `<button class="btn-revoke" onclick="revokeAdmin('${uid}')">権限剥奪</button>`;
                    } else {
                        buttons += `<button class="btn-admin" onclick="promoteAdmin('${uid}')">管理者付与</button>`;
                    }
                } else {
                    buttons = "自分自身";
                }

                existingHTML += `
                    <tr>
                        <td>${u.email}</td>
                        <td>${statusBadge}</td>
                        <td>${roleBadge}</td>
                        <td>${buttons}</td>
                    </tr>
                `;
            });

            pendingHTML += "</tbody></table>";
            existingHTML += "</tbody></table>";
            disabledHTML += "</tbody></table>";

            pendingUsersList.innerHTML = pendingHTML;
            existingUsersList.innerHTML = existingHTML;
            disabledUsersList.innerHTML = disabledHTML;

            /* ============================
               通知バッジ更新
            ============================ */
            if (pendingCount > 0) {
                pendingBadge.style.display = "inline-block";
                pendingBadge.textContent = pendingCount;
            } else {
                pendingBadge.style.display = "none";
            }

        } catch (e) {
            console.error("Load users error:", e);
        }
    }

    /* ============================
       管理者操作
    ============================ */
    window.approveUser = async function (uid) {
        await db.collection("users").doc(uid).update({ status: "active" });
        loadAllUsers();
    };

    window.disableUser = async function (uid) {
        await db.collection("users").doc(uid).update({ status: "disabled" });
        loadAllUsers();
    };

    window.enableUser = async function (uid) {
        await db.collection("users").doc(uid).update({ status: "active" });
        loadAllUsers();
    };

    window.deleteUser = async function (uid) {
        if (!confirm("このユーザーを完全に削除しますか？")) return;
        await db.collection("users").doc(uid).delete();
        loadAllUsers();
    };

    window.promoteAdmin = async function (uid) {
        await db.collection("users").doc(uid).update({ isAdmin: true });
        loadAllUsers();
    };

    window.revokeAdmin = async function (uid) {
        await db.collection("users").doc(uid).update({ isAdmin: false });
        loadAllUsers();
    };

    /* ============================
       ログアウト（二重確認）
    ============================ */
    logoutButton.addEventListener("click", async () => {
        if (!confirm("ログアウトしますか？")) return;
        if (!confirm("本当にログアウトしますか？")) return;
        await auth.signOut();
    });

});
