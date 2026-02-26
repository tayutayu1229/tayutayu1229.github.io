// ===============================
// auth.js（管理者チェック）
// ===============================

import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const auth = getAuth();
const db = getFirestore();

// ===============================
// 管理者チェック
// ===============================
async function checkAdmin(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return false;

  const data = snap.data();
  return data.isAdmin === true;
}

// ===============================
// ログイン状態監視
// ===============================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // 未ログイン → ログイン画面へ
    showLoginUI();
    return;
  }

  const isAdmin = await checkAdmin(user.uid);

  if (!isAdmin) {
    document.body.innerHTML = `
      <div class="p-10 text-center text-red-600 text-xl">
        管理者権限がありません。
      </div>
    `;
    return;
  }

  // 管理者 → ダッシュボード表示
  document.getElementById("dashboard").classList.remove("hidden");
});

// ===============================
// ログアウト
// ===============================
export async function logout() {
  await signOut(auth);
}

window.logout = logout;

// ===============================
// ログイン UI 表示
// ===============================
function showLoginUI() {
  document.body.innerHTML = `
    <div class="flex items-center justify-center min-h-screen bg-gray-100">
      <div class="bg-white p-8 rounded shadow text-center">
        <h2 class="text-2xl font-bold mb-4">管理者ページ</h2>
        <p class="text-gray-600 mb-4">管理者権限でログインしてください。</p>
      </div>
    </div>
  `;
}
