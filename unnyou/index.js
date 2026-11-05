import { supabase } from "./supabaseClient.js?v=20261106-loading2";

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
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
}[char]));

let modalDuty = null;

// --------------------------------------
// 初期化
// --------------------------------------
window.addEventListener("DOMContentLoaded", () => searchDuties(true));
searchBtn.addEventListener("click", () => searchDuties(false));
let searching=false;
async function checked(query){const {data,error}=await query;if(error)throw error;return data||[];}
async function searchDuties(initial=false){
 if(searching)return;searching=true;searchBtn.disabled=true;
 TayunetLoading.show('運用と列車データを読み込んでいます…');
 try{
  const date=dateInput.value,depot=depotSelect.value,dutyNumber=dutyNumberInput.value.trim(),trainNumber=trainNumberInput.value.trim();
  let regularQuery=supabase.from('duties').select('*').order('duty_number');
  let extraQuery=supabase.from('extra_duties').select('*').order('date').order('duty_number');
  if(date){
   const diagrams=await checked(supabase.from('diagrams').select('id').lte('revision_date',date).order('revision_date',{ascending:false}).limit(1));
   if(!diagrams.length){renderTable([]);updateFilterStatus();TayunetLoading.done('該当する改正がありません。');return;}
   regularQuery=regularQuery.eq('diagram_id',diagrams[0].id);extraQuery=extraQuery.eq('date',date);
  }
  const [duties,extra]=await Promise.all([checked(regularQuery),checked(extraQuery)]);
  if(initial){
   const depots=[...new Set([...duties,...extra].map(d=>d.depot).filter(Boolean))].sort();
   for(const name of depots){const option=document.createElement('option');option.value=name;option.textContent=name;depotSelect.append(option);}
  }
  const match=d=>(!depot||d.depot===depot)&&(!dutyNumber||d.duty_number.includes(dutyNumber));
  const regular=duties.filter(match),temporary=extra.filter(match);
  const [regularTrains,extraTrains]=await Promise.all([
   regular.length?checked(supabase.from('duty_trains').select('*').in('duty_id',regular.map(d=>d.id)).order('order')):[],
   temporary.length?checked(supabase.from('extra_duty_trains').select('*').in('extra_duty_id',temporary.map(d=>d.id)).order('order')):[]
  ]);
  const group=(rows,key)=>{const map=new Map();for(const row of rows){if(!map.has(row[key]))map.set(row[key],[]);map.get(row[key]).push(row);}return map;};
  const regularMap=group(regularTrains,'duty_id'),extraMap=group(extraTrains,'extra_duty_id');
  let results=[...regular.map(duty=>({type:'regular',duty,trains:regularMap.get(duty.id)||[]})),...temporary.map(duty=>({type:'extra',duty,trains:extraMap.get(duty.id)||[]}))];
  if(trainNumber)results=results.filter(item=>item.trains.some(t=>t.train_number.includes(trainNumber)));
  renderTable(results);updateFilterStatus();TayunetLoading.done(`${results.length}運用を読み込みました。`);
 }catch(error){TayunetLoading.error('運用データの読み込みに失敗しました。',()=>searchDuties(initial));}
 finally{searching=false;searchBtn.disabled=false;}
}

// --------------------------------------
// 絞り込み状況
// --------------------------------------
function updateFilterStatus() {
  filterStatus.textContent = `施行日：${dateInput.value || "指定なし"}　区所名：${depotSelect.value || "指定なし"}　運用番号：${dutyNumberInput.value || "指定なし"}　列車番号：${trainNumberInput.value || "指定なし"}`;
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
        const num = t.train_number ? `${escapeHtml(t.train_number)} ` : "";
        const sec = (t.origin || t.destination) ? `${escapeHtml(t.origin)}〜${escapeHtml(t.destination)}` : "";
        return `${num}${sec}`.trim();
      })
      .filter(line => line !== "") // 空文字の行は除外
      .join("<br>");

    html += `
      <tr class="duty-row" data-id="${escapeHtml(duty.id)}" data-type="${escapeHtml(item.type)}">
        <td>${item.type === "extra" ? escapeHtml(duty.date) : "所定"}</td>
        <td>${escapeHtml(duty.depot)}</td>
        <td>${escapeHtml(duty.duty_number)}</td>
        <td>${trainHtml}</td>
        <td>${escapeHtml(duty.vehicle_type)}</td>
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
        前継承：<a href="#" class="predecessor-link" data-id="${escapeHtml(p.id)}" data-type="${escapeHtml(type)}">${escapeHtml(label)}</a>
      </div>`;
  } else if (duty.predecessor_text) {
    // 紐付けなしの場合はテキストを表示
    predecessorHtml = `<div class="modal-predecessor small-label">前継承：${escapeHtml(duty.predecessor_text)}</div>`;
  }

  // 4. 後継承（successor）の表示
  let successorHtml = "";
  if (duty.successor_duty_id) {
    const succTable = (duty.successor_type === "regular") ? "duties" : "extra_duties";
    const { data: succ } = await supabase.from(succTable).select("id").eq("id", duty.successor_duty_id).single();
    
    if (succ) {
      successorHtml = `
        <div class="modal-successor">
          後継承：<a href="#" class="successor-link" data-id="${escapeHtml(succ.id)}" data-type="${escapeHtml(duty.successor_type)}">${escapeHtml(duty.successor_text)}</a>
        </div>`;
    }
  } else if (duty.successor_text) {
    successorHtml = `<div class="modal-successor">後継承：${escapeHtml(duty.successor_text)}</div>`;
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
        <div class="successor-candidate" data-id="${escapeHtml(c.id)}" data-type="extra">
          ${escapeHtml(c.date)}　${escapeHtml(c.duty_number)}（${escapeHtml(c.depot)}）
        </div>`).join("")}
    </div>` : "";

  // 6. HTMLの組み立て
  modalContent.innerHTML = `
    <div class="modal-date">施行日：${escapeHtml(effectiveDate)}</div>
    <h2>${escapeHtml(duty.duty_number)}　${escapeHtml(duty.depot)}</h2>
    <h3>${escapeHtml(duty.vehicle_type)}</h3>
    ${predecessorHtml}
    <div class="modal-trains">
      ${trains.map(t => `
        <div class="modal-train-row">
          <span class="modal-train-num">${escapeHtml(t.train_number)}</span>
          <span class="modal-train-sec">${escapeHtml(t.origin)}〜${escapeHtml(t.destination)}</span>
        </div>`).join("")}
    </div>
    ${duty.notes ? `<pre class="modal-notes">${escapeHtml(duty.notes)}</pre>` : ""}
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
