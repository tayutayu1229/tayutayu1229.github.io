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
  // 所定の区所
  const { data: regular } = await supabase
    .from("duties")
    .select("depot");

  // 臨時の区所
  const { data: extra } = await supabase
    .from("extra_duties")
    .select("depot");

  const unique = [
    ...new Set([
      ...regular.map(d => d.depot),
      ...extra.map(e => e.depot)
    ])
  ].sort();

  unique.forEach(dep => {
    const opt = document.createElement("option");
    opt.value = dep;
    opt.textContent = dep;
    depotSelect.appendChild(opt);
  });
}




// --------------------------------------
// 初期表示：所定 + 臨時　の順で全件表示、絞り込みなし、のちに絞り込み状況を表示、１件もない場合はその旨表示、--------------------------------------
// --------------------------------------
async function loadAllDuties() {
  const results = [];

  // 所定
  const { data: duties } = await supabase
    .from("duties")
    .select("*")
    .order("duty_number");

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

  // ★ 臨時（全件）
  const { data: extra } = await supabase
    .from("extra_duties")
    .select("*")
    .order("date")
    .order("duty_number");

  for (const e of extra) {
    const { data: trains } = await supabase
      .from("extra_duty_trains")
      .select("*")
      .eq("extra_duty_id", e.id)
      .order("order");

    results.push({
      type: "extra",
      duty: e,
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
    // ------------------------------
    // ★ 施行日あり → 所定 + その日の臨時
    // ------------------------------

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

    // 臨時（その日だけ）
    const { data: extra } = await supabase
      .from("extra_duties")
      .select("*")
      .eq("date", date);

    let all = [
      ...duties.map(d => ({ type: "regular", duty: d })),
      ...extra.map(e => ({ type: "extra", duty: e }))
    ];

    // 区所
    if (depot) all = all.filter(x => x.duty.depot === depot);

    // 運用番号
    if (dutyNumber) all = all.filter(x => x.duty.duty_number.includes(dutyNumber));

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
    // ------------------------------
    // ★ 施行日なし → 所定 + 全臨時
    // ------------------------------

    // 所定
    const { data: duties } = await supabase
      .from("duties")
      .select("*");

    // 臨時（全件）
    const { data: extra } = await supabase
      .from("extra_duties")
      .select("*")
      .order("date");

    let all = [
      ...duties.map(d => ({ type: "regular", duty: d })),
      ...extra.map(e => ({ type: "extra", duty: e }))
    ];

    // 区所
    if (depot) all = all.filter(x => x.duty.depot === depot);

    // 運用番号
    if (dutyNumber) all = all.filter(x => x.duty.duty_number.includes(dutyNumber));

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

    const trainHtml = trains
      .map(t => {
        // 各項目の存在チェックを行い、空でなければ結合して表示
        const num = t.train_number ? `${t.train_number} ` : "";
        const sec = (t.origin || t.destination) ? `${t.origin || ""}〜${t.destination || ""}` : "";
        return `${num}${sec}`.trim();
      })
      .filter(line => line !== "") // 空文字の行は除外
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

  document.querySelectorAll(".duty-row").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      const type = row.dataset.type;
      openModal(id, type);
    });
  });
}


// --------------------------------------
// モーダル表示：継承、施行日、後継候補を網羅した完全版
// --------------------------------------
async function openModal(id, type) {
  let duty, trains;

  // 1. データ取得（ここは既存のままでOKですが、select文に predecessor_text が含まれるか確認してください）
  // ★重要：dutiesテーブルとextra_dutiesテーブルから全カラム取得してください
  if (type === "regular") {
    const { data } = await supabase.from("duties").select("*, diagrams(revision_date)").eq("id", id).single();
    duty = data;
    const { data: t } = await supabase.from("duty_trains").select("*").eq("duty_id", id).order("order");
    trains = t;
  } else {
    const { data } = await supabase.from("extra_duties").select("*").eq("id", id).single();
    duty = data;
    const { data: t } = await supabase.from("extra_duty_trains").select("*").eq("extra_duty_id", id).order("order");
    trains = t;
  }

  // 2. 施行日の表示
  const effectiveDate = type === "extra" ? duty.date : (duty.diagrams?.revision_date || "所定運用");

  // 3. 前継承（predecessor）の検索と表示
  let predecessorHtml = "";
  const predTable = (type === "regular") ? "duties" : "extra_duties";
  
  // 紐付いている運用を検索
  const { data: pred } = await supabase
    .from(predTable)
    .select("id, duty_number, depot, date")
    .eq("successor_duty_id", id)
    .eq("successor_type", type);

  if (pred && pred.length > 0) {
    // リンクが存在する場合
    const p = pred[0];
    const label = p.date ? `${p.date} ${p.duty_number}（${p.depot}）` : `${p.duty_number}（${p.depot}）`;
    predecessorHtml = `
      <div class="modal-predecessor small-label">
        前継承：<a href="#" class="predecessor-link" data-id="${p.id}" data-type="${type}">${label}</a>
      </div>`;
  } else if (duty.predecessor_text) {
    // 紐付けなしの場合はテキストを表示
    predecessorHtml = `<div class="modal-predecessor small-label">前継承：${duty.predecessor_text}</div>`;
  }

  // 4. 後継承（successor）の表示
  let successorHtml = "";
  if (duty.successor_duty_id) {
    const succTable = (duty.successor_type === "regular") ? "duties" : "extra_duties";
    const { data: succ } = await supabase.from(succTable).select("id").eq("id", duty.successor_duty_id).single();
    
    if (succ) {
      successorHtml = `
        <div class="modal-successor">
          後継承：<a href="#" class="successor-link" data-id="${succ.id}" data-type="${duty.successor_type}">${duty.successor_text}</a>
        </div>`;
    }
  } else if (duty.successor_text) {
    successorHtml = `<div class="modal-successor">後継承：${duty.successor_text}</div>`;
  }

  // 5. 後継候補の検索
  const { data: candidates } = await supabase
    .from("extra_duties")
    .select("id, duty_number, depot, date")
    .eq("duty_number", duty.duty_number)
    .eq("depot", duty.depot)
    .neq("id", id)
    .order("date", { ascending: true });

  const candidatesHtml = (candidates && candidates.length > 0) ? `
    <div class="candidate-list">
      <h4>後継候補</h4>
      ${candidates.map(c => `
        <div class="successor-candidate" data-id="${c.id}" data-type="extra">
          ${c.date}　${c.duty_number}（${c.depot}）
        </div>`).join("")}
    </div>` : "";

  // 6. HTMLの組み立て
  modalContent.innerHTML = `
    <div class="modal-date">施行日：${effectiveDate}</div>
    <h2>${duty.duty_number}　${duty.depot}</h2>
    <h3>${duty.vehicle_type}</h3>
    ${predecessorHtml}
    <div class="modal-trains">
      ${trains.map(t => `
        <div class="modal-train-row">
          <span class="modal-train-num">${t.train_number}</span>
          <span class="modal-train-sec">${t.origin}〜${t.destination}</span>
        </div>`).join("")}
    </div>
    ${duty.notes ? `<pre class="modal-notes">${duty.notes}</pre>` : ""}
    ${successorHtml}
    ${candidatesHtml}
  `;

  // 7. イベント登録
  modalContent.querySelectorAll(".successor-link, .predecessor-link, .successor-candidate").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openModal(el.dataset.id, el.dataset.type);
    });
  });

  modalDuty = { duty, trains, type };
  modal.style.display = "flex";
}




// --------------------------------------
// モーダル閉じる
// --------------------------------------
modalClose.addEventListener("click", () => {
  modal.style.display = "none";
});

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
  const head = `${date}\n${duty.duty_number}　${duty.depot}\n${duty.vehicle_type}`;

  const trainLines = trains
    .map(t => `${t.train_number}　${t.origin}〜${t.destination}`)
    .join("\n");

  const successor = duty.successor_text ? `\n　${duty.successor_text}` : "";
  const notes = duty.notes ? `\n${duty.notes}` : "";

  const text = `${head}\n${trainLines}${successor}${notes}`;

  navigator.clipboard.writeText(text);
});
