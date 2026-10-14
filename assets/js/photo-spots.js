(function () {
  "use strict";

  const API = "https://photo-api.tayunet-traininfo.com";
  const STORAGE_KEY = "tayunet-photo-spots-v1";
  const MIGRATION_BACKUP_KEY = "tayunet-photo-spots-v1-backup-before-v3";
  const API_MIGRATION_BACKUP_KEY = "tayunet-photo-spots-v1-backup-before-api";
  const API_MIGRATION_KEY = "tayunet-photo-spots-api-import-v1";
  const API_CACHE_KEY = "tayunet-photo-spots-api-cache-v1";
  const FAVORITE_KEY = "tayunet-photo-spot-favorites-v1";
  const FAVORITE_IMPORT_KEY = "tayunet-photo-spot-favorites-account-import-v1";
  const SCHEMA_VERSION = 3;
  const KIND_LABELS = Object.freeze({ train: "列車", nonTrain: "その他" });
  const VALID_KINDS = new Set(Object.keys(KIND_LABELS));
  const DEFAULT_GENRES = Object.freeze(["桜", "紅葉", "梅", "あじさい", "夜景", "夕焼け", "飛行機", "風景"]);
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
    selectedGenres: new Set(),
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
    detailMap: null,
    apiReady: false,
    me: null,
    editingId: null,
    editingRevision: null,
    conflictCurrent: null,
    photoObserver: null,
    photoUrls: new Map(),
    photoRequests: new Map(),
    favoriteSyncing: false
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

  function sunsetInfo(date, lat, lng) {
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const start = new Date(`${day}T12:00:00+09:00`);
    let previous = solarPosition(start, lat, lng);
    for (let minutes = 5; minutes <= 720; minutes += 5) {
      const currentDate = new Date(start.getTime() + minutes * 60000);
      const current = solarPosition(currentDate, lat, lng);
      if (previous.elevation >= 0 && current.elevation < 0) {
        let low = new Date(currentDate.getTime() - 5 * 60000);
        let high = currentDate;
        for (let index = 0; index < 8; index += 1) {
          const middle = new Date((low.getTime() + high.getTime()) / 2);
          if (solarPosition(middle, lat, lng).elevation >= 0) low = middle;
          else high = middle;
        }
        const sunset = new Date((low.getTime() + high.getTime()) / 2);
        const position = solarPosition(sunset, lat, lng);
        return {
          date: sunset,
          time: new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(sunset),
          azimuth: Math.round(position.azimuth)
        };
      }
      previous = current;
    }
    return null;
  }

  function normalizeGenreName(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 50);
  }

  function genreKey(value) { return normalizeGenreName(value).toLocaleLowerCase("ja"); }

  function knownGenres() {
    const names = [...DEFAULT_GENRES, ...state.spots.filter(spot => spot.kind === "nonTrain").map(spot => normalizeGenreName(spot.subject)).filter(Boolean)];
    const found = new Map();
    names.forEach(name => { if (!found.has(genreKey(name))) found.set(genreKey(name), name); });
    return [...found.values()].sort((a, b) => a.localeCompare(b, "ja"));
  }

  function canonicalGenre(value) {
    const normalized = normalizeGenreName(value);
    const existing = knownGenres().find(name => genreKey(name) === genreKey(normalized));
    return existing || normalized;
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function hasBearing(spot) {
    return spot?.bearing !== null && spot?.bearing !== "" && Number.isFinite(Number(spot?.bearing));
  }

  function lightCondition(spot, sun) {
    if (!hasBearing(spot)) return null;
    if (sun.elevation < 1) return { key: "night", label: "夜間", detail: "太陽は地平線の下" };
    const ideal = (Number(spot.bearing) + 180) % 360;
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
    line.replaceChildren(option("", "すべての路線"), ...uniqueOptions("line").map(value => option(value, value)));
    $("#subject-examples").replaceChildren(...knownGenres().map(value => option(value, value)));
    renderGenreFilters();
  }

  function renderGenreFilters() {
    const container = $("#genre-filter-buttons");
    const counts = new Map();
    state.spots.filter(spot => spot.kind === "nonTrain").forEach(spot => {
      const name = canonicalGenre(spot.subject);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    });
    const buttons = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, "ja")).map(([name, count]) => {
      const button = element("button", { attrs: { type: "button", "aria-pressed": String(state.selectedGenres.has(genreKey(name))) } });
      button.dataset.genre = genreKey(name);
      append(button, name, element("span", { text: count }));
      button.addEventListener("click", () => {
        const key = button.dataset.genre;
        state.selectedGenres.has(key) ? state.selectedGenres.delete(key) : state.selectedGenres.add(key);
        renderGenreFilters();
        filterResults();
      });
      return button;
    });
    container.replaceChildren(...(buttons.length ? buttons : [element("span", { className: "genre-empty", text: "登録済みジャンルはありません" })]));
  }

  function setContextFilters() {
    $("#train-filters").hidden = state.kind !== "train";
    $("#non-train-filters").hidden = state.kind !== "nonTrain";
    $("#light-filter-field").hidden = state.kind !== "train";
  }

  function filterResults() {
    const keyword = $("#keyword-filter").value.trim().toLowerCase();
    const line = $("#line-filter").value;
    const direction = $("#direction-filter").value;
    const lightFilter = $("#light-filter").value;
    const access = $("#access-filter").value;
    const month = selectedDate().getMonth() + 1;
    const requireSeason = $("#season-filter").checked;
    const beginner = $("#beginner-filter").checked;

    state.results = state.spots.filter(spot => {
      const haystack = [spot.name, spot.area, spot.line, spot.section, spot.subject, spot.memo, ...(spot.features || [])].join(" ").toLowerCase();
      const spotSun = solarPosition(selectedDate(), Number(spot.lat), Number(spot.lng));
      const light = lightCondition(spot, spotSun);
      if (state.kind === "favorite" && !isFavorite(spot.id)) return false;
      if (VALID_KINDS.has(state.kind) && spot.kind !== state.kind) return false;
      if (keyword && !haystack.includes(keyword)) return false;
      if (state.kind === "train" && line && spot.line !== line) return false;
      if (state.kind === "train" && direction && !(spot.directions || []).includes(direction)) return false;
      if (state.kind === "nonTrain" && state.selectedGenres.size && !state.selectedGenres.has(genreKey(spot.subject))) return false;
      if (state.kind === "train" && lightFilter === "front" && light?.key !== "front") return false;
      if (state.kind === "train" && lightFilter === "side" && !["front", "side"].includes(light?.key)) return false;
      if (state.kind === "train" && lightFilter === "back" && light?.key !== "back") return false;
      if (/^\d+$/.test(access) && (!positiveNumber(spot.walk) || positiveNumber(spot.walk) > Number(access))) return false;
      if (state.kind === "nonTrain" && requireSeason && !monthInRange(month, spot.bloomStart, spot.bloomEnd)) return false;
      if (beginner && !spot.beginner) return false;
      return true;
    }).map(spot => {
      const sun = solarPosition(selectedDate(), Number(spot.lat), Number(spot.lng));
      return { ...spot, _light: lightCondition(spot, sun), _sun: sun, _sunset: spot.kind === "nonTrain" ? sunsetInfo(selectedDate(), Number(spot.lat), Number(spot.lng)) : null };
    });

    const sort = $("#sort-order").value;
    state.results.sort((a, b) => sort === "distance"
      ? (positiveNumber(a.walk) ?? Number.POSITIVE_INFINITY) - (positiveNumber(b.walk) ?? Number.POSITIVE_INFINITY)
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
        ? directionText(spot)
        : meaningful(spot.subject) ? spot.subject : "";
    const photoSource = safePhotoSource(spot);
    const hasPhoto = Boolean(photoSource || spot.hasPhoto);
    const article = element("article", { className: `spot-card${hasPhoto ? " has-photo" : ""}${sameId(state.selectedId, spot.id) ? " active" : ""}`, attrs: { tabindex: "0" } });
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
    if (spot.kind === "train" && spot._light) append(lightRow, element("span", { className: `light-chip ${spot._light.key}`, text: spot._light.label }));
    else if (spot._sunset) append(lightRow,
      element("span", { className: "sunset-chip", text: `日没 ${spot._sunset.time}` }),
      element("span", { className: "sunset-chip", text: `方位 ${spot._sunset.azimuth}°` })
    );
    const meta = element("div", { className: "card-meta" });
    if (positiveNumber(spot.walk)) append(meta, element("span", { text: `徒歩${positiveNumber(spot.walk)}分` }));
    if (meaningful(spot.lens)) append(meta, element("span", { text: spot.lens }));
    if (meaningful(season)) append(meta, element("span", { text: season }));
    if (meaningful(subject)) append(body, element("div", { className: "card-kicker", text: subject }));
    append(body, element("div", { className: "card-title", text: spot.name }));
    if (lightRow.childElementCount) append(body, lightRow);
    if (meta.childElementCount) append(body, meta);
    const footer = element("div", { className: "card-footer" });
    if (meaningful(spot.updated)) append(footer, element("span", { text: `最終確認 ${spot.updated}` }));
    append(footer, element("b", { text: "詳細を見る" }));
    if (hasPhoto) {
      const visual = element("div", { className: "card-visual" });
      const image = element("img");
      image.alt = `${spot.name}の作例`;
      if (photoSource) image.src = photoSource;
      else {
        image.dataset.photoId = String(spot.id);
        image.dataset.loading = "true";
      }
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
    observeThumbnails(cards);
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
    const commonControls = [["#access-filter", "アクセス"]];
    commonControls.forEach(([selector, label]) => {
      const control = $(selector);
      if (control.value) labels.push(`${label}: ${control.selectedOptions[0].textContent}`);
    });
    if (state.kind === "train") {
      const light = $("#light-filter");
      if (light.value) labels.push(`光線: ${light.selectedOptions[0].textContent}`);
      [["#line-filter", "路線"], ["#direction-filter", "方向"]].forEach(([selector, label]) => {
        const control = $(selector);
        if (control.value) labels.push(`${label}: ${control.selectedOptions[0].textContent}`);
      });
    }
    if (state.kind === "nonTrain") {
      state.selectedGenres.forEach(key => {
        const name = knownGenres().find(value => genreKey(value) === key) || key;
        labels.push(`ジャンル: ${name}`);
      });
      if ($("#season-filter").checked) labels.push("指定月に見頃");
    }
    if ($("#beginner-filter").checked) labels.push("初心者向け");
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
    return (spot.directions || []).map(direction => {
      const label = direction === "up" ? String(spot.upLabel || "").trim() : String(spot.downLabel || "").trim();
      return `${direction === "up" ? "上り" : "下り"}${label ? `（${label}）` : ""}`;
    }).join("／");
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

  function initializeDetailLocationMap(container, spot) {
    if (!window.L || !container.isConnected) return;
    const lat = Number(spot.lat);
    const lng = Number(spot.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (state.detailMap) state.detailMap.remove();
    const map = L.map(container, { zoomControl: true, attributionControl: true }).setView([lat, lng], 15);
    state.detailMap = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);
    L.circleMarker([lat, lng], {
      radius: 6,
      color: "#FFFFFF",
      fillColor: spot.kind === "train" ? "#0A5C2E" : "#9C5A24",
      fillOpacity: 1,
      weight: 2
    }).addTo(map);
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }

  function detailLocationSection(spot) {
    const map = element("div", { className: "detail-location-map", attrs: { "aria-label": `${spot.name}の地図` } });
    requestAnimationFrame(() => requestAnimationFrame(() => initializeDetailLocationMap(map, spot)));
    return detailSection("撮影地点", map);
  }

  function dataList(items) {
    const list = element("dl", { className: "data-list" });
    items.forEach(([term, value]) => append(list, element("dt", { text: term }), element("dd", { text: value })));
    return list;
  }

  function displayDateTime(value) {
    if (!meaningful(value)) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  }

  function displayHistoryDateTime(value) {
    if (!meaningful(value)) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date);
  }

  function replaceSpot(updated) {
    const normalized = normalizeSpot(updated);
    state.spots = [normalized, ...state.spots.filter(item => !sameId(item.id, normalized.id))];
    saveApiCache(state.spots);
    fillOptions();
    filterResults();
    return normalized;
  }

  function showConflict(error) {
    state.conflictCurrent = error?.payload?.current || null;
    const current = state.conflictCurrent;
    const summary = $("#conflict-summary");
    summary.replaceChildren();
    if (current) append(summary,
      element("dt", { text: "最終更新者" }), element("dd", { text: current.updatedByName || "不明" }),
      element("dt", { text: "最終更新日" }), element("dd", { text: displayDateTime(current.updatedAt) })
    );
    $("#conflict-dialog").showModal();
  }

  async function confirmSpot(spot) {
    if (!window.confirm("最終確認日を今日に更新し、確認者を記録しますか？")) return;
    try {
      const updated = replaceSpot(await api(`/v1/spots/${encodeURIComponent(spot.id)}/verify`, {
        method: "POST", body: JSON.stringify({ expectedRevision: spot.revision })
      }));
      $("#spot-dialog").close();
      openDetail(updated);
      showToast("最終確認日と確認者を更新しました");
    } catch (error) {
      if (error.status === 409) showConflict(error);
      else showToast(error.message || "確認情報を更新できませんでした");
    }
  }

  async function moveSpotToTrash(spot) {
    if (!window.confirm(`「${spot.name}」をゴミ箱へ移動しますか？30日間は復元できます。`)) return;
    try {
      await api(`/v1/spots/${encodeURIComponent(spot.id)}`, {
        method: "DELETE", body: JSON.stringify({ expectedRevision: spot.revision })
      });
      state.spots = state.spots.filter(item => !sameId(item.id, spot.id));
      saveApiCache(state.spots);
      $("#spot-dialog").close();
      filterResults();
      showToast("撮影地をゴミ箱へ移動しました");
    } catch (error) {
      if (error.status === 409) showConflict(error);
      else showToast(error.message || "ゴミ箱へ移動できませんでした");
    }
  }

  const HISTORY_ACTIONS = Object.freeze({
    create: "登録しました", update: "編集", verify: "最終確認日を更新", trash: "ゴミ箱へ移動",
    restore: "復元", photo_add: "作例写真を追加", photo_replace: "作例写真を交換", photo_remove: "作例写真を削除"
  });

  const HISTORY_FIELDS = Object.freeze({
    schemaVersion: "データ形式", kind: "種類", name: "名称", area: "市区町村・場所",
    line: "路線", section: "区間", subject: "ジャンル", upLabel: "上り方面", downLabel: "下り方面",
    lens: "推奨レンズ", capacity: "定員目安", tripod: "三脚の可否", access: "撮影位置・アクセス",
    memo: "メモ", updated: "最終確認日", verifiedAt: "最終確認日時", verifiedBy: "確認者",
    lat: "緯度", lng: "経度", bearing: "カメラ方位", walk: "駅から徒歩",
    bloomStart: "見頃開始月", bloomEnd: "見頃終了月", directions: "対象方向",
    features: "特徴", beginner: "初心者向け", verified: "旧確認状態", photo: "作例写真",
    deletedAt: "削除日時"
  });

  function historyValue(value) {
    if (value === null || value === undefined || value === "") return "未入力";
    if (value === true) return "はい";
    if (value === false) return "いいえ";
    if (Array.isArray(value)) {
      return value.map(item => item === "up" ? "上り" : item === "down" ? "下り" : String(item)).join("・") || "未入力";
    }
    if (value === "train") return "列車";
    if (value === "nonTrain") return "その他";
    return String(value);
  }

  async function openHistory(spot) {
    const list = $("#history-list");
    list.replaceChildren(element("p", { className: "empty-dialog", text: "履歴を読み込んでいます" }));
    $("#history-dialog").showModal();
    try {
      const response = await api(`/v1/spots/${encodeURIComponent(spot.id)}/history`);
      const entries = (response.items || []).map(item => {
        const entry = element("section", { className: "history-entry" });
        const head = element("header");
        append(head, element("b", { text: `${item.actorName || "利用者"}／${HISTORY_ACTIONS[item.action] || item.action}` }),
          element("time", { text: displayHistoryDateTime(item.changedAt) }));
        const changes = element("ul");
        if (item.action !== "create") (item.changes || []).forEach(change => append(changes, element("li", {
          text: `${HISTORY_FIELDS[change.field] || "項目"}: ${historyValue(change.before)} → ${historyValue(change.after)}`
        })));
        append(entry, head);
        if (changes.childElementCount) append(entry, changes);
        return entry;
      });
      list.replaceChildren(...(entries.length ? entries : [element("p", { className: "empty-dialog", text: "履歴はありません" })]));
    } catch (error) {
      list.replaceChildren(element("p", { className: "empty-dialog", text: error.message || "履歴を取得できませんでした" }));
    }
  }

  async function restoreFromTrash(spot) {
    try {
      const restored = replaceSpot(await api(`/v1/spots/${encodeURIComponent(spot.id)}/restore`, {
        method: "POST", body: JSON.stringify({ expectedRevision: spot.revision })
      }));
      showToast(`「${restored.name}」を復元しました`);
      await openTrash();
    } catch (error) {
      if (error.status === 409) showConflict(error);
      else showToast(error.message || "撮影地を復元できませんでした");
    }
  }

  async function permanentlyDeleteFromTrash(spot) {
    const message = `「${spot.name}」を完全に削除します。編集履歴・作例写真・全利用者のお気に入りも削除され、元に戻せません。実行しますか？`;
    if (!window.confirm(message)) return;
    try {
      await api(`/v1/spots/${encodeURIComponent(spot.id)}/permanent`, { method: "DELETE" });
      forgetSpotPhotos(spot.id);
      showToast("撮影地を完全に削除しました");
      await openTrash();
    } catch (error) {
      showToast(error.message || "完全削除できませんでした");
    }
  }

  async function openTrash() {
    const dialog = $("#trash-dialog");
    const list = $("#trash-list");
    list.replaceChildren(element("p", { className: "empty-dialog", text: "ゴミ箱を読み込んでいます" }));
    if (!dialog.open) dialog.showModal();
    try {
      const response = await api("/v1/spots/trash");
      const entries = (response.items || []).map(spot => {
        const entry = element("section", { className: "trash-entry" });
        const text = element("div");
        append(text,
          element("h3", { text: spot.name }),
          element("p", { className: "trash-meta", text: `削除者：${spot.deletedByName || "不明"}` }),
          element("time", { text: `削除 ${displayDateTime(spot.deletedAt)}／完全削除予定 ${displayDateTime(spot.purgeAt)}` })
        );
        const actions = element("div", { className: "detail-actions" });
        const restore = element("button", { text: "復元", attrs: { type: "button" } });
        restore.addEventListener("click", () => restoreFromTrash(spot));
        append(actions, restore);
        if (state.me?.canManage) {
          const permanent = element("button", { className: "danger-action", text: "完全削除", attrs: { type: "button" } });
          permanent.addEventListener("click", () => permanentlyDeleteFromTrash(spot));
          append(actions, permanent);
        }
        return append(entry, text, actions);
      });
      list.replaceChildren(...(entries.length ? entries : [element("p", { className: "empty-dialog", text: "ゴミ箱は空です" })]));
    } catch (error) {
      list.replaceChildren(element("p", { className: "empty-dialog", text: error.message || "ゴミ箱を取得できませんでした" }));
    }
  }

  function openDetail(raw) {
    const sun = solarPosition(selectedDate(), Number(raw.lat), Number(raw.lng));
    const spot = { ...raw, _light: raw._light || lightCondition(raw, sun), _sunset: raw._sunset || sunsetInfo(selectedDate(), Number(raw.lat), Number(raw.lng)) };
    const dialog = $("#spot-dialog");
    const container = $("#spot-detail");
    const article = element("article", { className: "detail-shell" });
    const header = element("header", { className: "detail-head" });
    const close = element("button", { text: "×", attrs: { type: "button", "aria-label": "閉じる" } });
    append(header, element("h2", { text: spot.name }), close);
    const photoSource = safePhotoSource(spot);
    const hasPhoto = Boolean(photoSource || spot.hasPhoto);
    const grid = element("div", { className: `detail-grid${hasPhoto ? "" : " no-media"}` });
    const content = element("div", { className: "detail-content" });
    const summary = element("div", { className: "condition-summary" });
    if (spot.kind === "train") {
      const conditionValue = directionText(spot);
      const conditionNote = hasBearing(spot) ? `カメラ方位 ${Number(spot.bearing)}°` : "";
      if (spot._light) append(summary, summaryItem("光線", spot._light.label, spot._light.detail));
      if (meaningful(conditionValue) || meaningful(conditionNote)) append(summary, summaryItem("撮影方向", conditionValue, conditionNote));
    } else {
      if (spot._sunset) append(summary, summaryItem("日没", spot._sunset.time, `方位 ${spot._sunset.azimuth}°`));
      if (spot.bloomStart || spot.bloomEnd) append(summary, summaryItem("見頃", `${spot.bloomStart || "?"}〜${spot.bloomEnd || "?"}月`, ""));
    }
    const conditionItems = [];
    if (meaningful(spot.area)) conditionItems.push(["場所", spot.area]);
    const target = spot.kind === "train" ? [spot.line, spot.section].filter(meaningful).join(" ") : spot.subject;
    if (meaningful(target)) conditionItems.push([spot.kind === "train" ? "線区" : "ジャンル", target]);
    if (spot.kind === "train" && meaningful(directionText(spot))) conditionItems.push(["対象方向", directionText(spot)]);
    if (meaningful(spot.lens)) conditionItems.push(["推奨レンズ", spot.lens]);
    if (meaningful(spot.capacity)) conditionItems.push(["定員目安", spot.capacity]);
    if (meaningful(spot.tripod)) conditionItems.push(["三脚", spot.tripod]);
    const access = element("div");
    if (meaningful(spot.access)) append(access, element("p", { text: spot.access }));
    if (positiveNumber(spot.walk)) append(access, append(element("p"), element("b", { text: "徒歩：" }), `${positiveNumber(spot.walk)}分`));
    const actions = element("div", { className: "detail-actions" });
    const mapLink = element("a", { text: "地図アプリで開く", attrs: { target: "_blank", rel: "noopener noreferrer" } });
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(spot.lat)},${Number(spot.lng)}`)}`;
    const favorite = element("button", { text: isFavorite(spot.id) ? "お気に入り保存済み" : "お気に入りに保存", attrs: { type: "button" } });
    const archive = element("a", { text: "撮影記録を開く" });
    archive.href = "/photo-archive.html";
    append(actions, mapLink, favorite, archive);
    append(content, summary);
    if (conditionItems.length) append(content, detailSection("撮影条件", dataList(conditionItems)));
    append(content, detailLocationSection(spot));
    if (access.childElementCount) append(content, detailSection("アクセス", access));
    if (String(spot.memo || "").trim()) append(content, detailSection("メモ", element("div", { className: "memo-box", text: spot.memo })));
    const audit = element("dl", { className: "detail-audit" });
    append(audit,
      element("dt", { text: "登録者" }), element("dd", { text: spot.ownerDisplayName || "不明" }),
      element("dt", { text: "最終更新者" }), element("dd", { text: spot.updatedByName || spot.ownerDisplayName || "不明" }),
      element("dt", { text: "最終更新日" }), element("dd", { text: displayDateTime(spot.updatedAt) })
    );
    if (meaningful(spot.updated)) append(audit,
      element("dt", { text: "最終確認" }), element("dd", { text: `${spot.updated}${meaningful(spot.verifiedBy) ? `／${spot.verifiedBy}` : ""}` })
    );
    append(content, audit);
    const confirm = element("button", { text: "最終確認日を更新", attrs: { type: "button" } });
    const edit = element("button", { text: "編集", attrs: { type: "button" } });
    const history = element("button", { text: "履歴", attrs: { type: "button" } });
    const remove = element("button", { className: "danger-action", text: "ゴミ箱へ移動", attrs: { type: "button" } });
    append(content, actions);
    actions.prepend(confirm, edit, history);
    append(actions, remove);
    let protectedImage = null;
    if (hasPhoto) {
      const media = element("div", { className: "detail-media" });
      const image = element("img");
      image.alt = `${spot.name}の作例`;
      if (photoSource) image.src = photoSource;
      else { image.dataset.loading = "true"; protectedImage = image; }
      append(media, image, element("span", { className: "media-caption", text: "作例写真／撮影前に現地の最新状況を確認してください" }));
      append(grid, media);
    }
    append(grid, content);
    append(article, header, grid);
    container.replaceChildren(article);
    close.addEventListener("click", () => {
      dialog.close();
      if (state.detailMap) { state.detailMap.remove(); state.detailMap = null; }
    });
    confirm.addEventListener("click", () => confirmSpot(spot));
    edit.addEventListener("click", () => {
      dialog.close();
      if (state.detailMap) { state.detailMap.remove(); state.detailMap = null; }
      openEditor(spot);
    });
    history.addEventListener("click", () => openHistory(spot));
    remove.addEventListener("click", () => moveSpotToTrash(spot));
    favorite.addEventListener("click", () => {
      toggleFavorite(spot.id);
      dialog.close();
      openDetail(state.spots.find(item => sameId(item.id, spot.id)));
    });
    dialog.showModal();
    if (protectedImage) loadProtectedImage(protectedImage, spot.id, "original");
  }

  async function toggleFavorite(id) {
    if (state.favoriteSyncing) return;
    const key = String(id);
    const removing = state.favorites.has(key);
    removing ? state.favorites.delete(key) : state.favorites.add(key);
    saveFavorites();
    filterResults();
    state.favoriteSyncing = true;
    try {
      await api(`/v1/spots/${encodeURIComponent(key)}/favorite`, { method: removing ? "DELETE" : "PUT" });
      showToast(removing ? "お気に入りから外しました" : "お気に入りに保存しました");
    } catch (error) {
      removing ? state.favorites.add(key) : state.favorites.delete(key);
      saveFavorites();
      filterResults();
      showToast(error.message || "お気に入りを更新できませんでした");
    } finally {
      state.favoriteSyncing = false;
    }
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  async function authenticatedFetch(path, options = {}, retryAuth = true) {
    let user;
    try { user = await window.TayunetFirebaseDataAuth.currentUser(); }
    catch (_) { throw new Error("ログイン情報を確認できません。再ログインしてください"); }
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${await user.getIdToken(!retryAuth)}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(`${API}${path}`, { ...options, headers, signal: controller.signal, mode: "cors", cache: "no-store" });
    } catch (error) {
      throw new Error(error.name === "AbortError" ? "撮影地サーバーからの応答がありません" : "撮影地サーバーに接続できません");
    } finally { clearTimeout(timer); }
    if (response.status === 401 && retryAuth) return authenticatedFetch(path, options, false);
    return response;
  }

  async function api(path, options = {}, retryAuth = true) {
    const response = await authenticatedFetch(path, options, retryAuth);
    if (!response.ok) {
      let document = {};
      try { document = await response.json(); } catch (_) {}
      const detail = document.detail;
      const message = typeof detail === "object" ? detail.message : String(detail || "");
      const error = new Error(message || `撮影地サーバーでエラーが発生しました（${response.status}）`);
      error.status = response.status;
      error.payload = typeof detail === "object" ? detail : {};
      throw error;
    }
    return response.json();
  }

  async function apiBlob(path) {
    const response = await authenticatedFetch(path);
    if (!response.ok) throw new Error(`作例写真を取得できません（${response.status}）`);
    const blob = await response.blob();
    if (!String(blob.type || "").startsWith("image/")) throw new Error("作例写真の形式が不正です");
    return blob;
  }

  async function loadProtectedImage(image, spotId, variant = "thumbnail") {
    const key = `${spotId}:${variant}`;
    try {
      let source = state.photoUrls.get(key);
      if (!source) {
        let request = state.photoRequests.get(key);
        if (!request) {
          request = apiBlob(`/v1/spots/${encodeURIComponent(spotId)}/media/${variant}`).then(blob => {
            const value = URL.createObjectURL(blob);
            state.photoUrls.set(key, value);
            state.photoRequests.delete(key);
            return value;
          });
          state.photoRequests.set(key, request);
        }
        source = await request;
      }
      if (image.isConnected) image.src = source;
    } catch (_) {
      state.photoRequests.delete(key);
      image.closest(".card-visual, .detail-media")?.remove();
      image.closest(".spot-card")?.classList.remove("has-photo");
    } finally {
      delete image.dataset.loading;
    }
  }

  function forgetSpotPhotos(spotId) {
    ["thumbnail", "original"].forEach(variant => {
      const key = `${spotId}:${variant}`;
      const source = state.photoUrls.get(key);
      if (source) URL.revokeObjectURL(source);
      state.photoUrls.delete(key);
      state.photoRequests.delete(key);
    });
  }

  function observeThumbnails(root) {
    const images = $$('img[data-photo-id]', root);
    if (!("IntersectionObserver" in window)) {
      images.forEach(image => loadProtectedImage(image, image.dataset.photoId));
      return;
    }
    if (!state.photoObserver) {
      state.photoObserver = new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        state.photoObserver.unobserve(entry.target);
        loadProtectedImage(entry.target, entry.target.dataset.photoId);
      }), { root: null, rootMargin: "80px" });
    }
    images.forEach(image => state.photoObserver.observe(image));
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

  async function synchronizeFavorites() {
    const account = await api("/v1/spots/favorites");
    let ids = new Set((account.items || []).map(String));
    if (!localStorage.getItem(FAVORITE_IMPORT_KEY)) {
      const localIds = [...state.favorites];
      if (localIds.length) {
        const imported = await api("/v1/spots/favorites/import", {
          method: "POST", body: JSON.stringify({ spotIds: localIds })
        });
        ids = new Set((imported.items || []).map(String));
      }
      localStorage.setItem(FAVORITE_IMPORT_KEY, new Date().toISOString());
    }
    state.favorites = ids;
    saveFavorites();
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
    const [response, me] = await Promise.all([api("/v1/spots"), api("/v1/me")]);
    state.spots = Array.isArray(response.items) ? response.items.map(normalizeSpot) : [];
    state.me = me;
    state.apiReady = true;
    saveApiCache(state.spots);
    await synchronizeFavorites();
    fillOptions();
    filterResults();
  }

  function resetFilters() {
    state.kind = "all";
    state.selectedGenres.clear();
    $$(".category-tabs button").forEach(button => button.classList.toggle("active", button.dataset.kind === "all"));
    ["#keyword-filter", "#line-filter", "#direction-filter", "#light-filter", "#access-filter"].forEach(selector => { $(selector).value = ""; });
    $("#season-filter").checked = false;
    $("#beginner-filter").checked = false;
    renderGenreFilters();
    setContextFilters();
    filterResults();
  }

  function updateEditorFields() {
    const isTrain = $("#editor-kind").value === "train";
    const trainFields = $("#editor-train-fields");
    const nonTrainFields = $("#editor-non-train-fields");
    trainFields.hidden = !isTrain;
    nonTrainFields.hidden = isTrain;
    $$("input, select, textarea", trainFields).forEach(control => { control.disabled = !isTrain; });
    $$("input, select, textarea", nonTrainFields).forEach(control => {
      control.disabled = isTrain;
      if (!isTrain && (control.name === "bloomStart" || control.name === "bloomEnd") && control.value === "0") {
        control.value = "";
      }
    });
    updateDirectionFields();
    updateSubjectStatus();
  }

  function updateDirectionFields() {
    const mode = $("#editor-direction").value;
    const isTrain = $("#editor-kind").value === "train";
    const up = $("#editor-up-label");
    const down = $("#editor-down-label");
    const showUp = isTrain && ["up", "both"].includes(mode);
    const showDown = isTrain && ["down", "both"].includes(mode);
    up.hidden = !showUp;
    down.hidden = !showDown;
    $("input", up).disabled = !showUp;
    $("input", down).disabled = !showDown;
  }

  function updateSubjectStatus() {
    const input = $("#editor-subject");
    const normalized = normalizeGenreName(input.value);
    if (!normalized || $("#editor-kind").value !== "nonTrain") {
      $("#subject-status").textContent = "";
      return;
    }
    const exists = knownGenres().some(name => genreKey(name) === genreKey(normalized));
    $("#subject-status").textContent = exists ? "登録済みのジャンルを使用します" : "新しい名前として登録します";
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
    if (center) state.editorMap.setView([lat, lng], 15);
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

  function openEditor(spot = null) {
    const dialog = $("#editor-dialog");
    const form = $("#spot-form");
    state.editingId = spot?.id ? String(spot.id) : null;
    state.editingRevision = spot?.revision || null;
    $("#editor-title").textContent = spot ? "撮影地を編集" : "撮影地を追加";
    form.reset();
    if (spot) {
      ["kind", "name", "area", "line", "upLabel", "downLabel", "bearing", "subject", "bloomStart", "bloomEnd", "lat", "lng", "walk", "lens", "tripod", "access", "memo"].forEach(name => {
        const control = form.elements[name];
        if (control && spot[name] !== undefined && spot[name] !== null) {
          control.value = name === "walk" && !positiveNumber(spot[name]) ? "" : String(spot[name]);
        }
      });
      const directions = Array.isArray(spot.directions) ? spot.directions : [];
      form.elements.directionMode.value = directions.includes("up") && directions.includes("down") ? "both" : directions.includes("up") ? "up" : directions.includes("down") ? "down" : "";
      form.elements.beginner.checked = spot.beginner === true;
    }
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

  async function saveSpot(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("photo");
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    if (file && file.size > 2 * 1024 * 1024) { showToast("写真は2MB以下にしてください"); return; }
    if (file && file.size && !allowedTypes.has(file.type)) { showToast("写真はPNG・JPEG・GIF・WebP形式にしてください"); return; }
    const kind = String(data.get("kind") || "nonTrain");
    const isTrain = kind === "train";
    const existing = state.editingId ? state.spots.find(item => sameId(item.id, state.editingId)) : null;
    const directionMode = isTrain ? String(data.get("directionMode") || "") : "";
    const directions = directionMode === "both" ? ["up", "down"] : ["up", "down"].includes(directionMode) ? [directionMode] : [];
    const spot = {
      ...(existing || {}),
      clientId: existing?.clientId || `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      schemaVersion: SCHEMA_VERSION,
      kind: isTrain ? "train" : "nonTrain",
      name: String(data.get("name") || "").trim(),
      area: String(data.get("area") || "").trim(),
      line: isTrain ? String(data.get("line") || "").trim() : "",
      subject: isTrain ? "" : canonicalGenre(data.get("subject")),
      lat: Number(data.get("lat")),
      lng: Number(data.get("lng")),
      bearing: isTrain && String(data.get("bearing") || "").trim() ? Number(data.get("bearing")) : null,
      directions,
      upLabel: isTrain ? String(data.get("upLabel") || "").trim() : "",
      downLabel: isTrain ? String(data.get("downLabel") || "").trim() : "",
      walk: Number(data.get("walk") || 0),
      beginner: data.get("beginner") === "on",
      verified: existing?.verified === true,
      updated: existing?.updated || "",
      bloomStart: isTrain ? 0 : Number(data.get("bloomStart") || 0),
      bloomEnd: isTrain ? 0 : Number(data.get("bloomEnd") || 0),
      lens: String(data.get("lens") || "").trim(),
      capacity: "",
      tripod: String(data.get("tripod") || "").trim(),
      access: String(data.get("access") || "").trim(),
      memo: String(data.get("memo") || ""),
      features: existing?.features || []
    };
    if (existing) spot.expectedRevision = state.editingRevision;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "保存中";
    try {
      let saved = await api(existing ? `/v1/spots/${encodeURIComponent(existing.id)}` : "/v1/spots", {
        method: existing ? "PATCH" : "POST", body: JSON.stringify(spot)
      });
      if (file && file.size) {
        const upload = new FormData();
        upload.set("file", file);
        upload.set("expectedRevision", String(saved.revision));
        saved = await api(`/v1/spots/${encodeURIComponent(saved.id)}/photo`, { method: "PUT", body: upload });
        forgetSpotPhotos(saved.id);
      }
      replaceSpot(saved);
    } catch (error) {
      if (error.status === 409) { showConflict(error); return; }
      showToast(error.message || "撮影地を保存できませんでした");
      return;
    } finally {
      submit.disabled = false;
      submit.textContent = "撮影地を保存";
    }
    fillOptions();
    $("#editor-dialog").close();
    form.reset();
    state.editingId = null;
    state.editingRevision = null;
    updateEditorFields();
    if (state.editorMarker) { state.editorMarker.remove(); state.editorMarker = null; }
    $("#editor-map-status").textContent = "地図をクリックまたはタップして位置を指定";
    showToast(existing ? "撮影地を更新しました" : "撮影地をサーバーに保存しました");
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
    $("#spot-dialog").addEventListener("close", () => {
      if (state.detailMap) { state.detailMap.remove(); state.detailMap = null; }
    });
    ["#plan-date", "#plan-time"].forEach(selector => $(selector).addEventListener("change", filterResults));
    ["#keyword-filter", "#line-filter", "#direction-filter", "#light-filter", "#access-filter", "#season-filter", "#beginner-filter", "#sort-order"].forEach(selector => {
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
    $("#filter-close").addEventListener("click", () => {
      document.body.classList.remove("filters-open");
      $("#filter-toggle").setAttribute("aria-expanded", "false");
      $("#filter-toggle").focus();
    });
    $("#add-spot-button").addEventListener("click", () => openEditor());
    $$('[data-close]').forEach(button => button.addEventListener("click", () => {
      const dialog = $(`#${button.dataset.close}`);
      if (dialog?.open) dialog.close();
    }));
    $("#trash-button").addEventListener("click", () => {
      headerMenu.open = false;
      openTrash();
    });
    $("#conflict-reload").addEventListener("click", () => {
      if (!state.conflictCurrent) return;
      const current = replaceSpot(state.conflictCurrent);
      $("#conflict-dialog").close();
      if ($("#editor-dialog").open) $("#editor-dialog").close();
      openDetail(current);
    });
    $("#editor-kind").addEventListener("change", updateEditorFields);
    $("#editor-direction").addEventListener("change", updateDirectionFields);
    $("#editor-subject").addEventListener("input", updateSubjectStatus);
    $("#editor-subject").addEventListener("blur", () => {
      $("#editor-subject").value = canonicalGenre($("#editor-subject").value);
      updateSubjectStatus();
    });
    [$("#spot-form").elements.lat, $("#spot-form").elements.lng].forEach(input => input.addEventListener("change", syncEditorMapFromInputs));
    $("#spot-form").addEventListener("submit", saveSpot);
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
    sunsetInfo,
    monthInRange,
    angularDistance,
    normalizeGenreName,
    positiveNumber,
    hasBearing,
    authenticatedName,
    normalizeSpot,
    migrateItems,
    remapFavorites
  });
  document.addEventListener("DOMContentLoaded", initialize);
})();
