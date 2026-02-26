import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const dashboard = document.getElementById("dashboard");

// 管理者チェック
async function checkAdmin(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) return false;
  return snap.data().isAdmin === true;
}

// ログイン状態監視
onAuthStateChanged(auth, async (user) => {
  if (!user) {
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

  dashboard.classList.remove("hidden");
});

// Google ログイン
export async function login() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

// ログアウト
export async function logout() {
  await signOut(auth);
  location.reload();
}

// ログイン画面
function showLoginUI() {
  document.body.innerHTML = `
    <div class="flex items-center justify-center min-h-screen bg-gray-100">
      <div class="bg-white p-8 rounded shadow text-center">
        <h2 class="text-2xl font-bold mb-4">管理者ログイン</h2>
        <button id="loginBtn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Google でログイン
        </button>
      </div>
    </div>
  `;

  document.getElementById("loginBtn").onclick = login;
}
