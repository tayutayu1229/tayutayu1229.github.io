import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAjMS_UwsMRm3XkXBqRnt4mgugR1LhWz4I",
  authDomain: "tokyo-pass.firebaseapp.com",
  projectId: "tokyo-pass",
  storageBucket: "tokyo-pass.firebasestorage.app",
  messagingSenderId: "950120670058",
  appId: "1:950120670058:web:3cd13fca317d87baeb7b13",
  measurementId: "G-DSQQ31EZE9"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ===============================
// 以下は前回の支出・支払い Firestore 関数
// ===============================

// 支出
export async function getExpensesByYear(year) {
  const q = query(collection(db, "expenses"), where("year", "==", year));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveExpense(item) {
  const id = item.id || crypto.randomUUID();
  await setDoc(doc(db, "expenses", id), item);
  return { ...item, id };
}

export async function deleteExpense(id) {
  await deleteDoc(doc(db, "expenses", id));
}

// 支払い状況
export async function getUsersByYear(year) {
  const usersSnap = await getDocs(collection(db, "users"));
  const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

  const paySnap = await getDocs(
    query(collection(db, "payments"), where("year", "==", year))
  );

  const payments = {};
  paySnap.forEach(d => {
    payments[d.data().uid] = d.data();
  });

  return users.map(u => ({
    uid: u.uid,
    email: u.email,
    status: payments[u.uid]?.status || "unpaid",
    paidDate: payments[u.uid]?.paidDate || "",
    amount: payments[u.uid]?.amount || 0,
    year
  }));
}

export async function saveUserPayment(user) {
  const id = `${user.year}_${user.uid}`;
  await setDoc(doc(db, "payments", id), user);
  return user;
}

export function generateReceipt(user) {
  alert(`領収書を発行します: ${user.email}`);
}

// ===============================
// window オブジェクトに関数を附属（モジュール対応）
// ===============================
window.getExpensesByYear = getExpensesByYear;
window.saveExpense = saveExpense;
window.deleteExpense = deleteExpense;
window.getUsersByYear = getUsersByYear;
window.saveUserPayment = saveUserPayment;
window.generateReceipt = generateReceipt;
