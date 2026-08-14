(() => {
  "use strict";
  const config = window.INCIDENT_SYSTEM_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const state = { items: [], selected: null, mediaUrls: new Map(), filter: { date: "", query: "" }, page: 0, columns: 5, rows: 6, uploadReturnMode: "home", settingsReturnMode: "home", pendingCaptureKind: "" };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function apiUrl(path) { return `${apiBase}${path}`; }
  function escapeHtml(value) { const span = document.createElement("span"); span.textContent = String(value ?? ""); return span.innerHTML; }
  function localInputValue(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  function isoValue(value) { return value ? new Date(value).toISOString() : new Date().toISOString(); }
  function isLandscapeLayout() { return window.innerWidth >= 701 && window.innerWidth > window.innerHeight; }
  function deviceName() { return String(localStorage.getItem("incident-share-device") || "").trim(); }
  function updateDeviceStatus() {
    const name = deviceName(); const status = $("#sidebarDeviceStatus");
    status.textContent = name || "未設定（撮影できません）"; status.classList.toggle("warning", !name);
  }
  function longDate(value) {
    return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }
  function showToast(message, error = false) {
    const toast = $("#toast"); toast.textContent = `${error ? "!" : "✓"}　${message}`; toast.hidden = false;
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, error ? 5200 : 3000);
  }
  function setHeader(mode) {
    const home = mode === "home";
    $("#app").dataset.mode = mode;
    $("#firebase-logout-button").hidden = !home;
    $("#viewBackButton").hidden = home;
    $("#settingsButton").hidden = !home;
    $("#refreshButton").hidden = home || mode === "detail" || mode === "capture" || mode === "settings";
    $("#screenTitle").textContent = home ? "運輸車両部" : mode === "detail" ? "共有データ詳細" : mode === "capture" ? $("#uploadHeading").textContent : mode === "settings" ? "端末設定" : "共有データ閲覧";
    $$(".landscape-sidebar nav button").forEach((button) => button.classList.remove("active"));
    const sidebarButton = mode === "settings" ? $("#landscapeSettingsButton") : mode === "capture" ? null : $("#landscapeGalleryButton");
    if (sidebarButton) sidebarButton.classList.add("active");
  }
  function showHome() {
    if (isLandscapeLayout()) { showGallery(); return; }
    state.selected = null;
    $("#homeScreen").hidden = false; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#settingsScreen").hidden = true;
    setHeader("home");
  }
  function showGallery() {
    state.selected = null;
    $("#homeScreen").hidden = true; $("#detailScreen").hidden = true; $("#settingsScreen").hidden = true; $("#galleryScreen").hidden = false;
    setHeader("gallery"); updateGridShape(); renderGallery();
  }
  async function authorizedFetch(path, options = {}, retry = true) {
    if (!apiBase) throw new Error("共有サーバーが設定されていません");
    const auth = window.TayunetFirebaseDataAuth;
    if (!auth) throw new Error("Firebase認証を初期化できません");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${await auth.getIdToken(!retry)}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try { response = await fetch(apiUrl(path), { ...options, headers, signal: controller.signal, mode: "cors", cache: "no-store" }); }
    catch (error) { if (error.name === "AbortError") throw new Error("共有サーバーの応答に時間がかかっています。更新を押してください"); throw error; }
    finally { clearTimeout(timeout); }
    if (response.status === 401 && retry) return authorizedFetch(path, options, false);
    if (!response.ok) {
      let detail = ""; try { detail = (await response.json()).error || ""; } catch (_) {}
      const error = new Error(detail || `通信に失敗しました（${response.status}）`); error.status = response.status; throw error;
    }
    return response;
  }
  async function mediaUrl(item) {
    if (state.mediaUrls.has(item.id)) return state.mediaUrls.get(item.id);
    const response = await authorizedFetch(item.mediaUrl || `/api/media/${encodeURIComponent(item.mediaKey)}`);
    const url = URL.createObjectURL(await response.blob()); state.mediaUrls.set(item.id, url); return url;
  }
  function visibleItems() {
    const query = state.filter.query.trim().toLowerCase();
    return state.items.filter((item) => {
      const sameDate = !state.filter.date || String(item.occurredAt || "").slice(0, 10) === state.filter.date;
      const matches = !query || `${item.device || ""} ${item.comment || ""}`.toLowerCase().includes(query);
      return sameDate && matches;
    });
  }
  function updateGridShape() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const columns = width >= 1100 ? 8 : width >= 700 ? 5 : width < 360 ? 3 : 4;
    const header = width <= 700 ? 52 : 58;
    const date = width <= 700 ? 30 : 34;
    const footer = 70;
    const gap = width >= 1100 ? 14 : width <= 700 ? 6 : 12;
    const padX = width >= 1100 ? 26 : width <= 700 ? 7 : 18;
    const padY = width >= 1100 ? 16 : width <= 700 ? 6 : 8;
    const cardWidth = (width - padX * 2 - gap * (columns - 1)) / columns;
    const availableHeight = Math.max(180, height - header - date - footer - padY * 2);
    const rows = Math.max(2, Math.floor((availableHeight + gap) / (Math.max(62, cardWidth / 1.05) + gap)));
    state.columns = columns; state.rows = rows;
    document.documentElement.style.setProperty("--grid-columns", columns);
    document.documentElement.style.setProperty("--grid-rows", rows);
  }
  function pageInfo(items = visibleItems()) {
    const pageSize = Math.max(1, state.columns * state.rows);
    const pages = Math.max(1, Math.ceil(items.length / pageSize));
    state.page = Math.min(state.page, pages - 1);
    return { pageSize, pages, start: state.page * pageSize };
  }
  function renderGallery() {
    const allItems = visibleItems();
    const { pageSize, pages, start } = pageInfo(allItems);
    const items = allItems.slice(start, start + pageSize);
    const grid = $("#photoGrid");
    grid.innerHTML = items.map((item) => `<button class="photo-card loading" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(longDate(item.occurredAt))}の共有データ"><span class="edit-mark">✎</span>${String(item.mediaType || "").startsWith("video/") ? '<span class="play">▶</span>' : ""}</button>`).join("");
    $("#emptyState").hidden = allItems.length > 0;
    $("#dateLabel").textContent = state.filter.date ? state.filter.date.replaceAll("-", "年").replace(/年(\d{2})$/, "月$1日") : `共有データ　${allItems.length}件`;
    $("#pageNav").hidden = pages <= 1;
    $("#pageLabel").textContent = `${state.page + 1} / ${pages}`;
    $("#previousPage").disabled = state.page === 0;
    $("#nextPage").disabled = state.page >= pages - 1;
    $$(".photo-card", grid).forEach(async (card) => {
      const item = state.items.find((record) => record.id === card.dataset.id); if (!item) return;
      try {
        const source = await mediaUrl(item); const media = document.createElement(item.mediaType?.startsWith("video/") ? "video" : "img");
        media.src = source; media.alt = `${longDate(item.occurredAt)}に撮影`; media.muted = true; media.preload = "metadata";
        card.prepend(media); card.classList.remove("loading");
      } catch (_) { card.className = "photo-card error"; card.textContent = "画像取得失敗"; }
      card.addEventListener("click", () => openDetail(item.id));
    });
  }
  async function loadItems(showNotice = false) {
    $("#serverStatus").textContent = "取得中";
    try {
      const response = await authorizedFetch("/api/incidents"); const data = await response.json();
      state.items = Array.isArray(data.incidents) ? data.incidents : [];
      $("#serverStatus").textContent = "共有サーバー接続中"; renderGallery();
      if (showNotice) showToast("最新情報へ更新しました");
    } catch (error) {
      $("#serverStatus").textContent = "サーバー未接続"; renderGallery(); showToast(error.message || "共有サーバーに接続できません", true);
    }
  }
  async function openDetail(id) {
    const item = state.items.find((record) => record.id === id); if (!item) return;
    state.selected = item; $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = false; setHeader("detail");
    $("#detailTime").value = localInputValue(item.occurredAt); $("#detailDevice").value = item.device || ""; $("#detailComment").value = item.comment || "";
    const frame = $("#detailMedia"); frame.textContent = "読み込み中…";
    try {
      const source = await mediaUrl(item); frame.innerHTML = item.mediaType?.startsWith("video/") ? `<video src="${escapeHtml(source)}" controls playsinline></video>` : `<img src="${escapeHtml(source)}" alt="共有写真">`;
    } catch (_) { frame.textContent = "画像を表示できません"; }
    scrollTo({ top: 0, behavior: "instant" });
  }
  function closeDetail() {
    showGallery();
  }
  function showSettings(warning = false) {
    if (!$("#galleryScreen").hidden) state.settingsReturnMode = "gallery";
    else if (!$("#homeScreen").hidden) state.settingsReturnMode = "home";
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#uploadSheet").hidden = true; $("#settingsScreen").hidden = false;
    $("#deviceNameInput").value = deviceName(); $("#deviceWarning").hidden = !warning; setHeader("settings");
    setTimeout(() => $("#deviceNameInput").focus(), 0);
  }
  function closeSettings() {
    state.pendingCaptureKind = ""; $("#settingsScreen").hidden = true;
    if (state.settingsReturnMode === "gallery") showGallery(); else showHome();
  }
  function openUpload(kind = "both") {
    if (!deviceName()) { state.pendingCaptureKind = kind; showSettings(true); return; }
    state.uploadReturnMode = $("#galleryScreen").hidden ? "home" : "gallery";
    const form = $("#uploadForm"); form.reset(); $("#mediaPicker").querySelectorAll("img,video").forEach((node) => node.remove()); form.elements.occurredAt.value = localInputValue();
    const input = $("#mediaInput");
    input.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "image/*,video/*";
    $("#uploadHeading").textContent = kind === "image" ? "静止画撮影・共有" : kind === "video" ? "動画撮影・共有" : "共有データ登録";
    form.elements.device.value = deviceName();
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#settingsScreen").hidden = true; $("#uploadSheet").hidden = false; setHeader("capture");
  }
  function closeUpload() { $("#uploadSheet").hidden = true; if (state.uploadReturnMode === "gallery") showGallery(); else showHome(); }

  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = $("#mediaInput").files[0]; if (!file) return;
    data.set("occurredAt", isoValue(data.get("occurredAt")));
    const submit = form.querySelector(".submit-link"); submit.disabled = true; submit.textContent = "登録中";
    try {
      const response = await authorizedFetch("/api/incidents", { method: "POST", body: data }); const result = await response.json();
      state.items.unshift(result.incident); $("#uploadSheet").hidden = true; showGallery(); showToast("共有サーバーへ登録しました");
    } catch (error) { showToast(error.message || "登録できませんでした", true); }
    finally { submit.disabled = false; submit.textContent = "登録"; }
  });
  $("#detailForm").addEventListener("submit", async (event) => {
    event.preventDefault(); if (!state.selected) return; const data = new FormData(event.currentTarget);
    const update = { id: state.selected.id, occurredAt: isoValue(data.get("occurredAt")), device: String(data.get("device") || "").trim(), comment: String(data.get("comment") || "").trim() };
    try {
      await authorizedFetch("/api/incidents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update) });
      Object.assign(state.selected, update); renderGallery(); showToast("撮影情報を保存しました");
    } catch (error) { showToast(error.message || "保存できませんでした", true); }
  });
  $("#mediaInput").addEventListener("change", (event) => {
    const file = event.target.files[0]; if (!file) return; const picker = $("#mediaPicker"); picker.querySelectorAll("img,video").forEach((node) => node.remove());
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "img"); media.src = URL.createObjectURL(file); if (media.tagName === "VIDEO") { media.controls = true; media.muted = true; } picker.append(media);
  });
  $("#filterForm").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.filter = { date: String(data.get("date") || ""), query: String(data.get("query") || "") }; state.page = 0; $("#filterSheet").hidden = true; renderGallery(); });
  $("#refreshButton").addEventListener("click", () => loadItems(true));
  $("#photoCaptureButton").addEventListener("click", () => openUpload("image"));
  $("#videoCaptureButton").addEventListener("click", () => openUpload("video"));
  $("#landscapePhotoButton").addEventListener("click", () => { openUpload("image"); $("#landscapePhotoButton").classList.add("active"); });
  $("#landscapeVideoButton").addEventListener("click", () => { openUpload("video"); $("#landscapeVideoButton").classList.add("active"); });
  $("#landscapeGalleryButton").addEventListener("click", showGallery);
  $("#landscapeDeviceButton").addEventListener("click", () => showToast("端末内の未送信データはありません"));
  $("#landscapeSettingsButton").addEventListener("click", () => { state.pendingCaptureKind = ""; showSettings(false); });
  $("#landscapeTopButton").addEventListener("click", () => {
  location.href = "/toppage.html";
});
  $("#openGalleryButton").addEventListener("click", showGallery);
  $("#deviceDataButton").addEventListener("click", () => showToast("端末内の未送信データはありません"));
  $("#settingsButton").addEventListener("click", () => { state.pendingCaptureKind = ""; showSettings(false); });
  $("#captureButton").addEventListener("click", () => openUpload("both")); $("#filterButton").addEventListener("click", () => { $("#filterSheet").hidden = false; });
  $("#previousPage").addEventListener("click", () => { if (state.page > 0) { state.page -= 1; renderGallery(); } });
  $("#nextPage").addEventListener("click", () => { const { pages } = pageInfo(); if (state.page < pages - 1) { state.page += 1; renderGallery(); } });
  $$('[data-close-filter]').forEach((button) => button.addEventListener("click", () => { $("#filterSheet").hidden = true; }));
  $("#detailBack").addEventListener("click", closeDetail);
  $("#settingsCancelButton").addEventListener("click", closeSettings);
  $("#deviceSettingsForm").addEventListener("submit", (event) => {
    event.preventDefault(); const name = String(new FormData(event.currentTarget).get("deviceName") || "").trim();
    if (!name) { $("#deviceWarning").hidden = false; $("#deviceNameInput").focus(); return; }
    localStorage.setItem("incident-share-device", name); updateDeviceStatus(); $("#deviceWarning").hidden = true;
    const pending = state.pendingCaptureKind; state.pendingCaptureKind = ""; $("#settingsScreen").hidden = true;
    if (state.settingsReturnMode === "gallery") showGallery(); else showHome();
    if (pending) openUpload(pending); else showToast("端末名を保存しました");
  });
  $("#viewBackButton").addEventListener("click", () => { if (!$("#settingsScreen").hidden) closeSettings(); else if (!$("#uploadSheet").hidden) closeUpload(); else if (!$("#detailScreen").hidden) closeDetail(); else showHome(); });
  window.addEventListener("beforeunload", () => state.mediaUrls.forEach((url) => URL.revokeObjectURL(url)));
  let touchStartX = 0;
  $("#photoGrid").addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0]?.clientX || 0; }, { passive: true });
  $("#photoGrid").addEventListener("touchend", (event) => {
    const distance = (event.changedTouches[0]?.clientX || 0) - touchStartX; const { pages } = pageInfo();
    if (distance < -55 && state.page < pages - 1) { state.page += 1; renderGallery(); }
    if (distance > 55 && state.page > 0) { state.page -= 1; renderGallery(); }
  }, { passive: true });
  let resizeTimer;
  let previousLandscape = isLandscapeLayout();
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
    const landscape = isLandscapeLayout(); updateGridShape(); renderGallery();
    if (landscape !== previousLandscape) { previousLandscape = landscape; if (landscape && !$("#uploadSheet").hidden) return; if (landscape) showGallery(); else if (!$("#detailScreen").hidden) return; else showHome(); }
  }, 120); });

  async function start() {
    try {
      $("#authCover p").textContent = "Firebase認証を確認しています";
      const result = window.TayunetAuthReady ? await Promise.race([window.TayunetAuthReady, new Promise((_, reject) => setTimeout(() => reject(new Error("認証確認がタイムアウトしました")), 15000))]) : null;
      if (result && result.ok !== true) return;
      await window.TayunetFirebaseDataAuth.currentUser();
      updateGridShape(); updateDeviceStatus(); $("#authCover").hidden = true; $("#app").hidden = false; if (isLandscapeLayout()) showGallery(); else showHome(); await loadItems();
      if (!deviceName()) showToast("端末名が未設定です。設定画面で登録してください", true);
    } catch (error) { $("#authCover p").textContent = error.message || "ログイン画面へ移動しています"; }
  }
  start();
})();
