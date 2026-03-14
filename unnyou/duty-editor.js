import { supabase } from "./supabaseClient.js";

let diagramSelect;
let depotInput;
let dutyNumberInput;
let vehicleTypeInput;
let trainBody;
let addTrainBtn;
let saveBtn;
let newDutyBtn;
let statusEl;
let notesInput;
let successorTextInput;
let successorDutySelect;

let currentDiagramId = null;
let currentDutyId = null;
let trainsState = [];

// ------------------------------
// 初期化（ここで DOM を取得する）
// ------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  diagramSelect = document.getElementById("diagram");
  depotInput = document.getElementById("depot");
  dutyNumberInput = document.getElementById("duty-number");
  vehicleTypeInput = document.getElementById("vehicle-type");
  trainBody = document.getElementById("train-body");
  addTrainBtn = document.getElementById("add-train");
  saveBtn = document.getElementById("save");
  newDutyBtn = document.getElementById("new-duty");
  statusEl = document.getElementById("status");
  notesInput = document.getElementById("notes");
  successorTextInput = document.getElementById("successor-text");
  successorDutySelect = document.getElementById("successor-duty-id");

  // イベント登録
  diagramSelect.addEventListener("change", async () => {
    currentDiagramId = diagramSelect.value;
    await loadDuties(currentDiagramId);
  });

  document.getElementById("duty-select").addEventListener("change", async (e) => {
    const id = e.target.value;

    if (!id) {
      currentDutyId = null;
      clearForm();
      return;
    }

    currentDutyId = id;
    await loadDutyDetail(id);
  });

  addTrainBtn.addEventListener("click", addTrain);
  newDutyBtn.addEventListener("click", newDuty);
  saveBtn.addEventListener("click", saveDuty);

  // 初回ロード
  await loadDiagrams();
});

// ------------------------------
// ダイヤ改正一覧
// ------------------------------
async function loadDiagrams() {
  const { data } = await supabase
    .from("diagrams")
    .select("*")
    .order("revision_date", { ascending: false });

  diagramSelect.innerHTML = "";
  data.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    diagramSelect.appendChild(opt);
  });

  if (data.length > 0) {
    currentDiagramId = data[0].id;
    await loadDuties(currentDiagramId);
  }
}

// ------------------------------
// 運用一覧
// ------------------------------
async function loadDuties(diagramId) {
  const { data } = await supabase
    .from("duties")
    .select("*")
    .eq("diagram_id", diagramId)
    .order("depot")
    .order("duty_number");

  const dutySelect = document.getElementById("duty-select");
  dutySelect.innerHTML = `<option value="">（新規作成）</option>`;

  data.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.duty_number}（${d.depot}）`;
    dutySelect.appendChild(opt);
  });

  // 後継運用プルダウン更新
  successorDutySelect.innerHTML = `<option value="">（なし）</option>`;
  data.forEach(d => {
    const opt2 = document.createElement("option");
    opt2.value = d.id;
    opt2.textContent = `${d.duty_number}｜${d.depot}｜${d.vehicle_type}`;
    successorDutySelect.appendChild(opt2);
  });
}
// ------------------------------
// 運用詳細
// ------------------------------
async function loadDutyDetail(dutyId) {
  const { data: duty } = await supabase
    .from("duties")
    .select("*")
    .eq("id", dutyId)
    .single();

  depotInput.value = duty.depot;
  dutyNumberInput.value = duty.duty_number;
  vehicleTypeInput.value = duty.vehicle_type;

  notesInput.value = duty.notes || "";
  successorTextInput.value = duty.successor_text || "";
  successorDutySelect.value = duty.successor_duty_id || "";  // ← ここが null で落ちていた

  const { data: trains } = await supabase
    .from("duty_trains")
    .select("*")
    .eq("duty_id", dutyId)
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
  successorDutySelect.value = "";

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
// 削除
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
  const depot = depotInput.value.trim();
  const dutyNumber = dutyNumberInput.value.trim();
  const vehicleType = vehicleTypeInput.value.trim();

  if (!depot || !dutyNumber || !vehicleType) {
    statusEl.textContent = "区所・運用番号・形式は必須です";
    return;
  }

  statusEl.textContent = "保存中…";

  let dutyId = currentDutyId;

  if (!dutyId) {
    const { data, error } = await supabase
      .from("duties")
      .insert({
        diagram_id: currentDiagramId,
        depot,
        duty_number: dutyNumber,
        vehicle_type: vehicleType,
        notes: notesInput.value,
        successor_text: successorTextInput.value,
        successor_duty_id: successorDutySelect.value || null,
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
    await supabase
      .from("duties")
      .update({
        depot,
        duty_number: dutyNumber,
        vehicle_type: vehicleType,
        notes: notesInput.value,
        successor_text: successorTextInput.value,
        successor_duty_id: successorDutySelect.value || null,
      })
      .eq("id", dutyId);
  }

  normalizeOrder();

  const toInsert = trainsState.filter(t => !t.id && !t._deleted && t.train_number.trim());
  const toUpdate = trainsState.filter(t => t.id && !t._deleted);
  const toDelete = trainsState.filter(t => t.id && t._deleted);

  if (toDelete.length > 0) {
    await supabase.from("duty_trains").delete().in("id", toDelete.map(t => t.id));
  }

  if (toUpdate.length > 0) {
    await supabase.from("duty_trains").upsert(
      toUpdate.map(t => ({
        id: t.id,
        duty_id: dutyId,
        order: t.order,
        train_number: t.train_number,
        origin: t.origin,
        destination: t.destination,
        remarks: t.remarks || null,
      }))
    );
  }

  if (toInsert.length > 0) {
    await supabase.from("duty_trains").insert(
      toInsert.map(t => ({
        duty_id: dutyId,
        order: t.order,
        train_number: t.train_number,
        origin: t.origin,
        destination: t.destination,
        remarks: t.remarks || null,
      }))
    );
  }

  statusEl.textContent = "保存しました";
  await loadDutyDetail(dutyId);

  currentDutyId = null;
  clearForm();
}

// ------------------------------
// 新規運用
// ------------------------------
function newDuty() {
  currentDutyId = null;
  clearForm();
  statusEl.textContent = "新規運用として編集できます";
}
