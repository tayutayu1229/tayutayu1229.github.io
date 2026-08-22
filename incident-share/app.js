(() => {
  "use strict";
  const config = window.INCIDENT_SYSTEM_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const state = { items: [], selected: null, mediaUrls: new Map(), mediaRequests: new Map(), galleryObserver: null, detailObserver: null, filter: { date: "", query: "" }, columns: 5, uploadReturnMode: "home", settingsReturnMode: "home", deviceReturnMode: "home", pendingCaptureKind: "", pendingAutoCapture: false, uploadKind: "both", uploadFile: null, uploadPreviewUrl: "", preparedFilePromise: null, metadataPromise: null, fileGeneration: 0, captureLocation: null, deviceDataUrls: [] };
  const thumbnailQueue = { active: 0, pending: [], limit: 4 };
  const fullscreenZoom = { scale: 1, x: 0, y: 0, startScale: 1, startDistance: 0, startX: 0, startY: 0, baseX: 0, baseY: 0, moved: false, pinching: false, lastTap: 0 };
  let viewportSyncTimers = [];
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
  function hasLocation(item) { return Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude); }
  function updateCaptureLocationStatus(mode, detail = "") {
    const panel = $("#captureLocationStatus"); if (!panel) return;
    panel.dataset.status = mode;
    $("span", panel).textContent = detail || (mode === "ready" ? "ファイル内の撮影場所を読み取りました" : mode === "loading" ? "ファイル内の撮影場所を確認しています" : mode === "none" ? "このファイルに撮影場所は記録されていません" : mode === "idle" ? "写真・動画を選ぶと、ファイル内の撮影場所を確認します" : "撮影場所を読み取れませんでした");
  }
  function validEmbeddedLocation(value) {
    const latitude = Number(value?.latitude); const longitude = Number(value?.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { latitude, longitude, locationAccuracy: null } : null;
  }
  async function quickTimeLocation(file) {
    if (!String(file.type || "").startsWith("video/")) return null;
    const chunkSize = Math.min(file.size, 4 * 1024 * 1024); const chunks = [file.slice(0, chunkSize)];
    if (file.size > chunkSize) chunks.push(file.slice(Math.max(0, file.size - chunkSize)));
    const decoder = new TextDecoder("latin1");
    for (const chunk of chunks) {
      const text = decoder.decode(await chunk.arrayBuffer());
      const tagged = text.match(/(?:location\.ISO6709|©xyz)[\s\S]{0,160}?([+-]\d{2}(?:\.\d+)?)([+-]\d{3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?/i);
      if (tagged) return validEmbeddedLocation({ latitude: tagged[1], longitude: tagged[2] });
    }
    return null;
  }
  async function embeddedLocation(file) {
    try {
      if (String(file.type || "").startsWith("image/") && window.exifr?.gps) return validEmbeddedLocation(await window.exifr.gps(file));
      return await quickTimeLocation(file);
    } catch (_) { return null; }
  }
  function isFreshCapture(file) {
    const modified = Number(file?.lastModified);
    return !Number.isFinite(modified) || modified <= 0 || Math.abs(Date.now() - modified) <= 10 * 60 * 1000;
  }
  function currentDeviceLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = validEmbeddedLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          resolve(location ? { ...location, locationAccuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null } : null);
        },
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 7000, maximumAge: 30000 },
      );
    });
  }
  function guessedMediaType(file) {
    if (file.type) return file.type;
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    const types = { jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", heic: "image/heic", heif: "image/heif", avif: "image/avif", png: "image/png", tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", gif: "image/gif", mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm" };
    return types[extension] || "";
  }
  function normalizeFile(file) {
    const type = guessedMediaType(file); if (!type || file.type === type) return file;
    try { return new File([file], file.name || "upload", { type, lastModified: file.lastModified || Date.now() }); } catch (_) { return file; }
  }
  async function preparedImage(file) {
    if (!String(file.type || "").startsWith("image/") || file.size < 2.5 * 1024 * 1024 || !window.createImageBitmap) return file;
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { try { bitmap = await createImageBitmap(file); } catch (_) { return file; } }
    const maximum = 2560; const scale = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 5 * 1024 * 1024) { bitmap.close(); return file; }
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .84));
    if (!blob || blob.size >= file.size) return file;
    const baseName = String(file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  }
  function syncViewportHeight() {
    const height = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty("--viewport-height", `${Math.round(height)}px`);
  }
  function scheduleViewportSync() {
    viewportSyncTimers.forEach(clearTimeout); viewportSyncTimers = [];
    const update = () => { syncViewportHeight(); if (!$("#fullscreenScreen")?.hidden) requestAnimationFrame(applyFullscreenZoom); };
    update(); [120, 360, 800].forEach((delay) => viewportSyncTimers.push(setTimeout(update, delay)));
  }
  function showToast(message, error = false) {
    const toast = $("#toast"); toast.textContent = `${error ? "!" : "✓"}　${message}`; toast.hidden = false;
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, error ? 5200 : 3000);
  }
  function setHeader(mode) {
    const home = mode === "home";
    $("#app").dataset.mode = mode;
    if (isLandscapeLayout() && (mode === "detail" || mode === "fullscreen" || mode === "location")) $("#app").classList.add("sidebar-collapsed");
    else if (mode === "home" || mode === "gallery") $("#app").classList.remove("sidebar-collapsed");
    $("#firebase-logout-button").hidden = !home;
    $("#viewBackButton").hidden = home;
    $("#settingsButton").hidden = !home;
    $("#refreshButton").hidden = home || mode === "detail" || mode === "capture" || mode === "settings" || mode === "fullscreen" || mode === "location" || mode === "device";
    $("#deleteButton").hidden = mode !== "detail";
    $("#screenTitle").textContent = home ? "上野事業本部" : mode === "detail" ? "共有データ詳細" : mode === "fullscreen" ? "全画面表示" : mode === "location" ? "撮影場所" : mode === "capture" ? $("#uploadHeading").textContent : mode === "settings" ? "端末設定" : mode === "device" ? "端末保存データ" : "共有データ閲覧";
    $$(".landscape-sidebar nav button").forEach((button) => button.classList.remove("active"));
    const sidebarButton = mode === "settings" ? $("#landscapeSettingsButton") : mode === "device" ? $("#landscapeDeviceButton") : mode === "capture" ? null : $("#landscapeGalleryButton");
    if (sidebarButton) sidebarButton.classList.add("active");
  }
  function showHome() {
    if (isLandscapeLayout()) { showGallery(); return; }
    state.selected = null;
    $("#homeScreen").hidden = false; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#locationScreen").hidden = true; $("#deviceScreen").hidden = true; $("#settingsScreen").hidden = true;
    setHeader("home");
  }
  function showGallery() {
    state.selected = null;
    $("#homeScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#locationScreen").hidden = true; $("#deviceScreen").hidden = true; $("#settingsScreen").hidden = true; $("#galleryScreen").hidden = false;
    setHeader("gallery"); updateGridShape(); renderGallery();
  }
  async function authorizedFetch(path, options = {}, retry = true) {
    if (!apiBase) throw new Error("共有サーバーが設定されていません");
    const auth = window.TayunetFirebaseDataAuth;
    if (!auth) throw new Error("Firebase認証を初期化できません");
    const headers = new Headers(options.headers || {}); const timeoutMs = Number(options.timeoutMs || 12000); const fetchOptions = { ...options }; delete fetchOptions.timeoutMs;
    headers.set("Authorization", `Bearer ${await auth.getIdToken(!retry)}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try { response = await fetch(apiUrl(path), { ...fetchOptions, headers, signal: controller.signal, mode: "cors", cache: options.cache || "no-store" }); }
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
      try {
        const source = await queueThumbnail(() => card.isConnected ? mediaUrl(item, "thumbnail") : Promise.reject(new Error("cancelled")));
        if (!card.isConnected) return;
        const media = document.createElement("img");
        media.src = source; media.alt = `${longDate(item.occurredAt)}に撮影`; media.loading = "lazy"; media.decoding = "async";
        card.prepend(media); card.classList.remove("loading");
      } catch (_) {
        if (!card.isConnected) return;
        if (item.mediaType?.startsWith("video/")) { card.classList.remove("loading"); card.classList.add("video-card"); }
        else { card.className = "photo-card error"; card.textContent = "画像取得失敗"; }
      }
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
      try {
        const source = await queueThumbnail(() => button.isConnected ? mediaUrl(item, "thumbnail") : Promise.reject(new Error("cancelled")));
        if (!button.isConnected) return;
        const media = document.createElement("img"); media.src = source; media.alt = ""; media.loading = "lazy"; media.decoding = "async"; button.prepend(media); button.classList.remove("loading");
      } catch (_) {
        if (!button.isConnected) return;
        if (item.mediaType?.startsWith("video/")) { button.classList.remove("loading"); button.classList.add("video-card"); }
        else button.classList.add("error");
      }
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
    releaseOriginalsExcept(item.id); state.selected = item; $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#locationScreen").hidden = true; $("#deviceScreen").hidden = true; $("#settingsScreen").hidden = true; $("#uploadSheet").hidden = true; $("#detailScreen").hidden = false; setHeader("detail");
    $("#detailTime").value = localInputValue(item.occurredAt); $("#detailDevice").value = item.device || ""; $("#detailComment").value = item.comment || "";
    const locationButton = $("#locationButton"); locationButton.disabled = !hasLocation(item); locationButton.querySelector("span").textContent = hasLocation(item) ? "撮影場所" : "位置情報なし";
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
    const frame = $("#fullscreenMedia"); resetFullscreenZoom(); frame.classList.toggle("zoomable", !state.selected.mediaType?.startsWith("video/")); frame.textContent = "読み込み中…"; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = false; setHeader("fullscreen");
    try {
      const source = await mediaUrl(state.selected); frame.innerHTML = state.selected.mediaType?.startsWith("video/") ? `<video src="${escapeHtml(source)}" controls playsinline autoplay></video>` : `<img src="${escapeHtml(source)}" alt="共有画像の全画面表示">`;
    } catch (_) { frame.textContent = "画像を表示できません"; }
  }
  function applyFullscreenZoom() {
    const frame = $("#fullscreenMedia"); const image = $("img", frame); if (!image) return;
    const maxX = frame.clientWidth * (fullscreenZoom.scale - 1) / 2; const maxY = frame.clientHeight * (fullscreenZoom.scale - 1) / 2;
    fullscreenZoom.x = Math.max(-maxX, Math.min(maxX, fullscreenZoom.x)); fullscreenZoom.y = Math.max(-maxY, Math.min(maxY, fullscreenZoom.y));
    image.style.transform = `translate3d(${fullscreenZoom.x}px, ${fullscreenZoom.y}px, 0) scale(${fullscreenZoom.scale})`;
    frame.classList.toggle("is-zoomed", fullscreenZoom.scale > 1.01);
  }
  function resetFullscreenZoom() {
    Object.assign(fullscreenZoom, { scale: 1, x: 0, y: 0, startScale: 1, startDistance: 0, moved: false, pinching: false });
    const frame = $("#fullscreenMedia"); frame?.classList.remove("is-zoomed"); const image = frame ? $("img", frame) : null; if (image) image.style.transform = "";
  }
  function toggleFullscreenZoom() {
    fullscreenZoom.scale = fullscreenZoom.scale > 1.01 ? 1 : 2.5; fullscreenZoom.x = 0; fullscreenZoom.y = 0; applyFullscreenZoom();
  }
  function touchDistance(touches) { return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); }
  function closeFullscreen() { resetFullscreenZoom(); $("#fullscreenScreen").hidden = true; $("#detailScreen").hidden = false; setHeader("detail"); }
  function openLocation() {
    if (!hasLocation(state.selected)) { showToast("この共有データには撮影場所がありません", true); return; }
    const latitude = state.selected.latitude; const longitude = state.selected.longitude; const spread = .004;
    const bbox = [longitude - spread, latitude - spread, longitude + spread, latitude + spread].join(",");
    const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
    $("#locationCoordinates").textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    $("#locationAccuracy").textContent = Number.isFinite(state.selected.locationAccuracy) ? `位置精度：約${Math.round(state.selected.locationAccuracy)}m` : "GPSで取得した撮影場所";
    $("#locationExternalLink").href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=18/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`;
    $("#mapLoading").hidden = false; $("#locationMap").src = mapUrl;
    $("#detailScreen").hidden = true; $("#locationScreen").hidden = false; setHeader("location");
  }
  function closeLocation() { $("#locationMap").src = "about:blank"; $("#locationScreen").hidden = true; $("#detailScreen").hidden = false; setHeader("detail"); }
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
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#locationScreen").hidden = true; $("#deviceScreen").hidden = true; $("#uploadSheet").hidden = true; $("#settingsScreen").hidden = false;
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
    state.uploadFile = null; state.uploadPreviewUrl = ""; state.preparedFilePromise = null; state.metadataPromise = null; state.captureLocation = null; state.fileGeneration += 1;
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
    updateCaptureLocationStatus("idle");
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#locationScreen").hidden = true; $("#deviceScreen").hidden = true; $("#settingsScreen").hidden = true; $("#uploadSheet").hidden = false; setHeader("capture");
    if (autoCapture) input.click();
  }
  function closeUpload() { $("#uploadSheet").hidden = true; if (state.uploadReturnMode === "gallery") showGallery(); else showHome(); }

  function setUploadFile(sourceFile, { allowCurrentLocation = false } = {}) {
    const file = normalizeFile(sourceFile);
    if (!file) return;
    const type = guessedMediaType(file);
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
    const generation = ++state.fileGeneration; state.captureLocation = null; updateCaptureLocationStatus("loading");
    state.metadataPromise = (async () => {
      const embedded = await embeddedLocation(file);
      if (generation !== state.fileGeneration) return null;
      if (embedded) { state.captureLocation = embedded; updateCaptureLocationStatus("ready", "ファイル内の撮影場所を読み取りました"); return embedded; }
      if (!allowCurrentLocation || !isFreshCapture(file)) { updateCaptureLocationStatus("none", "このファイルに撮影場所は記録されていません"); return null; }
      updateCaptureLocationStatus("loading", "撮影直後のため、現在の撮影場所を確認しています");
      const current = await currentDeviceLocation();
      if (generation !== state.fileGeneration) return null;
      state.captureLocation = current;
      updateCaptureLocationStatus(current ? "ready" : "none", current ? "現在の撮影場所を登録します" : "撮影場所を取得できないため、位置情報なしで登録します");
      return current;
    })().catch(() => { if (generation === state.fileGeneration) updateCaptureLocationStatus("error"); return null; });
    state.preparedFilePromise = preparedImage(file).catch(() => file);
  }

  function newClientId() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function formDataForRecord(record) {
    const data = new FormData();
    data.set("media", record.file, record.fileName || "upload"); data.set("occurredAt", record.occurredAt); data.set("device", record.device); data.set("comment", record.comment || ""); data.set("clientId", record.clientId);
    if (hasLocation(record)) { data.set("latitude", String(record.latitude)); data.set("longitude", String(record.longitude)); if (Number.isFinite(record.locationAccuracy)) data.set("locationAccuracy", String(record.locationAccuracy)); }
    return data;
  }
  async function recordFromUploadForm(form) {
    const rawFile = state.uploadFile || $("#mediaInput").files[0]; if (!rawFile) return null;
    const values = new FormData(form); const file = await (state.preparedFilePromise || Promise.resolve(rawFile)); await (state.metadataPromise || Promise.resolve());
    return { id: newClientId(), clientId: newClientId(), file, fileName: file.name || rawFile.name || "upload", mediaType: file.type || rawFile.type, occurredAt: isoValue(values.get("occurredAt")), device: String(values.get("device") || "").trim(), comment: String(values.get("comment") || "").trim(), ...(state.captureLocation || {}), attempts: 0, createdAt: new Date().toISOString(), lastError: "" };
  }
  async function uploadRecord(record, onAttempt) {
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      record.attempts = attempt; onAttempt?.(attempt);
      try {
        const timeoutMs = String(record.mediaType || "").startsWith("video/") ? 90000 : 45000;
        const response = await authorizedFetch("/api/incidents", { method: "POST", body: formDataForRecord(record), timeoutMs });
        return (await response.json()).incident;
      } catch (error) {
        lastError = error; record.lastError = error.message || "送信できませんでした";
        if (Number(error.status) >= 400 && Number(error.status) < 500 && ![408, 425, 429].includes(Number(error.status))) { record.attempts = 5; break; }
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
      }
    }
    throw lastError || new Error("5回送信しましたが登録できませんでした");
  }
  async function updateUnsentCount() {
    try {
      const count = await window.IncidentOfflineStore.count();
      [["#homeUnsentCount", count], ["#sidebarUnsentCount", count]].forEach(([selector, value]) => { const badge = $(selector); badge.textContent = String(value); badge.hidden = value === 0; });
      return count;
    } catch (_) { return 0; }
  }
  async function saveUnsentRecord(record) {
    await window.IncidentOfflineStore.put(record); await updateUnsentCount();
  }
  function clearDeviceDataUrls() { state.deviceDataUrls.forEach((url) => URL.revokeObjectURL(url)); state.deviceDataUrls = []; }
  function deviceText(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; element.textContent = text; return element; }
  async function resendDeviceRecord(record, button) {
    if (button) { button.disabled = true; button.textContent = "送信中"; }
    try {
      const incident = await uploadRecord(record, (attempt) => { if (button) button.textContent = attempt === 1 ? "送信中" : `再送 ${attempt}/5`; });
      await window.IncidentOfflineStore.remove(record.id); if (!state.items.some((item) => item.id === incident.id)) state.items.unshift(incident);
      await updateUnsentCount(); showToast("未送信データを共有サーバーへ登録しました"); return true;
    } catch (error) {
      record.lastError = error.message || "再送できませんでした"; await window.IncidentOfflineStore.put(record).catch(() => {}); showToast("再送できませんでした。端末内に保存したままです", true); return false;
    } finally { if (button) { button.disabled = false; button.textContent = "再送"; } }
  }
  async function renderDeviceData() {
    const list = $("#deviceDataList"); clearDeviceDataUrls(); list.replaceChildren();
    let records = [];
    try { records = await window.IncidentOfflineStore.list(); } catch (error) { showToast(error.message || "端末保存データを開けません", true); }
    $("#deviceDataCount").textContent = `${records.length}件`; $("#deviceDataEmpty").hidden = records.length !== 0; $("#retryAllDeviceData").disabled = records.length === 0;
    records.forEach((record) => {
      const card = document.createElement("article"); card.className = "device-data-card";
      const preview = document.createElement("div"); preview.className = "device-data-preview";
      if (String(record.mediaType || "").startsWith("image/")) {
        const url = URL.createObjectURL(record.file); state.deviceDataUrls.push(url); const image = document.createElement("img"); image.src = url; image.alt = "未送信写真"; preview.append(image);
      } else { preview.append(deviceText("span", "device-video-mark", "▶"), deviceText("small", "", "動画")); }
      const information = document.createElement("div"); information.className = "device-data-info";
      information.append(deviceText("time", "", longDate(record.occurredAt)), deviceText("b", "", record.device || "端末名なし"), deviceText("p", "", record.comment || "コメントなし"));
      const location = deviceText("small", "device-location", hasLocation(record) ? "撮影場所あり" : "位置情報なし"); information.append(location);
      if (record.lastError) information.append(deviceText("small", "device-last-error", `前回：${record.lastError}`));
      const actions = document.createElement("div"); actions.className = "device-data-actions";
      const retry = deviceText("button", "primary", "再送"); retry.type = "button"; retry.addEventListener("click", async () => { if (await resendDeviceRecord(record, retry)) renderDeviceData(); });
      const remove = deviceText("button", "", "削除"); remove.type = "button"; remove.addEventListener("click", async () => { if (!confirm("この未送信データを端末から削除しますか？")) return; await window.IncidentOfflineStore.remove(record.id); await updateUnsentCount(); renderDeviceData(); });
      actions.append(retry, remove); card.append(preview, information, actions); list.append(card);
    });
  }
  async function showDeviceData() {
    state.deviceReturnMode = !$("#galleryScreen").hidden ? "gallery" : "home";
    $("#homeScreen").hidden = true; $("#galleryScreen").hidden = true; $("#detailScreen").hidden = true; $("#fullscreenScreen").hidden = true; $("#locationScreen").hidden = true; $("#settingsScreen").hidden = true; $("#uploadSheet").hidden = true; $("#deviceScreen").hidden = false; setHeader("device"); await renderDeviceData();
  }
  function closeDeviceData() { clearDeviceDataUrls(); $("#deviceScreen").hidden = true; if (state.deviceReturnMode === "gallery") showGallery(); else showHome(); }

  $("#uploadForm").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const file = state.uploadFile || $("#mediaInput").files[0];
    if (!file) { showToast("写真または動画を選択してください", true); return; }
    const submit = form.querySelector(".submit-link"); submit.disabled = true; submit.textContent = "登録中";
    let record;
    try {
      submit.textContent = "画像準備中"; record = await recordFromUploadForm(form); if (!record) throw new Error("写真または動画を選択してください");
      const incident = await uploadRecord(record, (attempt) => { submit.textContent = attempt === 1 ? "登録中" : `再送中 ${attempt}/5`; });
      state.items.unshift(incident); $("#uploadSheet").hidden = true; showGallery(); showToast("共有サーバーへ登録しました");
    } catch (error) {
      if (!record) { showToast(error.message || "登録できませんでした", true); }
      else {
        try { await saveUnsentRecord(record); $("#uploadSheet").hidden = true; showGallery(); showToast("5回送信できなかったため、端末保存データへ保存しました", true); }
        catch (_) { showToast("送信と端末保存の両方に失敗しました。画面を閉じずにもう一度お試しください", true); }
      }
    }
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
  $("#mediaInput").addEventListener("change", (event) => setUploadFile(event.target.files[0], { allowCurrentLocation: true }));
  $("#attachmentInput").addEventListener("change", (event) => { setUploadFile(event.target.files[0], { allowCurrentLocation: false }); event.target.value = ""; });
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
    setUploadFile(file, { allowCurrentLocation: false });
  });
  $("#filterForm").addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); state.filter = { date: String(data.get("date") || ""), query: String(data.get("query") || "") }; $("#filterSheet").hidden = true; renderGallery(); $("#photoGrid").scrollTop = 0; });
  $("#refreshButton").addEventListener("click", () => loadItems(true));
  $("#photoCaptureButton").addEventListener("click", () => openUpload("image", true));
  $("#videoCaptureButton").addEventListener("click", () => openUpload("video", true));
  $("#landscapePhotoButton").addEventListener("click", () => { openUpload("image", true); $("#landscapePhotoButton").classList.add("active"); });
  $("#landscapeVideoButton").addEventListener("click", () => { openUpload("video", true); $("#landscapeVideoButton").classList.add("active"); });
  $("#landscapeGalleryButton").addEventListener("click", showGallery);
  $("#landscapeDeviceButton").addEventListener("click", showDeviceData);
  $("#landscapeSettingsButton").addEventListener("click", () => { state.pendingCaptureKind = ""; showSettings(false); });
  $("#landscapeTopButton").addEventListener("click", () => {
    location.href = "/toppage.html";
  });
  $("#openGalleryButton").addEventListener("click", showGallery);
  $("#deviceDataButton").addEventListener("click", showDeviceData);
  $("#settingsButton").addEventListener("click", () => { state.pendingCaptureKind = ""; showSettings(false); });
  $("#captureButton").addEventListener("click", () => openUpload("both")); $("#filterButton").addEventListener("click", () => { $("#filterSheet").hidden = false; });
  $$('[data-close-filter]').forEach((button) => button.addEventListener("click", () => { $("#filterSheet").hidden = true; }));
  $("#detailBack").addEventListener("click", closeDetail);
  $("#locationButton").addEventListener("click", openLocation);
  $("#locationMap").addEventListener("load", () => { $("#mapLoading").hidden = true; });
  $("#retryAllDeviceData").addEventListener("click", async () => {
    const button = $("#retryAllDeviceData"); button.disabled = true;
    try {
      const records = await window.IncidentOfflineStore.list(); let sent = 0;
      for (let index = 0; index < records.length; index += 1) { button.textContent = `再送中 ${index + 1}/${records.length}`; if (await resendDeviceRecord(records[index])) sent += 1; }
      await renderDeviceData(); if (sent) showToast(`${sent}件を共有サーバーへ登録しました`);
    } finally { button.textContent = "すべて再送"; button.disabled = false; }
  });
  $("#detailMedia").addEventListener("click", (event) => { if (event.target.tagName !== "VIDEO") openFullscreen(); });
  $("#detailMedia").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFullscreen(); } });
  $("#fullscreenMedia").addEventListener("touchstart", (event) => {
    if (!$("#fullscreenMedia").classList.contains("zoomable")) return;
    fullscreenZoom.moved = false;
    if (event.touches.length === 2) {
      fullscreenZoom.pinching = true; fullscreenZoom.startDistance = touchDistance(event.touches); fullscreenZoom.startScale = fullscreenZoom.scale; event.preventDefault();
    } else if (event.touches.length === 1 && fullscreenZoom.scale > 1) {
      fullscreenZoom.startX = event.touches[0].clientX; fullscreenZoom.startY = event.touches[0].clientY; fullscreenZoom.baseX = fullscreenZoom.x; fullscreenZoom.baseY = fullscreenZoom.y; event.preventDefault();
    }
  }, { passive: false });
  $("#fullscreenMedia").addEventListener("touchmove", (event) => {
    if (!$("#fullscreenMedia").classList.contains("zoomable")) return;
    if (event.touches.length === 2 && fullscreenZoom.startDistance) {
      fullscreenZoom.moved = true; fullscreenZoom.scale = Math.max(1, Math.min(5, fullscreenZoom.startScale * touchDistance(event.touches) / fullscreenZoom.startDistance)); applyFullscreenZoom(); event.preventDefault();
    } else if (event.touches.length === 1 && fullscreenZoom.scale > 1) {
      fullscreenZoom.moved = true; fullscreenZoom.x = fullscreenZoom.baseX + event.touches[0].clientX - fullscreenZoom.startX; fullscreenZoom.y = fullscreenZoom.baseY + event.touches[0].clientY - fullscreenZoom.startY; applyFullscreenZoom(); event.preventDefault();
    }
  }, { passive: false });
  $("#fullscreenMedia").addEventListener("touchend", (event) => {
    if (!$("#fullscreenMedia").classList.contains("zoomable")) return;
    if (fullscreenZoom.scale <= 1.01) resetFullscreenZoom();
    if (!event.touches.length && !fullscreenZoom.moved && !fullscreenZoom.pinching) {
      const now = Date.now(); if (now - fullscreenZoom.lastTap < 320) { toggleFullscreenZoom(); fullscreenZoom.lastTap = 0; } else fullscreenZoom.lastTap = now;
    }
    if (event.touches.length < 2) { fullscreenZoom.pinching = false; fullscreenZoom.startDistance = 0; }
    if (event.touches.length === 1 && fullscreenZoom.scale > 1) { fullscreenZoom.startX = event.touches[0].clientX; fullscreenZoom.startY = event.touches[0].clientY; fullscreenZoom.baseX = fullscreenZoom.x; fullscreenZoom.baseY = fullscreenZoom.y; }
  }, { passive: false });
  $("#fullscreenMedia").addEventListener("dblclick", (event) => { if ($("#fullscreenMedia").classList.contains("zoomable")) { event.preventDefault(); toggleFullscreenZoom(); } });
  $("#fullscreenMedia").addEventListener("wheel", (event) => {
    if (!$("#fullscreenMedia").classList.contains("zoomable")) return;
    event.preventDefault(); fullscreenZoom.scale = Math.max(1, Math.min(5, fullscreenZoom.scale * (event.deltaY < 0 ? 1.18 : .85))); if (fullscreenZoom.scale <= 1.01) { fullscreenZoom.x = 0; fullscreenZoom.y = 0; } applyFullscreenZoom();
  }, { passive: false });
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
  $("#viewBackButton").addEventListener("click", () => { if (!$("#fullscreenScreen").hidden) closeFullscreen(); else if (!$("#locationScreen").hidden) closeLocation(); else if (!$("#deviceScreen").hidden) closeDeviceData(); else if (!$("#settingsScreen").hidden) closeSettings(); else if (!$("#uploadSheet").hidden) closeUpload(); else if (!$("#detailScreen").hidden) closeDetail(); else showHome(); });
  window.addEventListener("beforeunload", () => { state.mediaUrls.forEach((url) => URL.revokeObjectURL(url)); clearDeviceDataUrls(); if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl); });
  let resizeTimer;
  let previousLandscape = isLandscapeLayout();
  window.addEventListener("resize", () => { scheduleViewportSync(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => {
    const landscape = isLandscapeLayout(); if (updateGridShape()) renderGallery();
    if (landscape !== previousLandscape) {
      previousLandscape = landscape;
      if (!$("#uploadSheet").hidden || !$("#settingsScreen").hidden || !$("#deviceScreen").hidden) return;
      if (!$("#fullscreenScreen").hidden) { setHeader("fullscreen"); return; }
      if (!$("#locationScreen").hidden) { setHeader("location"); return; }
      if (!$("#detailScreen").hidden) { $("#detailScreen").scrollTop = 0; setHeader("detail"); return; }
      if (landscape) showGallery(); else showHome();
    }
  }, 120); });
  window.addEventListener("orientationchange", scheduleViewportSync);
  window.visualViewport?.addEventListener("resize", scheduleViewportSync);

  async function start() {
    try {
      scheduleViewportSync();
      $("#authCover p").textContent = "Firebase認証を確認しています";
      const result = window.TayunetAuthReady ? await Promise.race([window.TayunetAuthReady, new Promise((_, reject) => setTimeout(() => reject(new Error("認証確認がタイムアウトしました")), 15000))]) : null;
      if (result && result.ok !== true) return;
      await window.TayunetFirebaseDataAuth.currentUser();
      updateGridShape(); updateDeviceStatus(); await updateUnsentCount(); $("#authCover").hidden = true; $("#app").hidden = false; if (isLandscapeLayout()) showGallery(); else showHome(); await loadItems();
      if (!deviceName()) showToast("端末名が未設定です。設定画面で登録してください", true);
    } catch (error) { $("#authCover p").textContent = error.message || "ログイン画面へ移動しています"; }
  }
  start();
})();
