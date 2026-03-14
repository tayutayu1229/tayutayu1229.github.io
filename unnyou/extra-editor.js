import { supabase } from "./supabaseClient.js";

let dateInput;
let depotInput;
let dutyNumberInput;
let vehicleTypeInput;
let trainBody;
let addTrainBtn;
let saveBtn;
let newDutyBtn;
let deleteBtn;
let statusEl;
let notesInput;
let successorTextInput;
let extraDutySelect;
let successorDutySelect;

let currentDutyId = null;
let trainsState = [];


// ------------------------------
// 初期化
// ------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  dateInput = document.getElementById("date");
  depotInput = document.getElementById("depot");
  dutyNumberInput = document.getElementById("duty-number");
  vehicleTypeInput = document.getElementById("vehicle-type");
  trainBody = document.getElementById("train-body");
  addTrainBtn = document.getElementById("add-train");
  saveBtn = document.getElementById("save");
  newDutyBtn = document.getElementById("new-duty");
  deleteBtn = document.getElementById("delete-duty");
  statusEl = document.getElementById("status");
  notesInput = document.getElementById("notes");
  successorTextInput = document.getElementById("successor-text");
  extraDutySelect = document.getElementById("extra-duty-select");
  successorDutySelect = document.getElementById("successor-duty-select"); // ★ 追加

  // ★ コピー機能のボタン取得
  const copyBtn = document.getElementById("copy-duty");

  // ★ コピー機能のイベント登録
  copyBtn.addEventListener("click", copyExtraDuty);

  // ★ 初期表示で臨時運用と後継候補を全部読み込む
  await loadExtraDuties("");
  await loadSuccessorList();

  // ★ 施行日変更で臨時運用と後継候補を絞り込み
  dateInput.addEventListener("change", async () => {
    await loadExtraDuties(dateInput.value);
    await loadSuccessorList();
  });

  extraDutySelect.addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id) {
      currentDutyId = null;
      clearForm();
      return;
    }
    currentDutyId = id;
    await loadExtraDutyDetail(id);
  });

  addTrainBtn.addEventListener("click", addTrain);
  newDutyBtn.addEventListener("click", newDuty);
  saveBtn.addEventListener("click", saveDuty);
  deleteBtn.addEventListener("click", deleteDuty);

  clearForm();
});


// ------------------------------
// 臨時運用一覧（施行日で絞る）
// ------------------------------
async function loadExtraDuties(date) {
  let query = supabase.from("extra_duties").select("*");

  if (date) {
    query = query.eq("date", date);
  }

  const { data } = await query
    .order("date")
    .order("depot")
    .order("duty_number");

  const select = document.getElementById("extra-duty-select");
  select.innerHTML = `<option value="">（新規作成）</option>`;

  data.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.duty_number}（${d.depot}）`; // ← 勝手に「臨」を付けない
    select.appendChild(opt);
  });
}


// ------------------------------
// 臨時運用詳細
// ------------------------------
async function loadExtraDutyDetail(id) {
  const { data: duty } = await supabase
    .from("extra_duties")
    .select("*")
    .eq("id", id)
    .single();

  dateInput.value = duty.date;
  depotInput.value = duty.depot;
  dutyNumberInput.value = duty.duty_number;
  vehicleTypeInput.value = duty.vehicle_type;
  notesInput.value = duty.notes || "";
  successorTextInput.value = duty.successor_text || "";

  // ★ 後継リンクの選択状態を復元
  if (successorDutySelect) {
    if (duty.successor_duty_id && duty.successor_type) {
      successorDutySelect.value = `${duty.successor_type}-${duty.successor_duty_id}`;
    } else {
      successorDutySelect.value = "";
    }
  }

  const { data: trains } = await supabase
    .from("extra_duty_trains")
    .select("*")
    .eq("extra_duty_id", id)
    .order("order");

  trainsState = trains.map(t => ({
    id: t.id,
    order: t.order,
    train_number: t.train_number,
    origin: t.origin,
    destination: t.destination,
    remarks: t.remarks || "",
  }));

  normalizeOrder();
  renderTrains();
}

// ------------------------------
// フォーム初期化
// ------------------------------
function clearForm() {
  depotInput.value = "";
  dutyNumberInput.value = "";
  vehicleTypeInput.value = "";
  notesInput.value = "";
  successorTextInput.value = "";

  trainsState = [];
  renderTrains();
}

// ------------------------------
// 列車一覧描画
// ------------------------------
function renderTrains() {
  trainBody.innerHTML = "";

  trainsState
    .filter(t => !t._deleted)
    .sort((a, b) => a.order - b.order)
    .forEach((t, index) => {
      const row = document.createElement("tr");

      row.innerHTML = `
        <td>${t.order}</td>
        <td><input value="${t.train_number}" class="cell-input"></td>
        <td><input value="${t.origin}" class="cell-input"></td>
        <td><input value="${t.destination}" class="cell-input"></td>
        <td><input value="${t.remarks}" class="cell-input"></td>
        <td>
          <button class="up">↑</button>
          <button class="down">↓</button>
          <button class="del">削除</button>
        </td>
      `;

      const inputs = row.querySelectorAll("input");
      inputs[0].addEventListener("input", e => t.train_number = e.target.value);
      inputs[1].addEventListener("input", e => t.origin = e.target.value);
      inputs[2].addEventListener("input", e => t.destination = e.target.value);
      inputs[3].addEventListener("input", e => t.remarks = e.target.value);

      row.querySelector(".up").onclick = () => moveTrain(index, -1);
      row.querySelector(".down").onclick = () => moveTrain(index, 1);
      row.querySelector(".del").onclick = () => deleteTrain(index);

      trainBody.appendChild(row);
    });
}

// ------------------------------
// 並び替え
// ------------------------------
function moveTrain(index, delta) {
  const visible = trainsState.filter(t => !t._deleted).sort((a, b) => a.order - b.order);
  const target = visible[index];
  const swap = visible[index + delta];
  if (!target || !swap) return;

  const tmp = target.order;
  target.order = swap.order;
  swap.order = tmp;

  normalizeOrder();
  renderTrains();
}

function normalizeOrder() {
  trainsState
    .filter(t => !t._deleted)
    .sort((a, b) => a.order - b.order)
    .forEach((t, i) => t.order = i + 1);
}

// ------------------------------
// 列車削除
// ------------------------------
function deleteTrain(index) {
  const visible = trainsState.filter(t => !t._deleted).sort((a, b) => a.order - b.order);
  const target = visible[index];

  if (target.id) {
    target._deleted = true;
  } else {
    const idx = trainsState.indexOf(target);
    trainsState.splice(idx, 1);
  }

  normalizeOrder();
  renderTrains();
}

// ------------------------------
// 列車追加
// ------------------------------
function addTrain() {
  const maxOrder = trainsState.filter(t => !t._deleted).reduce((m, t) => Math.max(m, t.order), 0);

  trainsState.push({
    id: null,
    order: maxOrder + 1,
    train_number: "",
    origin: "",
    destination: "",
    remarks: "",
  });

  renderTrains();
}

// ------------------------------
// 保存
// ------------------------------
async function saveDuty() {
  const date = dateInput.value;
  const depot = depotInput.value.trim();
  const dutyNumber = dutyNumberInput.value.trim();
  const vehicleType = vehicleTypeInput.value.trim();

  if (!date || !depot || !dutyNumber || !vehicleType) {
    statusEl.textContent = "施行日・区所・運用番号・形式は必須です";
    return;
  }

  statusEl.textContent = "保存中…";

  // ★ 後継リンクの取得
  const successorValue = successorDutySelect.value;
  let successor_duty_id = null;
  let successor_type = null;

  if (successorValue) {
    const [type, id] = successorValue.split("-");
    successor_duty_id = Number(id);
    successor_type = type; // "regular" or "extra"
  }

  let dutyId = currentDutyId;

  // ------------------------------
  // 新規作成
  // ------------------------------
  if (!dutyId) {
    const { data, error } = await supabase
      .from("extra_duties")
      .insert({
        date,
        depot,
        duty_number: dutyNumber,
        vehicle_type: vehicleType,
        notes: notesInput.value,
        successor_text: successorTextInput.value,
        successor_duty_id,
        successor_type
      })
      .select()
      .single();

    if (error) {
      statusEl.textContent = "運用の作成に失敗しました";
      return;
    }

    dutyId = data.id;
    currentDutyId = dutyId;

  } else {
    // ------------------------------
    // 更新
    // ------------------------------
    await supabase
      .from("extra_duties")
      .update({
        date,
        depot,
        duty_number: dutyNumber,
        vehicle_type: vehicleType,
        notes: notesInput.value,
        successor_text: successorTextInput.value,
        successor_duty_id,
        successor_type
      })
      .eq("id", dutyId);
  }

  // ------------------------------
  // 列車保存
  // ------------------------------
  normalizeOrder();

  const toInsert = trainsState.filter(t => !t.id && !t._deleted && t.train_number.trim());
  const toUpdate = trainsState.filter(t => t.id && !t._deleted);
  const toDelete = trainsState.filter(t => t.id && t._deleted);

  if (toDelete.length > 0) {
    await supabase.from("extra_duty_trains").delete().in("id", toDelete.map(t => t.id));
  }

  if (toUpdate.length > 0) {
    await supabase.from("extra_duty_trains").upsert(
      toUpdate.map(t => ({
        id: t.id,
        extra_duty_id: dutyId,
        order: t.order,
        train_number: t.train_number,
        origin: t.origin,
        destination: t.destination,
        remarks: t.remarks || null,
      }))
    );
  }

  if (toInsert.length > 0) {
    await supabase.from("extra_duty_trains").insert(
      toInsert.map(t => ({
        extra_duty_id: dutyId,
        order: t.order,
        train_number: t.train_number,
        origin: t.origin,
        destination: t.destination,
        remarks: t.remarks || null,
      }))
    );
  }

  statusEl.textContent = "保存しました";

  currentDutyId = null;
  clearForm();
  await loadExtraDuties(date);
  await loadSuccessorList(); // ★ 後継候補も更新
}

// ------------------------------
// 削除（2回確認＋運用番号手入力）
// ------------------------------
async function deleteDuty() {
  if (!currentDutyId) {
    alert("削除できる臨時運用が選択されていません。");
    return;
  }

  const dutyNumber = dutyNumberInput.value.trim();

  if (!confirm(`本当に臨時運用「${dutyNumber}」を削除しますか？`)) return;

  const input = prompt(`削除するには運用番号「${dutyNumber}」を入力してください：`);
  if (input !== dutyNumber) {
    alert("運用番号が一致しません。削除を中止しました。");
    return;
  }

  await supabase.from("extra_duty_trains").delete().eq("extra_duty_id", currentDutyId);
  await supabase.from("extra_duties").delete().eq("id", currentDutyId);

  alert("臨時運用を削除しました。");

  currentDutyId = null;
  clearForm();
  await loadExtraDuties(dateInput.value);
}

// ------------------------------
// 新規
// ------------------------------
function newDuty() {
  currentDutyId = null;
  clearForm();
  statusEl.textContent = "新規運用として編集できます";
}




// ------------------------------
// 臨時運用コピー機能
// ------------------------------
async function copyExtraDuty() {
  if (!currentDutyId) {
    alert("コピーする臨時運用が選択されていません。");
    return;
  }

  const { data: duty } = await supabase
    .from("extra_duties")
    .select("*")
    .eq("id", currentDutyId)
    .single();

  const { data: trains } = await supabase
    .from("extra_duty_trains")
    .select("*")
    .eq("extra_duty_id", currentDutyId)
    .order("order");

  // フォームに複製
  dateInput.value = duty.date;
  depotInput.value = duty.depot;
  dutyNumberInput.value = ""; // ← 運用番号は空欄
  vehicleTypeInput.value = duty.vehicle_type;
  notesInput.value = duty.notes || "";
  successorTextInput.value = duty.successor_text || "";

  trainsState = trains.map((t, i) => ({
    id: null,
    order: i + 1,
    train_number: t.train_number,
    origin: t.origin,
    destination: t.destination,
    remarks: t.remarks || ""
  }));

  currentDutyId = null;
  renderTrains();

  statusEl.textContent = "コピーしました。新規運用として保存できます。";
}



// ------------------------------
// 運用一覧を読み込む（後継承用セレクト）
// ------------------------------
async function loadSuccessorList() {
  const select = document.getElementById("successor-duty-select");
  select.innerHTML = `<option value="">（なし）</option>`;

  // 所定運用
  const { data: regular } = await supabase
    .from("duties")
    .select("*")
    .order("depot")
    .order("duty_number");

  regular.forEach(d => {
    const opt = document.createElement("option");
    opt.value = `regular-${d.id}`;
    opt.textContent = `[所定] ${d.duty_number}（${d.depot}）`;
    select.appendChild(opt);
  });

  // 臨時運用
  const { data: extra } = await supabase
    .from("extra_duties")
    .select("*")
    .order("date")
    .order("duty_number");

  extra.forEach(e => {
    const opt = document.createElement("option");
    opt.value = `extra-${e.id}`;
    opt.textContent = `[臨時] ${e.duty_number}（${e.depot}）`;
    select.appendChild(opt);
  });
}
