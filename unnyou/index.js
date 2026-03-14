import { supabase } from "./supabaseClient.js";

const dateInput = document.getElementById("date");
const depotSelect = document.getElementById("depot");
const dutyNumberInput = document.getElementById("duty-number");
const trainNumberInput = document.getElementById("train-number");
const searchBtn = document.getElementById("search");
const filterStatus = document.getElementById("filter-status");
const resultList = document.getElementById("result-list");

// モーダル
const modal = document.getElementById("modal");
const modalContent = document.getElementById("modal-content");
const modalClose = document.getElementById("modal-close");
const modalCopy = document.getElementById("modal-copy");

let modalDuty = null;

// --------------------------------------
// 初期化
// --------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  await loadDepotList();
  await loadAllDuties();
});

// --------------------------------------
// 区所一覧
// --------------------------------------
async function loadDepotList() {
  const { data } = await supabase
    .from("duties")
    .select("depot")
    .order("depot");

  const unique = [...new Set(data.map(d => d.depot))];

  unique.forEach(dep => {
    const opt = document.createElement("option");
    opt.value = dep;
    opt.textContent = dep;
    depotSelect.appendChild(opt);
  });
}

// --------------------------------------
// 初期表示：全運用（所定のみ）
// --------------------------------------
async function loadAllDuties() {
  const { data: duties } = await supabase
    .from("duties")
    .select("*")
    .order("duty_number");

  const results = [];

  for (const duty of duties) {
    const { data: trains } = await supabase
      .from("duty_trains")
      .select("*")
      .eq("duty_id", duty.id)
      .order("order");

    results.push({
      type: "regular",
      duty,
      trains
    });
  }

  renderTable(results);
  updateFilterStatus();
}

// --------------------------------------
// 検索
// --------------------------------------
searchBtn.addEventListener("click", async () => {
  await searchDuties();
});

// --------------------------------------
// 検索ロジック（所定 + 臨時）
// --------------------------------------
async function searchDuties() {
  const date = dateInput.value;
  const depot = depotSelect.value;
  const dutyNumber = dutyNumberInput.value.trim();
  const trainNumber = trainNumberInput.value.trim();

  let results = [];

  if (date) {
    // 改正判定
    const { data: diagrams } = await supabase
      .from("diagrams")
      .select("*")
      .lte("revision_date", date)
      .order("revision_date", { ascending: false })
      .limit(1);

    if (diagrams.length === 0) {
      resultList.innerHTML = "<p>該当する改正がありません。</p>";
      return;
    }

    const diagramId = diagrams[0].id;

    // 所定
    const { data: duties } = await supabase
      .from("duties")
      .select("*")
      .eq("diagram_id", diagramId);

    // 臨時
    const { data: extra } = await supabase
      .from("extra_duties")
      .select("*")
      .eq("date", date);

    let all = [
      ...duties.map(d => ({ type: "regular", duty: d })),
      ...extra.map(e => ({ type: "extra", duty: e }))
    ];

    // 区所
    if (depot) {
      all = all.filter(x => x.duty.depot === depot);
    }

    // 運用番号
    if (dutyNumber) {
      all = all.filter(x => x.duty.duty_number.includes(dutyNumber));
    }

    // 列車取得
    for (const item of all) {
      if (item.type === "regular") {
        const { data: trains } = await supabase
          .from("duty_trains")
          .select("*")
          .eq("duty_id", item.duty.id)
          .order("order");
        item.trains = trains;
      } else {
        const { data: trains } = await supabase
          .from("extra_duty_trains")
          .select("*")
          .eq("extra_duty_id", item.duty.id)
          .order("order");
        item.trains = trains;
      }
    }

    // 列車番号
    if (trainNumber) {
      all = all.filter(item =>
        item.trains.some(t => t.train_number.includes(trainNumber))
      );
    }

    results = all;

  } else {
    // 施行日なし → 所定のみ
    const { data: duties } = await supabase
      .from("duties")
      .select("*");

    let filtered = duties;

    if (depot) filtered = filtered.filter(d => d.depot === depot);
    if (dutyNumber) filtered = filtered.filter(d => d.duty_number.includes(dutyNumber));

    for (const duty of filtered) {
      const { data: trains } = await supabase
        .from("duty_trains")
        .select("*")
        .eq("duty_id", duty.id)
        .order("order");

      results.push({
        type: "regular",
        duty,
        trains
      });
    }

    if (trainNumber) {
      results = results.filter(item =>
        item.trains.some(t => t.train_number.includes(trainNumber))
      );
    }
  }

  renderTable(results);
  updateFilterStatus();
}

// --------------------------------------
// 絞り込み状況
// --------------------------------------
function updateFilterStatus() {
  filterStatus.innerHTML = `
    施行日：${dateInput.value || "指定なし"}　
    区所名：${depotSelect.value || "指定なし"}　
    運用番号：${dutyNumberInput.value || "指定なし"}　
    列車番号：${trainNumberInput.value || "指定なし"}
  `;
}

// --------------------------------------
// 表形式で表示
// --------------------------------------
function renderTable(results) {
  resultList.innerHTML = "";

  if (results.length === 0) {
    resultList.innerHTML = "<p>該当する運用はありません。</p>";
    return;
  }

  let html = `
    <table class="result-table">
      <thead>
        <tr>
          <th>施行日</th>
          <th>区所名</th>
          <th>運用番号</th>
          <th>列車一覧</th>
          <th>形式</th>
        </tr>
      </thead>
      <tbody>
  `;

  results.forEach(item => {
    const duty = item.duty;
    const trains = item.trains;

    // 列車一覧をまとめて 1 セルに入れる
    const trainHtml = trains
      .map(t => `${t.train_number}　${t.origin}〜${t.destination}`)
      .join("<br>");

    html += `
      <tr class="duty-row" data-id="${duty.id}" data-type="${item.type}">
        <td>${item.type === "extra" ? duty.date : "所定"}</td>
        <td>${duty.depot}</td>
        <td>${duty.duty_number}</td>
        <td>${trainHtml}</td>
        <td>${duty.vehicle_type || ""}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  resultList.innerHTML = html;

  // 行クリックでモーダル
  document.querySelectorAll(".duty-row").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      const type = row.dataset.type;
      openModal(id, type);
    });
  });
}


// --------------------------------------
// モーダル表示
// --------------------------------------
async function openModal(id, type) {
  let duty, trains;

  if (type === "regular") {
    const { data } = await supabase
      .from("duties")
      .select("*")
      .eq("id", id)
      .single();
    duty = data;

    const { data: t } = await supabase
      .from("duty_trains")
      .select("*")
      .eq("duty_id", id)
      .order("order");
    trains = t;

  } else {
    const { data } = await supabase
      .from("extra_duties")
      .select("*")
      .eq("id", id)
      .single();
    duty = data;

    const { data: t } = await supabase
      .from("extra_duty_trains")
      .select("*")
      .eq("extra_duty_id", id)
      .order("order");
    trains = t;
  }

  modalDuty = { duty, trains, type };

  modalContent.innerHTML = `
    <h2>${type === "extra" ? "臨" : ""}${duty.duty_number}　${duty.depot}</h2>
    <h3>${duty.vehicle_type}</h3>

    <div class="modal-trains">
      ${trains
        .map(t => `
          <div class="modal-train-row">
            <span class="modal-train-num">${t.train_number}</span>
            <span class="modal-train-sec">${t.origin}〜${t.destination}</span>
          </div>
        `)
        .join("")}
    </div>

    ${duty.notes ? `<pre class="modal-notes">${duty.notes}</pre>` : ""}

    ${
      duty.successor_text
        ? `<div class="modal-successor">△後継承　${duty.successor_text}</div>`
        : ""
    }
  `;

  modal.style.display = "flex";
}

// --------------------------------------
// モーダル閉じる
// --------------------------------------
modalClose.addEventListener("click", () => {
  modal.style.display = "none";
});

// 背景クリックで閉じる
modal.addEventListener("click", e => {
  if (e.target === modal) {
    modal.style.display = "none";
  }
});

// --------------------------------------
// コピー機能
// --------------------------------------
modalCopy.addEventListener("click", () => {
  if (!modalDuty) return;

  const { duty, trains, type } = modalDuty;

  const date = duty.date ? duty.date.replace(/-/g, "/") : "";
  const head = `${date}\n${type === "extra" ? "臨" : ""}${duty.duty_number}　${duty.depot}\n${duty.vehicle_type}`;

  const trainLines = trains
    .map(t => `${t.train_number}　${t.origin}〜${t.destination}`)
    .join("\n");

  const successor = duty.successor_text ? `\n　${duty.successor_text}` : "";
  const notes = duty.notes ? `\n${duty.notes}` : "";

  const text = `${head}\n${trainLines}${successor}${notes}`;

  navigator.clipboard.writeText(text);
});
