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
let predecessorTextInput;

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
predecessorTextInput = document.getElementById("predecessor-text");
if (!successorDutySelect) {
console.error("致命的エラー: #successor-duty-id が見つかりません。HTMLのロード順を確認してください。");

if (!depotInput) console.warn("警告: #depot が見つかりません");
if (!dutyNumberInput) console.warn("警告: #duty-number が見つかりません");
if (!vehicleTypeInput) console.warn("警告: #vehicle-type が見つかりません");
if (!trainBody) console.warn("警告: #train-body が見つかりません");
if (!addTrainBtn) console.warn("警告: #add-train が見つかりません");
if (!saveBtn) console.warn("警告: #save が見つかりません");
if (!newDutyBtn) console.warn("警告: #new-duty が見つかりません");
if (!statusEl) console.warn("警告: #status が見つかりません");
if (!notesInput) console.warn("警告: #notes が見つかりません");
if (!successorTextInput) console.warn("警告: #successor-text が見つかりません");
if (!predecessorTextInput) console.warn("警告: #predecessor-text が見つかりません");

}


//削除するもの

const deleteBtn = document.getElementById("delete-duty");



deleteBtn.addEventListener("click", async () => {

if (!currentDutyId) {

alert("削除できる運用が選択されていません。");

return;

}



const dutyNumber = dutyNumberInput.value.trim();



// 1回目の確認

if (!confirm(`本当に運用「${dutyNumber}」を削除しますか？`)) return;



// 2回目の確認（手入力）

const input = prompt(`削除するには運用番号「${dutyNumber}」を入力してください：`);

if (input !== dutyNumber) {

alert("運用番号が一致しません。削除を中止しました。");

return;

}



// duty_trains → duties の順で削除

await supabase.from("duty_trains").delete().eq("duty_id", currentDutyId);

await supabase.from("duties").delete().eq("id", currentDutyId);



alert("運用を削除しました。");



currentDutyId = null;

clearForm();

await loadDuties(currentDiagramId);

});









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



if (depotInput) depotInput.value = duty.depot || "";

if (dutyNumberInput) dutyNumberInput.value = duty.duty_number || "";

if (vehicleTypeInput) vehicleTypeInput.value = duty.vehicle_type || "";

if (predecessorTextInput) {
    predecessorTextInput.value = duty.predecessor_text || "";
  }

if (notesInput) {
    notesInput.value = duty.notes || "";
  }

if (successorTextInput) {
    successorTextInput.value = duty.successor_text || "";
  }

// ★ ここだけガードを入れる

if (successorDutySelect) {

successorDutySelect.value = duty.successor_duty_id || "";

}



// 列車データも読み込む

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





notesInput.value = duty.notes || "";

document.getElementById("predecessor-text").value = duty.predecessor_text || "";



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

// ★ ここもガードが必要

if (successorDutySelect) {

successorDutySelect.value = "";
predecessorTextInput.value = "";

}



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
// 保存（修正版）
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

  // ★ここで共通のデータオブジェクトを先に作る
  const dutyData = {
    diagram_id: currentDiagramId, // 新規時のみ使用される
    depot: depot,
    duty_number: dutyNumber,
    vehicle_type: vehicleType,
    notes: notesInput.value,
    successor_text: successorTextInput.value,
    successor_duty_id: successorDutySelect.value || null,
    predecessor_text: predecessorTextInput.value // これで新規・更新どちらも保存される
  };

  let dutyId = currentDutyId;

  if (!dutyId) {
    // 【新規作成】共通の dutyData を使用
    const { data, error } = await supabase
      .from("duties")
      .insert(dutyData)
      .select()
      .single();

    if (error) {
      statusEl.textContent = "運用の作成に失敗しました";
      return;
    }
    dutyId = data.id;
    currentDutyId = dutyId;
  } else {
    // 【更新】共通の dutyData を使用
    await supabase
      .from("duties")
      .update(dutyData)
      .eq("id", dutyId);
  }

  // --- 列車データの処理（既存のまま） ---
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
  
  // もし保存後に画面を空にしたい場合は以下の2行を残す
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