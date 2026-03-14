import { supabase } from "./supabaseClient.js";

const dateInput = document.getElementById("date");
const depotInput = document.getElementById("depot");
const dutyNumberInput = document.getElementById("duty-number");
const vehicleTypeInput = document.getElementById("vehicle-type");
const trainBody = document.getElementById("train-body");
const addTrainBtn = document.getElementById("add-train");
const saveBtn = document.getElementById("save");
const newDutyBtn = document.getElementById("new-duty");
const statusEl = document.getElementById("status");

const notesInput = document.getElementById("notes");
const successorTextInput = document.getElementById("successor-text");

let currentDutyId = null;
let trainsState = [];

// 初期化
window.addEventListener("DOMContentLoaded", () => {
  clearForm();
});

// フォーム初期化
function clearForm() {
  dateInput.value = "";
  depotInput.value = "";
  dutyNumberInput.value = "";
  vehicleTypeInput.value = "";
  notesInput.value = "";
  successorTextInput.value = "";

  trainsState = [];
  renderTrains();
}

// 列車一覧描画
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

// 列車追加
addTrainBtn.addEventListener("click", () => {
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
});

// 保存
saveBtn.addEventListener("click", async () => {
  const date = dateInput.value;
  const depot = depotInput.value.trim();
  const dutyNumber = dutyNumberInput.value.trim();
  const vehicleType = vehicleTypeInput.value.trim();

  if (!date || !depot || !dutyNumber || !vehicleType) {
    statusEl.textContent = "施行日・区所・運用番号・形式は必須です";
    return;
  }

  statusEl.textContent = "保存中…";

  let dutyId = currentDutyId;

  // 新規作成
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
      })
      .select()
      .single();

    if (error) {
      statusEl.textContent = "運用の作成に失敗しました";
      return;
    }

    dutyId = data.id;

  } else {
    // 更新
    await supabase
      .from("extra_duties")
      .update({
        date,
        depot,
        duty_number: dutyNumber,
        vehicle_type: vehicleType,
        notes: notesInput.value,
        successor_text: successorTextInput.value,
      })
      .eq("id", dutyId);
  }

  // 列車保存
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

  // 保存完了 → 新規モードに戻す
  currentDutyId = null;
  clearForm();
});

// 新規ボタン
newDutyBtn.addEventListener("click", () => {
  currentDutyId = null;
  clearForm();
  statusEl.textContent = "新規運用として編集できます";
});
