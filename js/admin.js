// ===============================
// admin.js（新デザイン対応）
// ===============================

// DOM 取得
const yearSelect = document.getElementById("yearSelect");
const expenseTable = document.getElementById("expenseTable");
const userTable = document.getElementById("userTable");

const totalIncomeEl = document.getElementById("totalIncome");
const totalExpenseEl = document.getElementById("totalExpense");
const balanceEl = document.getElementById("balance");

let currentYear = new Date().getFullYear();
let expenses = [];
let users = [];

// ===============================
// 年度セレクト初期化
// ===============================
function initYearSelect() {
  const base = new Date().getFullYear();
  for (let y = base - 2; y <= base + 3; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === currentYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }
}

// ===============================
// Firestore / Supabase からデータ取得
// （あなたの firebase.js / supabase.js の関数を呼ぶ）
// ===============================

// 支出データ取得
async function loadExpenses() {
  if (window.getExpensesByYear) {
    expenses = await window.getExpensesByYear(currentYear);
  } else {
    expenses = [];
  }
}

// 支払い状況データ取得
async function loadUsers() {
  if (window.getUsersByYear) {
    users = await window.getUsersByYear(currentYear);
  } else {
    users = [];
  }
}

// ===============================
// 支出テーブル描画
// ===============================
function renderExpenseTable() {
  expenseTable.innerHTML = "";

  expenses.forEach((item, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="border p-3">
        <input type="text" value="${item.name}" class="w-full border p-2 rounded">
      </td>

      <td class="border p-3">
        <input type="number" value="${item.amount}" class="w-full border p-2 rounded">
      </td>

      <td class="border p-3 text-center">
        <button class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 save-expense">保存</button>
        <button class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 delete-expense">削除</button>
      </td>
    `;

    // 保存
    tr.querySelector(".save-expense").onclick = async () => {
      const name = tr.querySelector("input[type=text]").value;
      const amount = Number(tr.querySelector("input[type=number]").value);

      const updated = { ...item, name, amount, year: currentYear };

      if (window.saveExpense) {
        const saved = await window.saveExpense(updated);
        if (saved) {
          expenses[index] = saved;
          updateSummary();
        }
      }
    };

    // 削除
    tr.querySelector(".delete-expense").onclick = async () => {
      if (!confirm("削除しますか？")) return;

      if (window.deleteExpense) {
        await window.deleteExpense(item.id);
      }

      expenses.splice(index, 1);
      renderExpenseTable();
      updateSummary();
    };

    expenseTable.appendChild(tr);
  });
}

// ===============================
// 支払い状況テーブル描画
// ===============================
function renderUserTable() {
  userTable.innerHTML = "";

  users.forEach((user, index) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="border p-3">${user.email}</td>

      <td class="border p-3">
        <select class="border p-2 rounded w-full">
          <option value="paid" ${user.status === "paid" ? "selected" : ""}>支払い済み</option>
          <option value="unpaid" ${user.status === "unpaid" ? "selected" : ""}>未払い</option>
        </select>
      </td>

      <td class="border p-3">
        <input type="date" value="${user.paidDate || ""}" class="border p-2 rounded w-full">
      </td>

      <td class="border p-3 text-center">
        <button class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 save-user">保存</button>
      </td>

      <td class="border p-3 text-center">
        <button class="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 receipt-btn">
          発行
        </button>
      </td>
    `;

    // 保存
    tr.querySelector(".save-user").onclick = async () => {
      const status = tr.querySelector("select").value;
      const paidDate = tr.querySelector("input[type=date]").value;

      const updated = { ...user, status, paidDate, year: currentYear };

      if (window.saveUserPayment) {
        const saved = await window.saveUserPayment(updated);
        if (saved) {
          users[index] = saved;
          updateSummary();
        }
      }
    };

    // 領収書（あなたの既存関数に合わせて呼ぶ）
    tr.querySelector(".receipt-btn").onclick = () => {
      if (window.generateReceipt) {
        window.generateReceipt(user);
      }
    };

    userTable.appendChild(tr);
  });
}

// ===============================
// サマリー更新
// ===============================
function updateSummary() {
  const totalIncome = users.filter(u => u.status === "paid").length * 1; // 必要なら金額に変更
  const totalExpense = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const balance = totalIncome - totalExpense;

  totalIncomeEl.textContent = totalIncome.toLocaleString();
  totalExpenseEl.textContent = totalExpense.toLocaleString();
  balanceEl.textContent = balance.toLocaleString();
}

// ===============================
// 行追加
// ===============================
document.getElementById("addExpense").onclick = () => {
  expenses.push({
    id: null,
    name: "",
    amount: 0,
    year: currentYear
  });
  renderExpenseTable();
};

// ===============================
// 年度変更
// ===============================
yearSelect.onchange = async () => {
  currentYear = Number(yearSelect.value);
  await loadAll();
};

// ===============================
// 全データ読み込み
// ===============================
async function loadAll() {
  await loadExpenses();
  await loadUsers();

  renderExpenseTable();
  renderUserTable();
  updateSummary();
}

// ===============================
// 初期化
// ===============================
initYearSelect();
loadAll();
