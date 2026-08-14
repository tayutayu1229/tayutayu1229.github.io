(() => {
  "use strict";
  const config = window.INCIDENT_SYSTEM_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const samples = [
    { id:"sample-flood", title:"駅構内冠水", line:"外房線", location:"大網駅 コンコース", comment:"大雨によりコンコース床面が冠水。旅客通路を規制し、排水作業を実施中。", reporter:"千葉支社／大網駅", occurredAt:"2026-08-14T10:12:00+09:00", severity:"緊急", status:"対応中", mediaUrl:"./assets/demo-flood.png", mediaType:"image/png", lat:35.5234, lng:140.3119 },
    { id:"sample-track", title:"線路内支障物を確認", line:"中央本線", location:"高尾〜相模湖間 42K380M付近", comment:"倒木の一部が上り線建築限界内に支障。現地係員が到着し、安全確認を実施中。", reporter:"八王子運輸区／現地確認班", occurredAt:"2026-08-14T09:42:00+09:00", severity:"緊急", status:"対応中", mediaUrl:"./assets/demo-track.png", mediaType:"image/png", lat:35.6427, lng:139.2821 },
    { id:"sample-phone", title:"列車内遺失物の確認", line:"上越線", location:"新潟駅 5番線・車内", comment:"座席付近でスマートフォンを発見。駅係員へ引継ぎ済み。運行への影響なし。", reporter:"新潟運輸区", occurredAt:"2026-08-14T08:47:00+09:00", severity:"情報", status:"復旧済", mediaUrl:"./assets/demo-phone.png", mediaType:"image/png" },
    { id:"sample-sign", title:"駅構内掲示物を確認", line:"横浜線", location:"石川町駅 トイレ内", comment:"不適切な掲示物を発見。施設担当へ連絡し、撤去対応を依頼済み。", reporter:"横浜支店／駅係員", occurredAt:"2026-08-14T07:25:00+09:00", severity:"警戒", status:"確認中", mediaUrl:"./assets/demo-sign.png", mediaType:"image/png" },
  ];
  let items = [...samples];
  let selected = null;
  let selectedSeverity = "";
  let position = null;
  let captureKind = "image";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const app = $("#app");
  const photoGrid = $("#photoGrid");
  const detailOverlay = $("#detailOverlay");
  const uploadOverlay = $("#uploadOverlay");

  function api(path) { return `${apiBase}${path}`; }
  function escapeHtml(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
  function dateLabel(value) { return new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }).format(new Date(value)); }
  function longDate(value) { return new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit" }).format(new Date(value)); }
  function showToast(message) { const toast = $("#toast"); toast.textContent = `✓　${message}`; toast.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.hidden = true, 3200); }

  function render() {
    const query = $("#searchInput").value.trim().toLowerCase();
    const line = $("#lineFilter").value;
    const filtered = items.filter((item) => (!selectedSeverity || item.severity === selectedSeverity) && (!line || item.line === line) && (!query || `${item.title} ${item.location} ${item.comment}`.toLowerCase().includes(query)));
    $("#resultCount").textContent = `${filtered.length}件`;
    $("#todayCount").textContent = items.length;
    $("#activeCount").textContent = items.filter((item) => item.status !== "復旧済").length;
    photoGrid.innerHTML = filtered.map((item) => `<button class="photo-card" data-id="${escapeHtml(item.id)}"><div class="thumb"><img src="${escapeHtml(item.mediaUrl)}" alt="${escapeHtml(item.title)}">${item.mediaType.startsWith("video") ? '<span class="play-mark">▶</span>' : ""}<span class="severity-label ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></div><div class="photo-info"><div><b>${escapeHtml(item.title)}</b><time>${dateLabel(item.occurredAt)}</time></div><p>${escapeHtml(item.line)}　${escapeHtml(item.location)}</p><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></div></button>`).join("");
    $$(".photo-card").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.id)));
  }

  function populateLines() {
    const select = $("#lineFilter");
    const value = select.value;
    select.innerHTML = '<option value="">全路線</option>' + [...new Set(items.map((item) => item.line))].map((line) => `<option>${escapeHtml(line)}</option>`).join("");
    select.value = value;
  }

  async function loadItems() {
    if (!apiBase) { $("#serverStatus").textContent = "デモ表示中"; render(); return; }
    try {
      const response = await fetch(api("/api/incidents"), { headers: { accept:"application/json" } });
      if (!response.ok) throw new Error();
      const data = await response.json();
      items = [...data.incidents.map((item) => ({ ...item, mediaUrl: item.mediaUrl?.startsWith("/") ? `${apiBase}${item.mediaUrl}` : item.mediaUrl })), ...samples];
      $("#serverStatus").textContent = "共有サーバー接続中";
      populateLines(); render();
    } catch { $("#serverStatus").textContent = "サーバー未接続"; showToast("共有サーバーに接続できません"); }
  }

  function openDetail(id) {
    selected = items.find((item) => item.id === id);
    if (!selected) return;
    $("#detailPhoto").innerHTML = selected.mediaType.startsWith("video") ? `<video src="${escapeHtml(selected.mediaUrl)}" controls></video>` : `<img src="${escapeHtml(selected.mediaUrl)}" alt="${escapeHtml(selected.title)}">`;
    $("#detailTitle").textContent = selected.title; $("#detailTime").textContent = longDate(selected.occurredAt); $("#detailLine").textContent = selected.line; $("#detailReporter").textContent = selected.reporter; $("#detailComment").textContent = selected.comment;
    $("#detailLocation").innerHTML = escapeHtml(selected.location) + (selected.lat ? ` <a href="https://maps.google.com/?q=${selected.lat},${selected.lng}" target="_blank" rel="noreferrer">位置を地図表示</a>` : "");
    $("#statusSwitch").innerHTML = ["対応中","確認中","復旧済"].map((status) => `<button data-status="${status}" class="${selected.status === status ? "active" : ""}">${status}</button>`).join("");
    $$("[data-status]").forEach((button) => button.addEventListener("click", () => updateStatus(button.dataset.status)));
    detailOverlay.hidden = false;
  }

  async function updateStatus(status) {
    if (!selected) return;
    selected.status = status; render(); openDetail(selected.id);
    if (apiBase && !selected.id.startsWith("sample")) fetch(api("/api/incidents"), { method:"PATCH", headers:{ "content-type":"application/json" }, body:JSON.stringify({ id:selected.id, status }) }).catch(() => {});
    showToast(`状態を「${status}」へ更新しました`);
  }

  function openCapture(kind) {
    captureKind = kind;
    position = null;
    $("#uploadTitle").textContent = kind === "image" ? "静止画撮影・共有" : "動画撮影・共有";
    $("#captureLabel").textContent = kind === "image" ? "カメラを起動" : "ビデオを起動";
    $("#mediaInput").accept = kind === "image" ? "image/*" : "video/*";
    $("#captureIcon").className = kind === "image" ? "camera-icon" : "video-icon";
    uploadOverlay.hidden = false;
    navigator.geolocation?.getCurrentPosition((result) => { position = { lat:result.coords.latitude, lng:result.coords.longitude }; $("#gpsIcon").classList.add("ok"); $("#gpsTitle").textContent = "位置情報を取得しました"; $("#gpsValue").textContent = `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`; }, () => { $("#gpsTitle").textContent = "位置情報を取得できません"; $("#gpsValue").textContent = "端末設定を確認してください"; }, { enableHighAccuracy:true, timeout:8000 });
  }

  $("#mediaInput").addEventListener("change", (event) => { const file = event.target.files[0]; if (!file) return; const picker = $("#mediaPicker"); picker.classList.add("preview"); picker.querySelectorAll("span,b,small").forEach((node) => node.hidden = true); const old = picker.querySelector("img"); if (old) old.remove(); const image = document.createElement("img"); image.src = URL.createObjectURL(file); image.alt = "撮影プレビュー"; picker.prepend(image); });

  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form); const file = $("#mediaInput").files[0]; if (!file) return;
    if (position) { data.set("latitude", position.lat); data.set("longitude", position.lng); }
    const button = form.querySelector(".send"); button.disabled = true; button.textContent = "登録中…";
    try {
      if (!apiBase) throw new Error("demo");
      const response = await fetch(api("/api/incidents"), { method:"POST", body:data }); if (!response.ok) throw new Error(); const result = await response.json(); result.incident.mediaUrl = result.incident.mediaUrl?.startsWith("/") ? `${apiBase}${result.incident.mediaUrl}` : result.incident.mediaUrl; items.unshift(result.incident); showToast("共有サーバーへ登録しました");
    } catch {
      items.unshift({ id:`local-${Date.now()}`, title:data.get("title"), line:data.get("line"), location:data.get("location"), comment:data.get("comment"), reporter:data.get("reporter"), occurredAt:new Date().toISOString(), severity:data.get("severity"), status:"確認中", mediaUrl:URL.createObjectURL(file), mediaType:file.type, ...position });
      showToast(apiBase ? "通信できないため端末内へ一時保存しました" : "デモの一覧へ追加しました");
    } finally { button.disabled = false; button.textContent = "共有サーバーへ登録"; uploadOverlay.hidden = true; form.reset(); populateLines(); render(); }
  });

  $$("[data-capture]").forEach((button) => button.addEventListener("click", () => openCapture(button.dataset.capture)));
  $$("[data-close-upload]").forEach((button) => button.addEventListener("click", () => uploadOverlay.hidden = true));
  $$("[data-close-detail]").forEach((button) => button.addEventListener("click", () => detailOverlay.hidden = true));
  $$("[data-device]").forEach((button) => button.addEventListener("click", () => showToast("端末内の未送信データはありません")));
  $$("[data-map]").forEach((button) => button.addEventListener("click", () => showToast("位置情報は各データの詳細から表示できます")));
  $("#openGallery").addEventListener("click", () => { app.classList.replace("mode-home","mode-gallery"); });
  $("#backButton").addEventListener("click", () => { app.classList.replace("mode-gallery","mode-home"); });
  $("#refreshButton").addEventListener("click", () => { loadItems(); showToast("最新情報を取得しました"); });
  $("#fullscreenButton").addEventListener("click", () => $("#detailPhoto").requestFullscreen?.());
  $("#searchInput").addEventListener("input", render); $("#lineFilter").addEventListener("change", render);
  $$("#severityFilter button").forEach((button) => button.addEventListener("click", () => { selectedSeverity = button.dataset.value; $$("#severityFilter button").forEach((item) => item.classList.toggle("active", item === button)); render(); }));
  detailOverlay.addEventListener("mousedown", (event) => { if (event.target === detailOverlay) detailOverlay.hidden = true; });
  uploadOverlay.addEventListener("mousedown", (event) => { if (event.target === uploadOverlay) uploadOverlay.hidden = true; });
  setInterval(() => $("#clock").textContent = new Intl.DateTimeFormat("ja-JP", { hour:"2-digit", minute:"2-digit" }).format(new Date()), 30000);
  $("#clock").textContent = new Intl.DateTimeFormat("ja-JP", { hour:"2-digit", minute:"2-digit" }).format(new Date());
  populateLines(); render(); loadItems();
})();
