(function () {
  "use strict";

  const API = "https://photo-api.tayunet-traininfo.com";
  const STORAGE_KEY = "tayunet-photo-spots-v1";
  const MIGRATION_BACKUP_KEY = "tayunet-photo-spots-v1-backup-before-v3";
  const API_MIGRATION_BACKUP_KEY = "tayunet-photo-spots-v1-backup-before-api";
  const API_MIGRATION_KEY = "tayunet-photo-spots-api-import-v1";
  const API_CACHE_KEY = "tayunet-photo-spots-api-cache-v1";
  const FAVORITE_KEY = "tayunet-photo-spot-favorites-v1";
  const SCHEMA_VERSION = 3;
  const KIND_LABELS = Object.freeze({ train: "列車", nonTrain: "その他" });
  const VALID_KINDS = new Set(Object.keys(KIND_LABELS));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function element(tag, { className = "", text, attrs = {} } = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
  }

  function append(parent, ...children) {
    children.flat().forEach(child => parent.append(child));
    return parent;
  }

  function option(value, label) {
    const node = element("option", { text: label });
    node.value = value;
    return node;
  }

  function safePhotoSource(spot) {
    const source = String(spot.photo || "");
    return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(source)
      ? source
      : "";
  }

  function meaningful(value) {
    const text = String(value ?? "").trim();
    return text && !["未登録", "未確認", "—"].includes(text);
  }

  const state = {
    kind: "all",
    view: "split",
    spots: [],
    results: [],
    favorites: new Set(),
    selectedId: null,
    map: null,
    mapResizeObserver: null,
    markers: new Map(),
    editorMap: null,
    editorMarker: null,
    apiReady: false
  };

  function rad(value) { return value * Math.PI / 180; }
  function deg(value) { return value * 180 / Math.PI; }
  const angularDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const monthInRange = (month, start, end) => !start || !end ? true : start <= end ? month >= start && month <= end : month >= start || month <= end;

  function solarPosition(date, lat, lng) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545.0;
    const L = (280.46 + 0.9856474 * n) % 360;
    const g = rad((357.528 + 0.9856003 * n) % 360);
    const lambda = rad((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360);
    const epsilon = rad(23.439 - 0.0000004 * n);
    const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
    const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
    const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    const lst = rad((gmst * 15 + lng) % 360);
    const hour = lst - ra;
    const latitude = rad(lat);
    const elevation = deg(Math.asin(Math.sin(latitude) * Math.sin(dec) + Math.cos(latitude) * Math.cos(dec) * Math.cos(hour)));
    const azimuth = (deg(Math.atan2(-Math.sin(hour), Math.tan(dec) * Math.cos(latitude) - Math.sin(latitude) * Math.cos(hour))) + 360) % 360;
    return { azimuth, elevation };
  }

  function lightCondition(spot, sun) {
    if (sun.elevation < 1) return { key: "night", label: "夜間", detail: "太陽は地平線の下" };
    const ideal = (Number(spot.bearing || 0) + 180) % 360;
    const diff = angularDistance(sun.azimuth, ideal);
    if (diff <= 38) return { key: "front", label: "順光", detail: `光軸差 ${Math.round(diff)}°` };
    if (diff <= 85) return { key: "side", label: "側面光", detail: `光軸差 ${Math.round(diff)}°` };
    return { key: "back", label: "逆光", detail: `光軸差 ${Math.round(diff)}°` };
  }

  function normalizeSpot(value) {
    const raw = value && typeof value === "object" ? value : {};
    if (raw.schemaVersion === SCHEMA_VERSION) return raw;
    const oldKind = String(raw.kind || "");
    let subject = String(raw.subject ?? raw.flower ?? "").trim();
    if (!subject && oldKind === "flower") subject = "花";
    if (!subject && oldKind === "autumn") subject = "紅葉";
    if (!subject && oldKind === "scenery") subject = "風景";
    const memo = String(raw.memo ?? raw.safety ?? "");
    const { flower, safety, parking, rating, _score, _light, ...rest } = raw;
    return {
      ...rest,
      schemaVersion: SCHEMA_VERSION,
      kind: oldKind === "train" ? "train" : "nonTrain",
      subject,
      memo
    };
  }

  function migrateItems(items) {
    return items.map(normalizeSpot);
  }

  function loadLocal() {
    const source = localStorage.getItem(STORAGE_KEY);
    if (!source) return [];
    try {
      const parsed = JSON.parse(source);
      if (!Array.isArray(parsed)) return [];
      if (parsed.every(item => item && item.schemaVersion === SCHEMA_VERSION)) return parsed;
      const normalized = migrateItems(parsed);
      const serialized = JSON.stringify(normalized);
      if (serialized !== source) {
        try {
          if (!localStorage.getItem(MIGRATION_BACKUP_KEY)) localStorage.setItem(MIGRATION_BACKUP_KEY, source);
          localStorage.setItem(STORAGE_KEY, serialized);
        } catch (_) {
          return normalized;
        }
      }
      return normalized;
    } catch (_) {
      return [];
    }
  }

  function saveLocal(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  function loadApiCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(API_CACHE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeSpot) : [];
    } catch (_) { return []; }
  }
  function saveApiCache(items) {
    try { localStorage.setItem(API_CACHE_KEY, JSON.stringify(items)); } catch (_) {}
  }
  function loadFavorites() {
    try { return new Set(JSON.parse(localStorage.getItem(FAVORITE_KEY) || "[]").map(String)); }
    catch (_) { return new Set(); }
  }
  function saveFavorites() { localStorage.setItem(FAVORITE_KEY, JSON.stringify([...state.favorites])); }
  function sameId(a, b) { return String(a) === String(b); }
  function isFavorite(id) { return state.favorites.has(String(id)); }

  function selectedDate() {
    const value = $("#plan-date").value;
    const time = $("#plan-time").value || "09:00";
    return value ? new Date(`${value}T${time}:00+09:00`) : new Date();
  }

  function currentSun() { return solarPosition(selectedDate(), 35.6812, 139.7671); }
  function compass(value) {
    const names = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
    return names[Math.round(value / 45) % 8];
  }

  function updateSunSummary() {
    const sun = currentSun();
    $("#sun-summary").textContent = sun.elevation > 0
      ? `${compass(sun.azimuth)} 高度${Math.round(sun.elevation)}° 方位${Math.round(sun.azimuth)}°`
      : `日没後 方位${Math.round(sun.azimuth)}°`;
  }

  function uniqueOptions(key) {
    return [...new Set(state.spots.map(item => item[key]).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "ja"));
  }

  function fillOptions() {
    const line = $("#line-filter");
    const subject = $("#subject-filter");
    line.replaceChildren(option("", "すべての路線"), ...uniqueOptions("line").map(value => option(value, value)));
    subject.replaceChildren(option("", "すべての被写体"), ...uniqueOptions("subject").map(value => option(value, value)));
  }

  function setContextFilters() {
    $("#train-filters").hidden = state.kind !== "train";
    $("#non-train-filters").hidden = state.kind !== "nonTrain";
  }

  function filterResults() {
    const keyword = $("#keyword-filter").value.trim().toLowerCase();
    const line = $("#line-filter").value;
    const direction = $("#direction-filter").value;
    const subject = $("#subject-filter").value;
    const lightFilter = $("#light-filter").value;
    const access = $("#access-filter").value;
    const month = selectedDate().getMonth() + 1;
    const sun = currentSun();
    const requireSeason = $("#season-filter").checked;
    const beginner = $("#beginner-filter").checked;
    const verified = $("#safe-filter").checked;

    state.results = state.spots.filter(spot => {
      const haystack = [spot.name, spot.area, spot.line, spot.section, spot.subject, spot.memo, ...(spot.features || [])].join(" ").toLowerCase();
      const light = lightCondition(spot, sun);
      if (state.kind === "favorite" && !isFavorite(spot.id)) return false;
      if (VALID_KINDS.has(state.kind) && spot.kind !== state.kind) return false;
      if (keyword && !haystack.includes(keyword)) return false;
      if (state.kind === "train" && line && spot.line !== line) return false;
      if (state.kind === "train" && direction && !(spot.directions || []).includes(direction)) return false;
      if (state.kind === "nonTrain" && subject && spot.subject !== subject) return false;
      if (lightFilter === "front" && light.key !== "front") return false;
      if (lightFilter === "side" && !["front", "side"].includes(light.key)) return false;
      if (lightFilter === "back" && light.key !== "back") return false;
      if (/^\d+$/.test(access) && Number(spot.walk || 0) > Number(access)) return false;
      if (state.kind === "nonTrain" && requireSeason && !monthInRange(month, spot.bloomStart, spot.bloomEnd)) return false;
      if (beginner && !spot.beginner) return false;
      if (verified && !spot.verified) return false;
      return true;
    }).map(spot => ({ ...spot, _light: lightCondition(spot, sun) }));

    const sort = $("#sort-order").value;
    state.results.sort((a, b) => sort === "distance"
      ? Number(a.walk || 0) - Number(b.walk || 0)
      : String(b.updated || "").localeCompare(String(a.updated || "")));
    if (state.selectedId !== null && !state.results.some(item => sameId(item.id, state.selectedId))) state.selectedId = null;
    render();
  }

  function card(spot) {
    const subject = spot.kind === "train"
      ? [spot.line, spot.section].filter(meaningful).join(" ")
      : [spot.subject, spot.area].filter(meaningful).join("・");
    const season = spot.kind === "nonTrain" && (spot.bloomStart || spot.bloomEnd)
      ? `${spot.bloomStart || "?"}〜${spot.bloomEnd || "?"}月が見頃`
      : spot.kind === "train"
        ? (spot.directions || []).map(direction => direction === "up" ? "上り" : "下り").join("・")
        : meaningful(spot.subject) ? spot.subject : "";
    const photoSource = safePhotoSource(spot);
    const article = element("article", { className: `spot-card${photoSource ? " has-photo" : ""}${sameId(state.selectedId, spot.id) ? " active" : ""}`, attrs: { tabindex: "0" } });
    article.dataset.id = String(spot.id);
    const kind = element("span", { className: `kind-badge ${spot.kind}`, text: KIND_LABELS[spot.kind] || "その他" });
    const favorite = element("button", {
      className: `favorite-button${isFavorite(spot.id) ? " saved" : ""}`,
      text: "★ お気に入り",
      attrs: { type: "button", "aria-label": "お気に入り", "aria-pressed": String(isFavorite(spot.id)) }
    });
    favorite.dataset.favorite = String(spot.id);
    const body = element("div", { className: "card-body" });
    append(body, append(element("div", { className: "card-status" }), kind, favorite));
    const lightRow = element("div", { className: "light-row" });
    append(lightRow, element("span", { className: `light-chip ${spot._light.key}`, text: spot._light.label }));
    const meta = element("div", { className: "card-meta" });
    if (meaningful(spot.walk) && Number.isFinite(Number(spot.walk))) append(meta, element("span", { text: `徒歩${Number(spot.walk)}分` }));
    if (meaningful(spot.lens)) append(meta, element("span", { text: spot.lens }));
    if (meaningful(season)) append(meta, element("span", { text: season }));
    if (meaningful(subject)) append(body, element("div", { className: "card-kicker", text: subject }));
    append(body, element("div", { className: "card-title", text: spot.name }), lightRow);
    if (meta.childElementCount) append(body, meta);
    const footer = element("div", { className: "card-footer" });
    if (meaningful(spot.updated)) append(footer, element("span", { text: `最終確認 ${spot.updated}` }));
    append(footer, element("b", { text: "詳細を見る" }));
    if (photoSource) {
      const visual = element("div", { className: "card-visual" });
      const image = element("img");
      image.src = photoSource;
      image.alt = `${spot.name}の作例`;
      append(visual, image);
      append(article, visual);
    }
    return append(article, body, footer);
  }

  function renderCards() {
    const cards = $("#spot-cards");
    cards.replaceChildren(...state.results.map(card));
    $("#result-count").textContent = `${state.results.length}件`;
    $("#empty-state").hidden = state.results.length > 0;
    $$(".spot-card", cards).forEach(cardElement => {
      cardElement.addEventListener("click", event => {
        if (event.target.closest("[data-favorite]")) return;
        selectSpot(cardElement.dataset.id, true);
      });
      cardElement.addEventListener("keydown", event => {
        if (event.key === "Enter") selectSpot(cardElement.dataset.id, true);
      });
    });
    $$('[data-favorite]', cards).forEach(button => button.addEventListener("click", event => {
      event.stopPropagation();
      toggleFavorite(button.dataset.favorite);
    }));
  }

  function markerIcon(spot, selected = false) {
    const marker = element("span", { className: `spot-marker ${spot.kind}${selected ? " selected" : ""}` });
    return L.divIcon({ className: "", html: marker, iconSize: [13, 13], iconAnchor: [7, 7] });
  }

  function refreshMapLayout(fitCandidates = true) {
    const mapElement = $("#spot-map");
    if (!state.map || !mapElement.clientWidth || !mapElement.clientHeight) return;
    requestAnimationFrame(() => {
      state.map.invalidateSize({ pan: false });
      requestAnimationFrame(() => {
        if (!fitCandidates) return;
        const coordinates = state.results
          .map(spot => [Number(spot.lat), Number(spot.lng)])
          .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
        if (!coordinates.length) return;
        const bounds = L.latLngBounds(coordinates);
        if (coordinates.length === 1) state.map.setView(bounds.getCenter(), 14);
        else state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 14 });
      });
    });
  }

  function renderMap() {
    if (!window.L) return;
    const mapElement = $("#spot-map");
    if (!mapElement.clientWidth || !mapElement.clientHeight) return;
    if (!state.map) {
      state.map = L.map(mapElement, { zoomControl: true }).setView([35.72, 139.67], 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
      }).addTo(state.map);
    }
    state.markers.forEach(marker => marker.remove());
    state.markers.clear();
    state.results.filter(spot => Number.isFinite(Number(spot.lat)) && Number.isFinite(Number(spot.lng))).forEach(spot => {
      const marker = L.marker([spot.lat, spot.lng], { icon: markerIcon(spot, sameId(state.selectedId, spot.id)) }).addTo(state.map);
      marker.bindTooltip(element("span", { text: spot.name }), { direction: "top" });
      marker.on("click", () => selectSpot(spot.id, false));
      state.markers.set(String(spot.id), marker);
    });
    refreshMapLayout(true);
  }

  function activeLabels() {
    const labels = [];
    if (state.kind !== "all") labels.push(state.kind === "favorite" ? "お気に入り" : KIND_LABELS[state.kind]);
    const keyword = $("#keyword-filter").value.trim();
    if (keyword) labels.push(`「${keyword}」`);
    const commonControls = [["#light-filter", "光線"], ["#access-filter", "アクセス"]];
    commonControls.forEach(([selector, label]) => {
      const control = $(selector);
      if (control.value) labels.push(`${label}: ${control.selectedOptions[0].textContent}`);
    });
    if (state.kind === "train") {
      [["#line-filter", "路線"], ["#direction-filter", "方向"]].forEach(([selector, label]) => {
        const control = $(selector);
        if (control.value) labels.push(`${label}: ${control.selectedOptions[0].textContent}`);
      });
    }
    if (state.kind === "nonTrain") {
      const subject = $("#subject-filter");
      if (subject.value) labels.push(`被写体: ${subject.selectedOptions[0].textContent}`);
      if ($("#season-filter").checked) labels.push("指定月に見頃");
    }
    if ($("#beginner-filter").checked) labels.push("初心者向け");
    if ($("#safe-filter").checked) labels.push("現地確認済み");
    $("#active-filters").replaceChildren(...labels.map(value => element("span", { text: value })));
  }

  function render() {
    updateSunSummary();
    activeLabels();
    renderCards();
    renderMap();
  }

  function selectSpot(id, open) {
    state.selectedId = String(id);
    state.markers.forEach((marker, markerId) => {
      const spot = state.results.find(item => sameId(item.id, markerId));
      if (spot) marker.setIcon(markerIcon(spot, sameId(markerId, id)));
    });
    $$(".spot-card").forEach(cardElement => cardElement.classList.toggle("active", sameId(cardElement.dataset.id, id)));
    const spot = state.results.find(item => sameId(item.id, id)) || state.spots.find(item => sameId(item.id, id));
    if (spot && state.map) state.map.panTo([spot.lat, spot.lng]);
    if (open && spot) openDetail(spot);
  }

  function directionText(spot) {
    if (spot.kind !== "train") return "—";
    return (spot.directions || []).map(direction => direction === "up"
      ? `上り（${spot.upLabel || "上り方面"}）`
      : `下り（${spot.downLabel || "下り方面"}）`).join("／");
  }

  function summaryItem(label, value, note) {
    const item = element("div");
    append(item, element("small", { text: label }));
    if (meaningful(value)) append(item, element("strong", { text: value }));
    if (meaningful(note)) append(item, element("span", { text: note }));
    return item;
  }

  function detailSection(title, content) {
    return append(element("section", { className: "detail-section" }), element("h3", { text: title }), content);
  }

  function dataList(items) {
    const list = element("dl", { className: "data-list" });
    items.forEach(([term, value]) => append(list, element("dt", { text: term }), element("dd", { text: value })));
    return list;
  }

  function openDetail(raw) {
    const sun = currentSun();
    const spot = { ...raw, _light: raw._light || lightCondition(raw, sun) };
    const dialog = $("#spot-dialog");
    const container = $("#spot-detail");
    const article = element("article", { className: "detail-shell" });
    const header = element("header", { className: "detail-head" });
    const close = element("button", { text: "×", attrs: { type: "button", "aria-label": "閉じる" } });
    append(header, element("h2", { text: spot.name }), close);
    const photoSource = safePhotoSource(spot);
    const grid = element("div", { className: `detail-grid${photoSource ? "" : " no-media"}` });
    const content = element("div", { className: "detail-content" });
    const summary = element("div", { className: "condition-summary" });
    const conditionValue = spot.kind === "train"
      ? (spot.directions || []).map(direction => direction === "up" ? "上り" : "下り").join("・")
      : spot.bloomStart && spot.bloomEnd ? `${spot.bloomStart}〜${spot.bloomEnd}月` : spot.subject || "";
    const conditionNote = spot.kind === "train" && Number.isFinite(Number(spot.bearing))
      ? `カメラ方位 ${Number(spot.bearing)}°`
      : spot.kind === "nonTrain" && meaningful(spot.subject) ? spot.subject : "";
    append(summary, summaryItem("光線", spot._light.label, spot._light.detail));
    if (meaningful(conditionValue) || meaningful(conditionNote)) {
      append(summary, summaryItem(
        spot.kind === "train" ? "撮影方向" : spot.bloomStart && spot.bloomEnd ? "見頃" : "被写体",
        conditionValue,
        conditionNote
      ));
    }
    const conditionItems = [];
    if (meaningful(spot.area)) conditionItems.push(["場所", spot.area]);
    const target = spot.kind === "train" ? [spot.line, spot.section].filter(meaningful).join(" ") : spot.subject;
    if (meaningful(target)) conditionItems.push([spot.kind === "train" ? "線区" : "被写体", target]);
    if (spot.kind === "train" && meaningful(directionText(spot))) conditionItems.push(["対象方向", directionText(spot)]);
    if (meaningful(spot.lens)) conditionItems.push(["推奨レンズ", spot.lens]);
    if (meaningful(spot.capacity)) conditionItems.push(["定員目安", spot.capacity]);
    if (meaningful(spot.tripod)) conditionItems.push(["三脚", spot.tripod]);
    const access = element("div");
    if (meaningful(spot.access)) append(access, element("p", { text: spot.access }));
    if (meaningful(spot.walk) && Number.isFinite(Number(spot.walk))) append(access, append(element("p"), element("b", { text: "徒歩：" }), `${Number(spot.walk)}分`));
    const actions = element("div", { className: "detail-actions" });
    const mapLink = element("a", { text: "地図アプリで開く", attrs: { target: "_blank", rel: "noopener noreferrer" } });
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(spot.lat)},${Number(spot.lng)}`)}`;
    const favorite = element("button", { text: isFavorite(spot.id) ? "お気に入り保存済み" : "お気に入りに保存", attrs: { type: "button" } });
    const archive = element("a", { text: "撮影記録を開く" });
    archive.href = "/photo-archive.html";
    append(actions, mapLink, favorite, archive);
    append(content, summary);
    if (conditionItems.length) append(content, detailSection("撮影条件", dataList(conditionItems)));
    if (access.childElementCount) append(content, detailSection("アクセス", access));
    if (String(spot.memo || "").trim()) append(content, detailSection("メモ", element("div", { className: "memo-box", text: spot.memo })));
    append(content, actions);
    if (photoSource) {
      const media = element("div", { className: "detail-media" });
      const image = element("img");
      image.src = photoSource;
      image.alt = `${spot.name}の作例`;
      append(media, image, element("span", { className: "media-caption", text: "作例写真／撮影前に現地の最新状況を確認してください" }));
      append(grid, media);
    }
    append(grid, content);
    append(article, header, grid);
    container.replaceChildren(article);
    close.addEventListener("click", () => dialog.close());
    favorite.addEventListener("click", () => {
      toggleFavorite(spot.id);
      dialog.close();
      openDetail(state.spots.find(item => sameId(item.id, spot.id)));
    });
    dialog.showModal();
  }

  function toggleFavorite(id) {
    const key = String(id);
    state.favorites.has(key) ? state.favorites.delete(key) : state.favorites.add(key);
    saveFavorites();
    filterResults();
    showToast(state.favorites.has(key) ? "お気に入りに保存しました" : "お気に入りから外しました");
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  async function api(path, options = {}, retryAuth = true) {
    let user;
    try { user = await window.TayunetFirebaseDataAuth.currentUser(); }
    catch (_) { throw new Error("ログイン情報を確認できません。再ログインしてください"); }
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${await user.getIdToken(!retryAuth)}`);
    if (options.body) headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers, signal: controller.signal, mode: "cors", cache: "no-store" });
    } catch (error) {
      throw new Error(error.name === "AbortError" ? "撮影地サーバーからの応答がありません" : "撮影地サーバーに接続できません");
    } finally { clearTimeout(timer); }
    if (response.status === 401 && retryAuth) return api(path, options, false);
    if (!response.ok) {
      let detail = "";
      try { detail = String((await response.json()).detail || ""); } catch (_) {}
      throw new Error(detail || `撮影地サーバーでエラーが発生しました（${response.status}）`);
    }
    return response.json();
  }

  function remapFavorites(idMap) {
    let changed = false;
    Object.entries(idMap || {}).forEach(([oldId, newId]) => {
      if (!state.favorites.has(String(oldId))) return;
      state.favorites.delete(String(oldId));
      state.favorites.add(String(newId));
      changed = true;
    });
    if (changed) saveFavorites();
  }

  async function synchronizeSpots() {
    const local = loadLocal();
    if (local.length && !localStorage.getItem(API_MIGRATION_KEY)) {
      const source = localStorage.getItem(STORAGE_KEY);
      if (source && !localStorage.getItem(API_MIGRATION_BACKUP_KEY)) localStorage.setItem(API_MIGRATION_BACKUP_KEY, source);
      const items = local.map((spot, index) => {
        const currentId = String(spot.id || "");
        const clientId = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(currentId) ? currentId : `legacy-${index}`;
        return { ...spot, clientId };
      });
      const idMap = {};
      for (let offset = 0; offset < items.length; offset += 100) {
        const imported = await api("/v1/spots/import", {
          method: "POST",
          body: JSON.stringify({ items: items.slice(offset, offset + 100) })
        });
        Object.assign(idMap, imported.idMap || {});
      }
      remapFavorites(idMap);
      localStorage.setItem(API_MIGRATION_KEY, new Date().toISOString());
    }
    const response = await api("/v1/spots");
    state.spots = Array.isArray(response.items) ? response.items.map(normalizeSpot) : [];
    state.apiReady = true;
    saveApiCache(state.spots);
    fillOptions();
    filterResults();
  }

  function resetFilters() {
    state.kind = "all";
    $$(".category-tabs button").forEach(button => button.classList.toggle("active", button.dataset.kind === "all"));
    ["#keyword-filter", "#line-filter", "#direction-filter", "#subject-filter", "#light-filter", "#access-filter"].forEach(selector => { $(selector).value = ""; });
    $("#season-filter").checked = false;
    $("#beginner-filter").checked = false;
    $("#safe-filter").checked = false;
    setContextFilters();
    filterResults();
  }

  function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function updateEditorFields() {
    const isTrain = $("#editor-kind").value === "train";
    $("#editor-train-fields").hidden = !isTrain;
    $("#editor-non-train-fields").hidden = isTrain;
  }

  function setEditorPoint(lat, lng, center = false) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const form = $("#spot-form");
    form.elements.lat.value = lat.toFixed(6);
    form.elements.lng.value = lng.toFixed(6);
    $("#editor-map-status").textContent = `緯度 ${lat.toFixed(6)}／経度 ${lng.toFixed(6)}`;
    if (!state.editorMap) return;
    if (!state.editorMarker) state.editorMarker = L.marker([lat, lng]).addTo(state.editorMap);
    else state.editorMarker.setLatLng([lat, lng]);
    if (center) state.editorMap.panTo([lat, lng]);
  }

  function ensureEditorMap() {
    if (!window.L) {
      $("#editor-map-status").textContent = "地図を読み込めません。緯度・経度は手入力できます。";
      return;
    }
    if (!state.editorMap) {
      state.editorMap = L.map($("#editor-map"), { zoomControl: true, dragging: true, touchZoom: true }).setView([35.6812, 139.7671], 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
      }).addTo(state.editorMap);
      state.editorMap.on("click", event => setEditorPoint(event.latlng.lat, event.latlng.lng));
    }
    state.editorMap.invalidateSize();
    const form = $("#spot-form");
    const lat = Number(form.elements.lat.value);
    const lng = Number(form.elements.lng.value);
    if (form.elements.lat.value && form.elements.lng.value && Number.isFinite(lat) && Number.isFinite(lng)) setEditorPoint(lat, lng, true);
  }

  function openEditor() {
    const dialog = $("#editor-dialog");
    updateEditorFields();
    dialog.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ensureEditorMap();
      if (state.editorMap) state.editorMap.invalidateSize({ pan: false });
    }));
  }

  function syncEditorMapFromInputs() {
    const form = $("#spot-form");
    const lat = Number(form.elements.lat.value);
    const lng = Number(form.elements.lng.value);
    if (form.elements.lat.value && form.elements.lng.value && Number.isFinite(lat) && Number.isFinite(lng)) setEditorPoint(lat, lng, true);
  }

  async function addSpot(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("photo");
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    if (file && file.size > 2 * 1024 * 1024) { showToast("写真は2MB以下にしてください"); return; }
    if (file && file.size && !allowedTypes.has(file.type)) { showToast("写真はPNG・JPEG・GIF・WebP形式にしてください"); return; }
    const kind = String(data.get("kind") || "nonTrain");
    const isTrain = kind === "train";
    const spot = {
      clientId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      schemaVersion: SCHEMA_VERSION,
      kind: isTrain ? "train" : "nonTrain",
      name: String(data.get("name") || "").trim(),
      area: "利用者登録",
      line: isTrain ? String(data.get("line") || "").trim() : "",
      subject: isTrain ? "" : String(data.get("subject") || "").trim(),
      lat: Number(data.get("lat")),
      lng: Number(data.get("lng")),
      bearing: isTrain ? Number(data.get("bearing") || 0) : 0,
      directions: isTrain ? ["up", "down"] : [],
      upLabel: isTrain ? String(data.get("upLabel") || "").trim() : "",
      downLabel: isTrain ? String(data.get("downLabel") || "").trim() : "",
      walk: Number(data.get("walk") || 0),
      beginner: false,
      verified: true,
      updated: new Date().toISOString().slice(0, 10),
      bloomStart: isTrain ? 0 : Number(data.get("bloomStart") || 0),
      bloomEnd: isTrain ? 0 : Number(data.get("bloomEnd") || 0),
      lens: "",
      capacity: "",
      tripod: "",
      access: String(data.get("access") || "").trim(),
      memo: String(data.get("memo") || ""),
      features: ["利用者登録"]
    };
    if (file && file.size) spot.photo = await fileAsDataUrl(file);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "保存中";
    try {
      const saved = await api("/v1/spots", { method: "POST", body: JSON.stringify(spot) });
      state.spots = [normalizeSpot(saved), ...state.spots.filter(item => !sameId(item.id, saved.id))];
      saveApiCache(state.spots);
    } catch (error) {
      showToast(error.message || "撮影地を保存できませんでした");
      return;
    } finally {
      submit.disabled = false;
      submit.textContent = "撮影地を保存";
    }
    fillOptions();
    $("#editor-dialog").close();
    form.reset();
    updateEditorFields();
    if (state.editorMarker) { state.editorMarker.remove(); state.editorMarker = null; }
    $("#editor-map-status").textContent = "地図をクリックまたはタップして位置を指定";
    filterResults();
    showToast("撮影地をサーバーに保存しました");
  }

  function bind() {
    const headerMenu = $(".header-menu");
    const headerMenuSummary = $("summary", headerMenu);
    headerMenu.addEventListener("toggle", () => headerMenuSummary.setAttribute("aria-expanded", String(headerMenu.open)));
    document.addEventListener("click", event => {
      if (headerMenu.open && !headerMenu.contains(event.target)) headerMenu.open = false;
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !headerMenu.open) return;
      headerMenu.open = false;
      headerMenuSummary.focus();
    });
    ["#plan-date", "#plan-time"].forEach(selector => $(selector).addEventListener("change", filterResults));
    ["#keyword-filter", "#line-filter", "#direction-filter", "#subject-filter", "#light-filter", "#access-filter", "#season-filter", "#beginner-filter", "#safe-filter", "#sort-order"].forEach(selector => {
      $(selector).addEventListener(selector === "#keyword-filter" ? "input" : "change", filterResults);
    });
    $$(".category-tabs button").forEach(button => button.addEventListener("click", () => {
      state.kind = button.dataset.kind;
      $$(".category-tabs button").forEach(item => item.classList.toggle("active", item === button));
      setContextFilters();
      filterResults();
    }));
    $$(".view-switch button").forEach(button => button.addEventListener("click", () => {
      state.view = button.dataset.view;
      $(".result-area").dataset.view = state.view;
      $$(".view-switch button").forEach(item => item.classList.toggle("active", item === button));
      refreshMapLayout(true);
    }));
    $("#clear-filters").addEventListener("click", resetFilters);
    $("#map-reset").addEventListener("click", () => state.map && state.map.setView([35.72, 139.67], 9));
    $("#filter-toggle").addEventListener("click", () => {
      document.body.classList.toggle("filters-open");
      $("#filter-toggle").setAttribute("aria-expanded", String(document.body.classList.contains("filters-open")));
    });
    $("#add-spot-button").addEventListener("click", openEditor);
    $$('[data-close="editor-dialog"]').forEach(button => button.addEventListener("click", () => $("#editor-dialog").close()));
    $("#editor-kind").addEventListener("change", updateEditorFields);
    [$("#spot-form").elements.lat, $("#spot-form").elements.lng].forEach(input => input.addEventListener("change", syncEditorMapFromInputs));
    $("#spot-form").addEventListener("submit", addSpot);
  }

  function authenticatedName(result) {
    const profile = result?.profile || {};
    const user = result?.user || {};
    return [profile.displayName, profile.name, user.displayName, user.email, "利用者"]
      .map(value => String(value || "").trim())
      .find(Boolean);
  }

  async function finishAuthenticatedLayout(result) {
    if (!result?.ok) return;
    $("#user-info").textContent = `${authenticatedName(result)} でログイン中`;
    requestAnimationFrame(() => requestAnimationFrame(renderMap));
    try { await synchronizeSpots(); }
    catch (error) { showToast(`${error.message || "撮影地を取得できませんでした"}。端末内の控えを表示します`); }
  }

  function initialize() {
    const now = new Date();
    const rounded = new Date(Math.ceil(now.getTime() / 900000) * 900000);
    $("#plan-date").value = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    $("#plan-time").value = `${String(rounded.getHours()).padStart(2, "0")}:${String(rounded.getMinutes()).padStart(2, "0")}`;
    state.spots = loadApiCache();
    if (!state.spots.length) state.spots = loadLocal();
    state.favorites = loadFavorites();
    fillOptions();
    bind();
    setContextFilters();
    filterResults();
    if ("ResizeObserver" in window) {
      state.mapResizeObserver = new ResizeObserver(entries => {
        const size = entries[0]?.contentRect;
        if (!size?.width || !size?.height) return;
        if (!state.map) renderMap();
        else refreshMapLayout(true);
      });
      state.mapResizeObserver.observe($("#spot-map"));
    }
    if (window.TayunetAuthReady?.then) window.TayunetAuthReady.then(finishAuthenticatedLayout);
    setTimeout(() => {
      if (!window.L) { showToast("地図を読み込めませんでした。一覧検索は利用できます"); return; }
      renderMap();
    }, 500);
  }

  window.PhotoSpotUtils = Object.freeze({
    solarPosition,
    lightCondition,
    monthInRange,
    angularDistance,
    authenticatedName,
    normalizeSpot,
    migrateItems,
    remapFavorites
  });
  document.addEventListener("DOMContentLoaded", initialize);
})();
