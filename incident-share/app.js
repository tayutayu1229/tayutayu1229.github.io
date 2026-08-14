(() => {
  "use strict";
  const config = window.INCIDENT_SYSTEM_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const state = { items: [], selected: null, mediaUrls: new Map(), mediaRequests: new Map(), galleryObserver: null, detailObserver: null, filter: { date: "", query: "" }, columns: 5, uploadReturnMode: "home", settingsReturnMode: "home", pendingCaptureKind: "", pendingAutoCapture: false, uploadKind: "both", uploadFile: null, uploadPreviewUrl: "" };
  const thumbnailQueue = { active: 0, pending: [], limit: 4 };
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
  function shortTime(value) {
    return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  }
  function syncViewportHeight() {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--viewport-height", `${Math.round(height)}px`);
  }
  function showToast(message, error = false) {
    const toast = $("#toast"); toast.textContent = `${error ? "!" : "✓"}　${message}`; toast.hidden = false;
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, error ? 5200 : 3000);
  }
  function setHeader(mode) {
    const home = mode === "home";
    $("#app").dataset.mode = mode;
    if (isLandscapeLayout() && (mode === "detail" || mode === "fullscreen")) $("#app").classList.add("sidebar-collapsed");
    else if (mode === "home" || mode === "gallery") $("#app").classList.remove("sidebar-collapsed");
    $("#firebase-logout-button").hidden = !home;
    $("#viewBackButton").hidden = home;
    $("#settingsButton").hidden = !home;
    $("#refreshButton").hidden = home || mode === "detail" || mode === "capture" || mode === "settings" || mode === "fullscreen";
    $("#deleteButton").hidden = mode !== "detail";
    $("#screenTitle").textContent = home ? "上野事業本部" : mode === "detail" ? "共有データ詳細" : mode === "fullscreen" ? "全画面表示" : mode === "capture" ? $("#uploadHeading").textContent : mode === "settings" ? "端末設定" : "共有データ閲覧";
    $$(".landscape-sidebar nav button").forEach((button) => button.classList.remove("active"));
    const sidebarButton = mode === "settings" ? $("#landscapeSettingsButton") : mode === "capture" ? null : $("#landscapeGalleryButton");
    if (sidebarButton) sidebarButton.classList.add("active");
  }
  function showHome() {
    if (isLandscapeLayout()) { showGallery(); return; }
    state.selected = null;
    $("#homeScreen").hidden = false; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#settingsScreen").hidden = true;
    setHeader("home");
  }
  function showGallery() {
    state.selected = null;
    $("#homeScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#settingsScreen").hidden = true; $("#galleryScreen").hidden = false;
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
    try { response = await fetch(apiUrl(path), { ...options, headers, signal: controller.signal, mode: "cors", cache: options.cache || "no-store" }); }
    catch (error) { if (error.name === "AbortError") throw new Error("共有サーバーの応答に時間がかかっています。更新を押してください"); throw error; }
    finally { clearTimeout(timeout); }
    if (response.status === 401 && retry) return authorizedFetch(path, options, false);
    if (!response.ok) {
      let detail = ""; try { detail = (await response.json()).error || ""; } catch (_) {}
      const error = new Error(detail || `通信に失敗しました（${response.status}）`); error.status = response.status; throw error;
    }
    return response;
  }
  async function mediaUrl(item, variant = "original") {
    const cacheKey = `${item.id}:${variant}`;
    if (state.mediaUrls.has(cacheKey)) return state.mediaUrls.get(cacheKey);
    if (state.mediaRequests.has(cacheKey)) return state.mediaRequests.get(cacheKey);
    const path = variant === "thumbnail" ? (item.thumbnailUrl || `/api/media/${encodeURIComponent(item.mediaKey)}?variant=thumbnail`) : (item.mediaUrl || `/api/media/${encodeURIComponent(item.mediaKey)}`);
    const request = (async () => {
      const response = await authorizedFetch(path, { cache: "default" });
      const url = URL.createObjectURL(await response.blob()); state.mediaUrls.set(cacheKey, url); return url;
    })();
    state.mediaRequests.set(cacheKey, request);
    try { return await request; } finally { state.mediaRequests.delete(cacheKey); }
  }
  function queueThumbnail(task) {
    return new Promise((resolve, reject) => { thumbnailQueue.pending.push({ task, resolve, reject }); runThumbnailQueue(); });
  }
  function runThumbnailQueue() {
    while (thumbnailQueue.active < thumbnailQueue.limit && thumbnailQueue.pending.length) {
      const entry = thumbnailQueue.pending.shift(); thumbnailQueue.active += 1;
      Promise.resolve().then(entry.task).then(entry.resolve, entry.reject).finally(() => { thumbnailQueue.active -= 1; runThumbnailQueue(); });
    }
  }
  function releaseOriginalsExcept(itemId = "") {
    state.mediaUrls.forEach((url, key) => {
      if (!key.endsWith(":original") || key === `${itemId}:original`) return;
      URL.revokeObjectURL(url); state.mediaUrls.delete(key);
    });
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
    const sidebarWidth = isLandscapeLayout() && !$("#app").classList.contains("sidebar-collapsed") ? 218 : 0;
    const contentWidth = Math.max(320, width - sidebarWidth);
    const columns = contentWidth >= 980 ? 8 : contentWidth >= 700 ? 5 : width < 360 ? 3 : 4;
    const changed = state.columns !== columns; state.columns = columns;
    document.documentElement.style.setProperty("--grid-columns", columns);
    return changed;
  }
  function renderGallery() {
    const items = visibleItems();
    const grid = $("#photoGrid");
    state.galleryObserver?.disconnect(); state.galleryObserver = null;
    grid.innerHTML = items.map((item) => `<button class="photo-card loading" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(longDate(item.occurredAt))}の共有データ"><span class="edit-mark">✎</span><time class="photo-time">${escapeHtml(shortTime(item.occurredAt))}</time>${String(item.mediaType || "").startsWith("video/") ? '<span class="play">▶</span>' : ""}</button>`).join("");
    $("#emptyState").hidden = items.length > 0;
    $("#dateLabel").textContent = state.filter.date ? state.filter.date.replaceAll("-", "年").replace(/年(\d{2})$/, "月$1日") : `共有データ　${items.length}件`;
    const loadCard = async (card) => {
      const item = state.items.find((record) => record.id === card.dataset.id); if (!item) return;
      if (!card.isConnected) return;
      if (item.mediaType?.startsWith("video/")) { card.classList.remove("loading"); card.classList.add("video-card"); return; }
      try {
        const source = await queueThumbnail(() => card.isConnected ? mediaUrl(item, "thumbnail") : Promise.reject(new Error("cancelled")));
        if (!card.isConnected) return;
        const media = document.createElement("img");
        media.src = source; media.alt = `${longDate(item.occurredAt)}に撮影`; media.loading = "lazy"; media.decoding = "async";
        card.prepend(media); card.classList.remove("loading");
      } catch (_) { if (card.isConnected) { card.className = "photo-card error"; card.textContent = "画像取得失敗"; } }
    };
    if ("IntersectionObserver" in window) {
      state.galleryObserver = new IntersectionObserver((entries, observer) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return; observer.unobserve(entry.target); loadCard(entry.target);
      }), { root: grid, rootMargin: "80px 0px" });
    }
    $$(".photo-card", grid).forEach((card) => {
      const item = state.items.find((record) => record.id === card.dataset.id); if (!item) return;
      card.addEventListener("click", () => openDetail(item.id));
      if (state.galleryObserver) state.galleryObserver.observe(card); else loadCard(card);
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
  function detailItems() {
    const filtered = visibleItems();
    return filtered.some((item) => item.id === state.selected?.id) ? filtered : state.items;
  }
  function navigateDetail(offset) {
    if (!state.selected) return;
    const items = detailItems(); const index = items.findIndex((item) => item.id === state.selected.id); const next = items[index + offset];
    if (next) openDetail(next.id);
  }
  function renderDetailStrip() {
    const allItems = detailItems(); const selectedIndex = allItems.findIndex((item) => item.id === state.selected?.id);
    const start = Math.max(0, Math.min(selectedIndex - 15, Math.max(0, allItems.length - 31))); const items = allItems.slice(start, start + 31); const strip = $("#detailThumbnails");
    strip.innerHTML = items.map((item) => `<button class="detail-thumb loading${item.id === state.selected?.id ? " active" : ""}" data-id="${escapeHtml(item.id)}" type="button" aria-label="${escapeHtml(longDate(item.occurredAt))}を表示"><time>${escapeHtml(shortTime(item.occurredAt))}</time>${String(item.mediaType || "").startsWith("video/") ? '<span class="play">▶</span>' : ""}</button>`).join("");
    $("#detailPrevious").disabled = selectedIndex <= 0; $("#detailNext").disabled = selectedIndex < 0 || selectedIndex >= allItems.length - 1;
    state.detailObserver?.disconnect(); state.detailObserver = null;
    const loadThumbnail = async (button) => {
      const item = state.items.find((record) => record.id === button.dataset.id); if (!item) return;
      if (item.mediaType?.startsWith("video/")) { button.classList.remove("loading"); button.classList.add("video-card"); return; }
      try {
        const source = await queueThumbnail(() => button.isConnected ? mediaUrl(item, "thumbnail") : Promise.reject(new Error("cancelled")));
        if (!button.isConnected) return;
        const media = document.createElement("img"); media.src = source; media.alt = ""; media.loading = "lazy"; media.decoding = "async"; button.prepend(media); button.classList.remove("loading");
      } catch (_) { if (button.isConnected) button.classList.add("error"); }
    };
    if ("IntersectionObserver" in window) {
      state.detailObserver = new IntersectionObserver((entries, observer) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return; observer.unobserve(entry.target); loadThumbnail(entry.target);
      }), { root: strip, rootMargin: "0px 160px" });
    }
    $$(".detail-thumb", strip).forEach((button) => {
      const item = state.items.find((record) => record.id === button.dataset.id); if (!item) return;
      button.addEventListener("click", () => openDetail(item.id));
      if (state.detailObserver) state.detailObserver.observe(button); else loadThumbnail(button);
    });
    setTimeout(() => $(".detail-thumb.active", strip)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 0);
  }
  async function openDetail(id) {
    const item = state.items.find((record) => record.id === id); if (!item) return;
    releaseOriginalsExcept(item.id); state.selected = item; $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#settingsScreen").hidden = true; $("#uploadSheet").hidden = true; $("#detailScreen").hidden = false; setHeader("detail");
    $("#detailTime").value = localInputValue(item.occurredAt); $("#detailDevice").value = item.device || ""; $("#detailComment").value = item.comment || "";
    renderDetailStrip();
    const frame = $("#detailMedia"); frame.textContent = "読み込み中…";
    try {
      const source = await mediaUrl(item); frame.innerHTML = item.mediaType?.startsWith("video/") ? `<video src="${escapeHtml(source)}" controls playsinline></video>` : `<img src="${escapeHtml(source)}" alt="共有写真">`;
    } catch (_) { frame.textContent = "画像を表示できません"; }
    $("#detailScreen").scrollTop = 0;
  }
  function closeDetail() {
    showGallery();
  }
  async function openFullscreen() {
    if (!state.selected) return;
    const frame = $("#fullscreenMedia"); frame.textContent = "読み込み中…"; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = false; setHeader("fullscreen");
    try {
      const source = await mediaUrl(state.selected); frame.innerHTML = state.selected.mediaType?.startsWith("video/") ? `<video src="${escapeHtml(source)}" controls playsinline autoplay></video>` : `<img src="${escapeHtml(source)}" alt="共有画像の全画面表示">`;
    } catch (_) { frame.textContent = "画像を表示できません"; }
  }
  function closeFullscreen() { $("#fullscreenScreen").hidden = true; $("#detailScreen").hidden = false; setHeader("detail"); }
  async function deleteSelected() {
    if (!state.selected || !confirm("この共有データを削除しますか？\n削除後は元に戻せません。")) return;
    const button = $("#deleteButton"); button.disabled = true; button.textContent = "削除中";
    try {
      await authorizedFetch(`/api/incidents?id=${encodeURIComponent(state.selected.id)}`, { method: "DELETE" });
      state.mediaUrls.forEach((url, key) => { if (key.startsWith(`${state.selected.id}:`)) { URL.revokeObjectURL(url); state.mediaUrls.delete(key); } });
      state.items = state.items.filter((item) => item.id !== state.selected.id); state.selected = null; showGallery(); showToast("共有データを削除しました");
    } catch (error) { showToast(error.message || "削除できませんでした", true); }
    finally { button.disabled = false; button.textContent = "削除"; }
  }
  function showSettings(warning = false) {
    if (!$("#galleryScreen").hidden) state.settingsReturnMode = "gallery";
    else if (!$("#homeScreen").hidden) state.settingsReturnMode = "home";
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#uploadSheet").hidden = true; $("#settingsScreen").hidden = false;
    $("#deviceNameInput").value = deviceName(); $("#deviceWarning").hidden = !warning; setHeader("settings");
    setTimeout(() => $("#deviceNameInput").focus(), 0);
  }
  function closeSettings() {
    state.pendingCaptureKind = ""; state.pendingAutoCapture = false; $("#settingsScreen").hidden = true;
    if (state.settingsReturnMode === "gallery") showGallery(); else showHome();
  }
  function openUpload(kind = "both", autoCapture = false) {
    if (!deviceName()) { state.pendingCaptureKind = kind; state.pendingAutoCapture = autoCapture; showSettings(true); return; }
    state.uploadKind = kind;
    state.uploadReturnMode = $("#galleryScreen").hidden ? "home" : "gallery";
    const form = $("#uploadForm"); form.reset();
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    state.uploadFile = null; state.uploadPreviewUrl = "";
    $("#mediaPicker").classList.remove("dragover"); $("#mediaPicker").querySelectorAll("img,video").forEach((node) => node.remove()); form.elements.occurredAt.value = localInputValue();
    const input = $("#mediaInput");
    input.accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "image/*,video/*";
    if (kind === "both") input.removeAttribute("capture"); else input.setAttribute("capture", "environment");
    $("#attachmentInput").accept = input.accept;
    $("#uploadHeading").textContent = kind === "image" ? "静止画撮影・共有" : kind === "video" ? "動画撮影・共有" : "共有データ登録";
    $("#mediaPickerTitle").textContent = kind === "image" ? "写真を撮影／選択" : kind === "video" ? "動画を撮影／選択" : "写真・動画を撮影／選択";
    $("#mediaPickerHint").textContent = kind === "image" ? "タップして端末のカメラまたは写真を開きます" : kind === "video" ? "タップして端末のカメラまたは動画を開きます" : "タップして端末のカメラまたは写真・動画を開きます";
    $("#mediaPickerSymbol").textContent = kind === "video" ? "▶" : "▣";
    form.elements.device.value = deviceName();
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#settingsScreen").hidden = true; $("#uploadSheet").hidden = false; setHeader("capture");
    if (autoCapture) input.click();
  }
  function closeUpload() { $("#uploadSheet").hidden = true; if (state.uploadReturnMode === "gallery") showGallery(); else showHome(); }

  function setUploadFile(file) {
    if (!file) return;
    const type = String(file.type || "");
    if (!type.startsWith("image/") && !type.startsWith("video/")) { showToast("写真または動画を選択してください", true); return; }
    const accept = $("#mediaInput").accept;
    if (accept === "image/*" && !type.startsWith("image/")) { showToast("静止画を選択してください", true); return; }
    if (accept === "video/*" && !type.startsWith("video/")) { showToast("動画を選択してください", true); return; }
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    const picker = $("#mediaPicker"); picker.querySelectorAll("img,video").forEach((node) => node.remove());
    state.uploadFile = file; state.uploadPreviewUrl = URL.createObjectURL(file);
    const media = document.createElement(type.startsWith("video/") ? "video" : "img"); media.src = state.uploadPreviewUrl;
    if (media.tagName === "VIDEO") { media.controls = true; media.muted = true; media.playsInline = true; }
    picker.append(media);
  }

  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = state.uploadFile || $("#mediaInput").files[0];
    if (!file) { showToast("写真または動画を選択してください", true); return; }
    data.set("media", file, file.name || "upload");
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
      Object.assign(state.selected, update); renderGallery(); renderDetailStrip(); showToast("撮影情報を保存しました");
    } catch (error) { showToast(error.message || "保存できませんでした", true); }
  });
  $("#mediaInput").addEventListener("change", (event) => setUploadFile(event.target.files[0]));
  $("#attachmentInput").addEventListener("change", (event) => { setUploadFile(event.target.files[0]); event.target.value = ""; });
  $("#fileSelectButton").addEventListener("click", () => $("#attachmentInput").click());
  const mediaPicker = $("#mediaPicker");
  ["dragenter", "dragover"].forEach((type) => mediaPicker.addEventListener(type, (event) => {
    event.preventDefault(); event.stopPropagation(); mediaPicker.classList.add("dragover");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }));
  mediaPicker.addEventListener("dragleave", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!mediaPicker.contains(event.relatedTarget)) mediaPicker.classList.remove("dragover");
  });
  mediaPicker.addEventListener("drop", (event) => {
    event.preventDefault(); event.stopPropagation(); mediaPicker.classList.remove("dragover");
    const file = [...(event.dataTransfer?.files || [])].find((entry) => entry.type.startsWith("image/") || entry.type.startsWith("video/"));
    if (!file) { showToast("写真または動画を選択してください", true); return; }
    setUploadFile(file);
  });
  $("#filterForm").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.filter = { date: String(data.get("date") || ""), query: String(data.get("query") || "") }; $("#filterSheet").hidden = true; renderGallery(); $("#photoGrid").scrollTop = 0; });
  $("#refreshButton").addEventListener("click", () => loadItems(true));
  $("#photoCaptureButton").addEventListener("click", () => openUpload("image", true));
  $("#videoCaptureButton").addEventListener("click", () => openUpload("video", true));
  $("#landscapePhotoButton").addEventListener("click", () => { openUpload("image", true); $("#landscapePhotoButton").classList.add("active"); });
  $("#landscapeVideoButton").addEventListener("click", () => { openUpload("video", true); $("#landscapeVideoButton").classList.add("active"); });
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
  $$('[data-close-filter]').forEach((button) => button.addEventListener("click", () => { $("#filterSheet").hidden = true; }));
  $("#detailBack").addEventListener("click", closeDetail);
  $("#detailMedia").addEventListener("click", (event) => { if (event.target.tagName !== "VIDEO") openFullscreen(); });
  $("#detailMedia").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFullscreen(); } });
  $("#detailPrevious").addEventListener("click", () => navigateDetail(-1));
  $("#detailNext").addEventListener("click", () => navigateDetail(1));
  $("#deleteButton").addEventListener("click", deleteSelected);
  $("#sidebarToggleButton").addEventListener("click", () => {
    $("#app").classList.toggle("sidebar-collapsed"); if (updateGridShape()) renderGallery();
  });
  $("#settingsCancelButton").addEventListener("click", closeSettings);
  $("#deviceSettingsForm").addEventListener("submit", (event) => {
    event.preventDefault(); const name = String(new FormData(event.currentTarget).get("deviceName") || "").trim();
    if (!name) { $("#deviceWarning").hidden = false; $("#deviceNameInput").focus(); return; }
    localStorage.setItem("incident-share-device", name); updateDeviceStatus(); $("#deviceWarning").hidden = true;
    const pending = state.pendingCaptureKind; const autoCapture = state.pendingAutoCapture; state.pendingCaptureKind = ""; state.pendingAutoCapture = false; $("#settingsScreen").hidden = true;
    if (state.settingsReturnMode === "gallery") showGallery(); else showHome();
    if (pending) openUpload(pending, autoCapture); else showToast("端末名を保存しました");
  });
  $("#viewBackButton").addEventListener("click", () => { if (!$("#fullscreenScreen").hidden) closeFullscreen(); else if (!$("#settingsScreen").hidden) closeSettings(); else if (!$("#uploadSheet").hidden) closeUpload(); else if (!$("#detailScreen").hidden) closeDetail(); else showHome(); });
  window.addEventListener("beforeunload", () => { state.mediaUrls.forEach((url) => URL.revokeObjectURL(url)); if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl); });
  let resizeTimer;
  let previousLandscape = isLandscapeLayout();
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
    const landscape = isLandscapeLayout(); syncViewportHeight(); if (updateGridShape()) renderGallery();
    if (landscape !== previousLandscape) { previousLandscape = landscape; if (landscape && !$("#uploadSheet").hidden) return; if (landscape) showGallery(); else if (!$("#detailScreen").hidden) return; else showHome(); }
  }, 120); });
  window.visualViewport?.addEventListener("resize", syncViewportHeight);

  async function start() {
    try {
      syncViewportHeight();
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
