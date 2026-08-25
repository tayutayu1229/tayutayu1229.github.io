(function () {
  "use strict";
  const API = "https://photo-api.tayunet-traininfo.com";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { scope: "mine", view: "grid", photos: [], albums: [], files: [], blobs: new Map(), map: null, mapLayer: null, mapRenderer: null, leafletPromise: null, mapRenderId: 0, detailRenderId: 0, currentUser: null, firebaseDirectory: null, uploadAllowedUids: new Set(), uploadAllowedGroupIds: new Set(), access: { canUpload: true, canManage: false, role: "contributor" } };
  // 運用担当者はこの配列だけを編集すれば、登録・編集・検索の全選択肢へ反映されます。
  const PHOTO_CATEGORIES = Object.freeze([
    { value: "train", label: "定期旅客列車" }, { value: "freight", label: "貨物列車" },
    { value: "deadhead", label: "回送列車" }, { value: "test_run", label: "試運転列車" },
    { value: "special_passenger", label: "多客・旅客臨・団臨等" }, { value: "distribution", label: "配給列車" },
    { value: "engineering", label: "工事列車" }, { value: "shinkansen", label: "新幹線" },
    { value: "private_railway", label: "私鉄" }, { value: "road_transport", label: "陸送" },
    { value: "car", label: "車" }, { value: "aviation", label: "航空" },
    { value: "landscape", label: "風景" }, { value: "other", label: "その他" },
  ]);
  const labels = { mine: "個人一覧", shared: "共有一覧", public: "全体公開", albums: "アルバム", map: "マップ", calendar: "カレンダー", trash: "ゴミ箱" };

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const dateText = value => value ? String(value).replace("T", " ").slice(0, 16) : "未記録";
  const bytes = value => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
  const visibility = value => ({ private: "自分のみ", users: "特定メンバー", link: "限定リンク", public: "全体公開" })[value] || value;
  const category = value => PHOTO_CATEGORIES.find(item => item.value === value)?.label || value || "その他";
  const categoryOptions = (selected = "", includeBlank = false) => `${includeBlank ? '<option value="">すべて</option>' : ""}${PHOTO_CATEGORIES.map(item=>`<option value="${item.value}" ${item.value===selected?"selected":""}>${escapeHtml(item.label)}</option>`).join("")}`;
  $("#category-filter").innerHTML=categoryOptions("",true);$("#upload-category").innerHTML=categoryOptions("other");

  const statusMessage = (status, detail = "") => detail || ({
    400: "入力内容を確認してください。",
    401: "ログインの有効期限が切れました。いったんログアウトして、もう一度ログインしてください。",
    403: "この操作を行う権限がありません。",
    404: "対象の写真または情報が見つかりません。再読み込みしてください。",
    409: "同じ内容が既に登録されています。",
    413: "ファイルが大きすぎます。写真の容量を小さくしてから再度お試しください。",
    415: "この画像形式は利用できません。JPEG・PNG・WebPなど、一般的な画像形式へ変換してからお試しください。",
    429: "操作が集中しています。少し待ってから再度お試しください。",
  })[status] || (status >= 500 ? "写真サーバーで一時的な問題が発生しました。しばらく待ってから再度お試しください。" : "処理に失敗しました。もう一度お試しください。");

  function friendlyError(error, fallback = "処理に失敗しました。") {
    if (!error) return fallback;
    if (error.name === "AbortError") return "通信が時間内に完了しませんでした。通信状態を確認して再度お試しください。";
    return error.userMessage || error.message || fallback;
  }

  function updateClock() {
    const clock = $("#system-clock");
    if (clock) clock.textContent = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  }
  updateClock(); setInterval(updateClock, 1000);

  async function api(path, options = {}, retryAuth = true, retryTransient = true) {
    const { timeoutMs = 30000, ...requestOptions } = options;
    let user;
    try { user = await window.TayunetFirebaseDataAuth.currentUser(); }
    catch (error) { const wrapped = new Error("ログイン情報を確認できません。再ログインしてください。"); wrapped.cause = error; throw wrapped; }
    const headers = new Headers(options.headers || {});
    try { headers.set("Authorization", `Bearer ${await user.getIdToken(!retryAuth)}`); }
    catch (error) { const wrapped=new Error("ログインの確認に失敗しました。いったんログアウトして、もう一度ログインしてください。");wrapped.cause=error;throw wrapped; }
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try { response = await fetch(`${API}${path}`, { ...requestOptions, headers, signal: controller.signal, mode: "cors", cache: "no-store" }); }
    catch (error) { if(error.name==="AbortError")throw error;const wrapped=new Error("写真APIに接続できません。通信状態を確認し、少し待ってから再度お試しください。");wrapped.cause=error;throw wrapped; }
    finally { clearTimeout(timeout); }
    if (response.status === 401 && retryAuth) return api(path, options, false, retryTransient);
    const method = String(requestOptions.method || "GET").toUpperCase();
    if (retryTransient && ["GET", "HEAD"].includes(method) && [502, 503, 504].includes(response.status)) {
      await new Promise(resolve => setTimeout(resolve, 700));
      return api(path, options, retryAuth, false);
    }
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).detail || ""; } catch (_) {}
      const error = new Error(statusMessage(response.status, detail)); error.status = response.status; error.userMessage = error.message; throw error;
    }
    return response;
  }

  function notify(message, error = false, persistent = false) {
    const element = $("#notice"); element.textContent = message; element.className = `notice ${error ? "error" : "success"}`; element.hidden = false;
    clearTimeout(notify.timer); if(!persistent)notify.timer = setTimeout(() => { element.hidden = true; }, error ? 10000 : 7000);
  }

  function setContentLoading(active, message = "写真を読み込んでいます…") {
    const content = $(".content"), loading = $("#content-loading");
    content.classList.toggle("is-loading", active); content.setAttribute("aria-busy", String(active));
    loading.hidden = !active; $("#content-loading-text").textContent = message;
  }

  function setButtonBusy(button, busy, label = "処理中") {
    if(!button)return;
    if(busy){button.dataset.idleLabel=button.textContent;button.textContent=label;button.disabled=true;button.setAttribute("aria-busy","true");}
    else{button.textContent=button.dataset.idleLabel||button.textContent;delete button.dataset.idleLabel;button.disabled=false;button.removeAttribute("aria-busy");}
  }

  function setFormStatus(element, message = "", type = "") {
    if(!element)return;element.textContent=message;element.className=`form-status${type?` ${type}`:""}`;element.hidden=!message;
  }

  function updateFriendNotification(count = 0) {
    const incoming = Number(count) || 0;
    [["#friend-notification",String(incoming)],["#menu-notification",String(incoming)],["#mobile-friend-notification",`申請 ${incoming}件`]].forEach(([selector,label])=>{const badge=$(selector);if(!badge)return;badge.textContent=label;badge.hidden=incoming===0;});
    const button=$("#friend-button");if(button)button.setAttribute("aria-label",incoming?`共有メンバー、あなたへの申請${incoming}件`:"共有メンバー");
  }

  async function refreshFriendNotifications() {
    try { const response=await api("/v1/friends"),items=(await response.json()).items;updateFriendNotification(items.filter(item=>item.status==="pending"&&item.incoming).length); }
    catch (_) { updateFriendNotification(0); }
  }

  async function imageUrl(photo, variant = "thumbnail") {
    const key = `${photo.id}:${variant}`;
    if (state.blobs.has(key)) return state.blobs.get(key);
    const response = await api(`/v1/photos/${photo.id}/media/${variant}`);
    const url = URL.createObjectURL(await response.blob()); state.blobs.set(key, url); return url;
  }

  function card(photo) {
    const title = photo.title || photo.trainNumber || photo.filename;
    const route = photo.trainNumber ? `${photo.trainNumber} ${photo.origin || ""}${photo.destination ? ` → ${photo.destination}` : ""}` : (photo.location || category(photo.category));
    return `<article class="photo-card" data-id="${photo.id}"><div class="photo-image loading-card"><img alt="${escapeHtml(title)}" loading="lazy"><span class="photo-badge">${escapeHtml(category(photo.category))}</span></div><div class="photo-body"><div class="photo-title">${escapeHtml(title)}</div><div class="photo-meta"><span>${escapeHtml(dateText(photo.capturedAt).slice(0,10))}</span><span>·</span><span>${escapeHtml(route)}</span></div><div class="photo-tags">${photo.tags.slice(0,4).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div><button class="open-card" aria-label="詳細を開く">詳細</button></article>`;
  }

  async function hydrateImages(root = document) {
    await Promise.all($$(".photo-card", root).map(async element => {
      const photo = state.photos.find(item => item.id === element.dataset.id); if (!photo) return;
      try { const img = $("img", element); img.src = await imageUrl(photo); img.onload = () => $(".photo-image", element).classList.remove("loading-card"); }
      catch (error) { const frame=$(".photo-image",element);frame.classList.remove("loading-card");frame.classList.add("image-error");frame.innerHTML=`<span>画像を表示できません<br><small>${escapeHtml(friendlyError(error))}</small></span>`; }
    }));
  }

  function fillSuggestions() {
    const specs = [["camera", "#camera-list"], ["lens", "#lens-list"]];
    specs.forEach(([key, selector]) => { $(selector).innerHTML = [...new Set(state.photos.map(item => item[key]).filter(Boolean))].sort().map(value => `<option value="${escapeHtml(value)}">`).join(""); });
    $("#tag-list").innerHTML = [...new Set(state.photos.flatMap(item => item.tags))].sort().map(value => `<option value="${escapeHtml(value)}">`).join("");
  }

  function setPrimarySurface(surface) {
    const surfaces = { grid: "#photo-list", calendar: "#calendar-view", map: "#map-view", albums: "#album-view" };
    Object.entries(surfaces).forEach(([name, selector]) => { $(selector).hidden = name !== surface; });
    const content = $(".content");
    content.dataset.surface = surface;
    content.classList.toggle("dedicated-scope", ["albums", "map", "calendar", "trash"].includes(state.scope));
    const activeView = surface === "albums" ? "" : surface === "calendar" ? "calendar" : surface;
    $$(`[data-view]`).forEach(button => button.classList.toggle("active", button.dataset.view === activeView));
  }

  function updateEmptyState() {
    const empty = $("#empty-state"), title = $("h3", empty), message = $("p", empty);
    const copy = state.scope === "trash"
      ? ["ゴミ箱は空です", "削除した写真は30日間ここに保管され、期間内なら復元できます。"]
      : state.scope === "shared"
        ? ["共有された写真はありません", "ほかのメンバーから共有された写真がここに表示されます。"]
        : state.scope === "public"
          ? ["全体公開の写真はありません", "公開範囲を「全体公開」にした写真がここに表示されます。"]
          : ["該当する写真がありません", "写真を追加するか、絞り込み条件を変えてみてください。"];
    title.textContent = copy[0]; message.textContent = copy[1];
  }

  function renderGrid() {
    state.mapRenderId += 1;
    setPrimarySurface("grid"); updateEmptyState();
    const list = $("#photo-list"); list.className = `photo-grid${state.view === "timeline" ? " timeline" : ""}`;
    list.innerHTML = state.photos.map(card).join("");
    $("#empty-state").hidden = state.photos.length > 0; $("#result-count").textContent = `${state.photos.length}件`;
    hydrateImages(list);
  }

  function monthDays() {
    const byDay = new Map(); state.photos.forEach(photo => { const day = (photo.capturedAt || photo.createdAt || "").slice(0, 10); if (day) byDay.set(day, [...(byDay.get(day) || []), photo]); });
    const months = [...new Set([...byDay.keys()].map(day => day.slice(0, 7)))].sort().reverse();
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const calendar = $("#calendar-view");
    calendar.innerHTML = months.map(month => {
      const [year, monthNumber] = month.split("-").map(Number), first = new Date(year, monthNumber - 1, 1), lastDay = new Date(year, monthNumber, 0).getDate();
      const cells = Array.from({ length: first.getDay() }, () => '<div class="calendar-day is-blank" aria-hidden="true"></div>');
      for (let dayNumber = 1; dayNumber <= lastDay; dayNumber += 1) {
        const key = `${month}-${String(dayNumber).padStart(2, "0")}`, photos = byDay.get(key) || [];
        cells.push(`<div class="calendar-day${photos.length ? " has-photos" : ""}"><time datetime="${key}">${dayNumber}</time><div class="calendar-thumbs">${photos.slice(0, 6).map(photo => `<button class="calendar-photo" data-id="${photo.id}" aria-label="${escapeHtml(photo.title || photo.filename)}の詳細を開く"><img alt="${escapeHtml(photo.title || photo.filename)}"></button>`).join("")}</div>${photos.length ? `<small>${photos.length}枚</small>` : ""}</div>`);
      }
      const count = [...byDay.entries()].filter(([day]) => day.startsWith(month)).reduce((total, [, photos]) => total + photos.length, 0);
      return `<section class="calendar-month"><header><h3>${year}年${monthNumber}月</h3><span>${count}枚</span></header><div class="calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div></section>`;
    }).join("");
    $$(`.calendar-photo`, calendar).forEach(async button => { const photo = state.photos.find(item => item.id === button.dataset.id); try { $("img", button).src = await imageUrl(photo); } catch (error) { button.classList.add("image-error");button.title=friendlyError(error);button.innerHTML="画像取得失敗"; } });
  }

  function renderCalendar() {
    state.mapRenderId += 1;
    setPrimarySurface("calendar"); updateEmptyState(); $("#empty-state").hidden = state.photos.length > 0; monthDays(); $("#result-count").textContent = `${state.photos.length}件`;
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (state.leafletPromise) return state.leafletPromise;
    state.leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector("link[data-photo-map]")) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        stylesheet.dataset.photoMap = "leaflet";
        document.head.append(stylesheet);
      }
      const existing = document.querySelector("script[data-photo-map]");
      const script = existing || document.createElement("script");
      const loaded = () => window.L ? resolve(window.L) : reject(new Error("地図ライブラリの初期化に失敗しました。"));
      script.addEventListener("load", loaded, { once: true });
      script.addEventListener("error", () => reject(new Error("地図ライブラリを読み込めませんでした。")), { once: true });
      if (!existing) {
        script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        script.async = true;
        script.dataset.photoMap = "leaflet";
        document.head.append(script);
      }
    }).catch(error => { state.leafletPromise = null; throw error; });
    return state.leafletPromise;
  }

  async function renderMap() {
    setPrimarySurface("map"); $("#empty-state").hidden = true;
    const renderId = ++state.mapRenderId;
    const located = state.photos.filter(photo => Number.isFinite(photo.latitude) && Number.isFinite(photo.longitude));
    const mapView = $("#map-view");
    $("#result-count").textContent = "地図を準備中";
    mapView.classList.add("map-loading");
    try {
      const Leaflet = await loadLeaflet();
      if (renderId !== state.mapRenderId || mapView.hidden) return;
      if (!state.map) {
        state.map = Leaflet.map("map-view", { preferCanvas: true }).setView([36.2, 138.2], 5);
        Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors", updateWhenIdle: true, keepBuffer: 2 }).addTo(state.map);
        state.mapLayer = Leaflet.layerGroup().addTo(state.map);
        state.mapRenderer = Leaflet.canvas({ padding: 0.35 });
      } else {
        state.mapLayer.clearLayers();
      }
      located.forEach(photo => {
        const marker = Leaflet.circleMarker([photo.latitude, photo.longitude], { renderer: state.mapRenderer, radius: 6, weight: 2, color: "#ffffff", fillColor: "#075b45", fillOpacity: 0.92 });
        marker.bindTooltip(escapeHtml(photo.title || photo.trainNumber || photo.filename), { direction: "top" });
        marker.on("click", () => openDetail(photo.id));
        state.mapLayer.addLayer(marker);
      });
      if (located.length > 1) state.map.fitBounds(located.map(photo => [photo.latitude, photo.longitude]), { padding: [28, 28], maxZoom: 15 });
      else if (located.length === 1) state.map.setView([located[0].latitude, located[0].longitude], 13);
      else state.map.setView([36.2, 138.2], 5);
      requestAnimationFrame(() => state.map.invalidateSize({ pan: false }));
      $("#result-count").textContent = `位置情報あり ${located.length}件`;
    } catch (error) {
      if (renderId === state.mapRenderId) { notify(friendlyError(error,"地図を表示できませんでした。"), true); $("#result-count").textContent = "地図取得失敗"; }
    } finally {
      if (renderId === state.mapRenderId) mapView.classList.remove("map-loading");
    }
  }

  async function renderAlbums() {
    state.mapRenderId += 1;
    setPrimarySurface("albums"); $("#empty-state").hidden = true;
    const response = await api("/v1/albums"); state.albums = (await response.json()).items;
    $("#upload-album").innerHTML = `<option value="">なし</option>${state.albums.map(album => `<option value="${album.id}">${escapeHtml(album.title)}</option>`).join("")}`;
    $("#album-view").innerHTML = `<div class="feature-intro"><div><small>ALBUM LIBRARY</small><h3>アルバムで写真をまとめる</h3><p>テーマ・遠征・列車ごとに写真を整理し、アルバム単位で共有できます。</p></div>${state.access.canUpload ? `<button class="primary" id="new-album">＋ 新しいアルバム</button>` : ""}</div><div class="album-grid">${state.albums.map(album => `<article class="album-card" data-album="${album.id}"><div class="album-cover"><span>${album.photoCount}</span><small>PHOTOS</small></div><h3>${escapeHtml(album.title)}</h3><p>${escapeHtml(album.description || "説明はまだありません")}</p><span>${album.photoCount}枚 · ${visibility(album.visibility)}</span><div class="dialog-actions"><button data-open-album="${album.id}">開く</button><button data-share-album="${album.id}">限定リンク</button></div></article>`).join("") || '<div class="feature-empty"><b>アルバムはまだありません</b><p>「新しいアルバム」から最初のアルバムを作成できます。</p></div>'}</div>`;
    $("#result-count").textContent = `${state.albums.length}件`;
  }

  function queryString() {
    const pairs = { scope: state.scope, q: $("#search-q").value, from: $("#date-from").value, to: $("#date-to").value, category: $("#category-filter").value, train_number: $("#train-filter").value, camera: $("#camera-filter").value, lens: $("#lens-filter").value, tag: $("#tag-filter").value, focal_min: $("#focal-min").value, focal_max: $("#focal-max").value };
    const params = new URLSearchParams(); Object.entries(pairs).forEach(([key, value]) => { if (value) params.set(key, value); }); return params;
  }

  async function loadPhotos() {
    const requestedView = state.scope === "map" ? "map" : state.scope === "calendar" ? "calendar" : state.view;
    const scope = ["map", "calendar"].includes(state.scope) ? "mine" : state.scope;
    const params = queryString(); params.set("scope", scope);
    $("#result-count").textContent = "読み込み中"; setContentLoading(true,state.scope==="albums"?"アルバムを読み込んでいます…":"写真を読み込んでいます…");
    setPrimarySurface(state.scope==="albums"?"albums":requestedView==="map"?"map":requestedView==="calendar"?"calendar":"grid");$("#empty-state").hidden=true;
    try { if(state.scope==="albums"){await renderAlbums();return;}const response = await api(`/v1/photos?${params}`); state.photos = (await response.json()).items; fillSuggestions(); if (requestedView === "map") await renderMap(); else if (requestedView === "calendar") renderCalendar(); else renderGrid(); }
    catch (error) { state.photos=[];if(state.scope==="albums"){setPrimarySurface("albums");$("#album-view").innerHTML='<div class="feature-empty"><b>アルバムを取得できませんでした</b><p>通信が戻ったらアルバムを選び直してください。</p></div>';}else if(requestedView==="map"){setPrimarySurface("map");$("#map-view").innerHTML='<div class="feature-empty"><b>地図を取得できませんでした</b><p>通信状態を確認して再度お試しください。</p></div>';}else if(requestedView==="calendar"){setPrimarySurface("calendar");$("#calendar-view").innerHTML='<div class="feature-empty"><b>カレンダーを取得できませんでした</b><p>通信状態を確認して再度お試しください。</p></div>';}else renderGrid();notify(`${friendlyError(error)}\n通信が戻ったら、一覧を選び直すか検索を再実行してください。`, true, true); $("#result-count").textContent = "取得失敗"; }
    finally { setContentLoading(false); }
  }

  function applyAccess(access) {
    state.access={...state.access,...access};
    const manager=state.access.canManage;
    $("#upload-button").hidden=!state.access.canUpload;
    $("#mobile-upload-button").hidden=!state.access.canUpload;
    $("#access-mode").textContent=manager?"管理モード（登録不可）":"個人アーカイブ";
    const mineTab=$("[data-scope='mine']");if(manager){mineTab.textContent="管理一覧";labels.mine="管理一覧";$("#list-title").textContent="管理一覧";}
    document.body.classList.toggle("manager-mode",manager);
  }

  function setFiltersOpen(open) {
    const enabled = open && window.matchMedia("(max-width: 1180px)").matches;
    document.body.classList.toggle("filters-open", enabled);
    $("#filter-toggle").setAttribute("aria-expanded", String(enabled));
    $("#filter-backdrop").tabIndex = enabled ? 0 : -1;
    if (enabled) setTimeout(() => $("#search-q").focus(), 180);
  }

  function setMobileMenuOpen(open) {
    const enabled = open && window.matchMedia("(max-width: 900px)").matches;
    const menu = $("#mobile-action-menu"), button = $("#mobile-menu-button");
    menu.hidden = !enabled;
    button.setAttribute("aria-expanded", String(enabled));
    button.setAttribute("aria-label", enabled ? "アカウントメニューを閉じる" : "アカウントメニューを開く");
  }

  function dataRows(photo) {
    const focalLength = String(photo.focalLength || "").trim();
    const focalLengthText = focalLength && /mm$/i.test(focalLength) ? focalLength : (focalLength ? `${focalLength} mm` : "");
    const rows = [
      ["列車番号", photo.trainNumber], ["始発・終着", [photo.origin, photo.destination].filter(Boolean).join(" → ")], ["列車種別", photo.trainType], ["始発駅日付", photo.serviceDate], ["変更事項", photo.changes],
      ["撮影日時", dateText(photo.capturedAt)], ["撮影場所", photo.location], ["駅", photo.station], ["輸送経路", photo.transportRoute], ["記事・備考", photo.article], ["フリーメモ", photo.notes],
      ["カメラ", photo.camera], ["レンズ", photo.lens], ["シャッター", photo.shutterSpeed], ["F値", photo.aperture], ["ISO", photo.iso], ["焦点距離", focalLengthText], ["タグ", photo.tags.join(" / ")], ["公開範囲", visibility(photo.visibility)], ["ファイル", `${photo.filename}（${bytes(photo.byteSize)}）`]
    ];
    return rows.filter(([, value]) => value).map(([name, value]) => `<div class="data-group"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  }

  async function openDetail(id) {
    const photo = state.photos.find(item => item.id === id); if (!photo) return;
    const renderId = ++state.detailRenderId;
    const dialog = $("#detail-dialog"); dialog.dataset.photoId = photo.id;
    const manageable = state.access.canManage || photo.ownerUid === (await window.TayunetFirebaseDataAuth.currentUser()).uid;
    if (renderId !== state.detailRenderId) return;
    dialog.innerHTML = `<div class="detail-shell"><div class="detail-top"><h2>${escapeHtml(photo.trainNumber ? `第 ${photo.trainNumber} 列車` : (photo.title || photo.filename))}</h2><button data-close="detail-dialog" aria-label="詳細を閉じる">×</button></div><div class="detail-layout"><div class="detail-photo"><div class="dialog-loading"><div class="spinner"></div><p>原本画像を読み込んでいます…</p></div></div><dl class="detail-data">${dataRows(photo)}</dl></div><div class="detail-actions">${manageable ? `<button data-action="edit">撮影情報を編集</button><button data-action="share">共有する</button><button data-action="download">原本を保存</button>${photo.deletedAt ? `<button data-action="restore">ゴミ箱から復元</button>` : `<button class="danger" data-action="delete">ゴミ箱へ</button>`}` : `<button data-action="download">原本を保存</button>`}</div></div>`;
    dialog.showModal();
    try {
      const url = await imageUrl(photo, "original"), frame = $(".detail-photo", dialog);
      if (renderId !== state.detailRenderId || !dialog.open || dialog.dataset.photoId !== photo.id || !frame) return;
      frame.innerHTML = `<img src="${url}" alt="${escapeHtml(photo.title || photo.filename)}">`;
    } catch (error) {
      const frame = $(".detail-photo", dialog);
      if (renderId !== state.detailRenderId || !dialog.open || dialog.dataset.photoId !== photo.id || !frame) return;
      frame.innerHTML=`<div class="dialog-error"><h2>画像を表示できません</h2><p>${escapeHtml(friendlyError(error))}</p></div>`;
    }
  }

  function input(name, label, photo, options = {}) { const value=name==="capturedAt"?String(photo[name]||"").slice(0,16):(photo[name]??"");const attributes=[options.type&&`type="${options.type}"`,options.step&&`step="${options.step}"`,options.min!==undefined&&`min="${options.min}"`,options.max!==undefined&&`max="${options.max}"`,options.placeholder&&`placeholder="${escapeHtml(options.placeholder)}"`,options.required&&"required",options.maxlength&&`maxlength="${options.maxlength}"`].filter(Boolean).join(" ");return `<label class="${options.span2?"span2":""}">${label}<input name="${name}" value="${escapeHtml(value)}" ${attributes}></label>`; }
  function textarea(name,label,photo,options={}){return `<label class="${options.span2?"span2":""}">${label}<textarea name="${name}" rows="${options.rows||3}" maxlength="${options.maxlength||10000}" placeholder="${escapeHtml(options.placeholder||"")}">${escapeHtml(photo[name]||"")}</textarea></label>`;}
  function mergeSharePeople(friends, directory) {
    const people = new Map();
    friends.filter(item => item.status === "accepted").forEach(item => people.set(item.uid, { ...item, relationship: "accepted" }));
    directory.forEach(item => people.set(item.uid, { ...people.get(item.uid), ...item }));
    return [...people.values()].sort((a, b) => (a.relationship === "accepted" ? -1 : 0) - (b.relationship === "accepted" ? -1 : 0) || personName(a).localeCompare(personName(b), "ja"));
  }
  function sharePersonChoice(person, selected) {
    const relationship = person.relationship === "accepted" || person.status === "accepted" ? "フレンド" : "システム利用者";
    return `<label class="share-choice share-person" data-person-search="${escapeHtml(`${personName(person)} ${person.email}`.toLowerCase())}"><input type="checkbox" name="allowedUids" value="${person.uid}" ${selected.has(person.uid)?"checked":""}><span>${escapeHtml(personName(person))}<small>${escapeHtml(person.email)} · ${relationship}</small></span></label>`;
  }
  function exifSummary(photo) {
    const fields = [["撮影日時",photo.capturedAt],["カメラ",photo.camera],["レンズ",photo.lens],["シャッター",photo.shutterSpeed],["F値",photo.aperture],["ISO",photo.iso],["焦点距離",photo.focalLength],["GPS",Number.isFinite(photo.latitude)&&Number.isFinite(photo.longitude)]];
    const available = fields.filter(([,value])=>value).map(([label])=>label);
    return available.length ? `<div class="exif-status success"><b>保存済みの撮影データ ${available.length}項目</b><span>${available.map(label=>`<em>${escapeHtml(label)}</em>`).join("")}</span><small>アップロード時に画像ファイルのEXIFを自動読取し、空欄の項目へ保存します。編集した値は編集内容を優先します。</small></div>` : `<div class="exif-status"><b>この写真には読取可能なEXIFがありません</b><small>EXIFを削除した画像や一部形式では取得できません。必要な項目は手動入力できます。</small></div>`;
  }
  async function editDetail(photo, focusSharing = false) {
    state.detailRenderId++;
    const dialog=$("#detail-dialog");dialog.innerHTML=`<div class="dialog-loading"><div class="spinner"></div><p>編集に必要な共有先情報を読み込んでいます…</p></div>`;if(!dialog.open)dialog.showModal();
    try {
      const [friendsResponse,groupsResponse,directoryResponse,albumsResponse]=await Promise.all([api("/v1/friends"),api("/v1/groups"),api("/v1/directory"),api("/v1/albums")]);
      const friends=(await friendsResponse.json()).items,groups=(await groupsResponse.json()).items,directory=(await directoryResponse.json()).items,albums=(await albumsResponse.json()).items;
      const editableAlbums=state.access.canUpload?albums:[],albumContents=await Promise.all(editableAlbums.map(async album=>{try{const response=await api(`/v1/albums/${album.id}/photos`),data=await response.json();return {id:album.id,contains:data.items.some(item=>item.id===photo.id)};}catch(_){return {id:album.id,contains:false};}}));
      const selectedUsers=new Set(photo.allowedUids||[]),selectedGroups=photo.allowedGroupIds||[],selectedAlbums=new Set(albumContents.filter(item=>item.contains).map(item=>item.id)),people=mergeSharePeople(friends,directory);
      const friendChoices=people.length?people.map(v=>sharePersonChoice(v,selectedUsers)).join(""):`<p class="field-hint no-share-candidates">共有候補がまだ登録されていません。相手が一度この写真アーカイブへログインすると、ここからすぐ選択できます。</p>`;
      const groupChoices=groups.length?groups.map(v=>`<label class="share-choice"><input type="checkbox" name="allowedGroupIds" value="${v.id}" ${selectedGroups.includes(v.id)?"checked":""}><span>${escapeHtml(v.name)}<small>${v.members.length}人</small></span></label>`).join(""):`<p class="field-hint">グループはまだありません。</p>`;
      const albumChoices=editableAlbums.length?editableAlbums.map(album=>`<label class="share-choice album-choice"><input type="checkbox" name="albumIds" value="${album.id}" ${selectedAlbums.has(album.id)?"checked":""}><span>${escapeHtml(album.title)}<small>${album.photoCount}枚</small></span></label>`).join(""):`<p class="field-hint">アルバムはまだありません。先に「アルバム」画面で作成すると、ここから追加できます。</p>`;
      dialog.innerHTML=`<form class="edit-shell" id="edit-form"><div class="edit-head"><div><small>PHOTO METADATA EDITOR</small><h2>撮影情報を編集</h2></div><button type="button" data-close="detail-dialog" aria-label="編集を閉じる">×</button></div><div class="edit-body"><p class="edit-intro">写真そのものは変更せず、検索・表示に使う撮影情報だけを編集します。</p><div class="edit-sections">
        <fieldset class="edit-section basic"><legend>基本情報</legend><div class="form-grid">${input("title","タイトル（必須）",photo,{required:true,maxlength:1000})}<label>写真の種類<select name="category">${categoryOptions(photo.category)}</select></label>${input("capturedAt","撮影日時",photo,{type:"datetime-local"})}${input("location","撮影場所",photo,{placeholder:"地名・撮影ポイント"})}${input("station","最寄り駅・撮影駅",photo)}<label>タグ（カンマ区切り）<input name="tags" value="${escapeHtml((photo.tags||[]).join(", "))}" placeholder="貨物, 夜景, EF210"></label></div></fieldset>
        <fieldset class="edit-section train"><legend>列車・貨物情報</legend><div class="form-grid">${input("trainNumber","列車番号",photo)}${input("trainType","列車種別",photo)}${input("origin","始発駅",photo)}${input("destination","終着駅",photo)}${input("serviceDate","始発駅日付",photo,{type:"date"})}${input("changes","変更事項",photo)}${input("transportRoute","貨物輸送経路",photo,{span2:true,placeholder:"経由地を含む輸送経路"})}${textarea("article","記事・備考",photo,{span2:true,rows:3})}</div></fieldset>
        <fieldset class="edit-section equipment"><legend>カメラ・撮影設定</legend>${exifSummary(photo)}<div class="form-grid">${input("camera","カメラ",photo)}${input("lens","レンズ",photo)}${input("shutterSpeed","シャッタースピード",photo)}${input("aperture","F値",photo)}${input("iso","ISO感度",photo)}${input("focalLength","焦点距離",photo)}</div></fieldset>
        <fieldset class="edit-section sharing"><legend>位置情報・公開範囲</legend><div class="form-grid">${input("latitude","緯度",photo,{type:"number",step:"any",min:-90,max:90})}${input("longitude","経度",photo,{type:"number",step:"any",min:-180,max:180})}<label class="span2">公開範囲<select name="visibility">${["private","users","link","public"].map(v=>`<option value="${v}" ${photo.visibility===v?"selected":""}>${visibility(v)}</option>`).join("")}</select></label></div><div class="member-picker" id="edit-member-picker"><div class="member-picker-head"><div><b>共有するユーザー</b><small>フレンドでなくても、登録済みのシステム利用者を直接選べます。</small></div><button type="button" data-open-people-from-edit>共有メンバー管理</button></div><label class="member-filter">名前・メールで絞り込み<input id="edit-member-filter" type="search" placeholder="2文字以上で絞り込み"></label><div class="share-choice-grid" id="edit-member-results">${friendChoices}</div><div class="group-choice-area"><b>グループ</b><div class="share-choice-grid">${groupChoices}</div></div></div></fieldset>
        ${state.access.canUpload?`<fieldset class="edit-section albums"><legend>アルバム所属</legend><p class="field-hint">保存すると、選択したアルバムへ追加し、外したアルバムからは取り除きます。</p><div class="share-choice-grid">${albumChoices}</div></fieldset>`:""}
        <fieldset class="edit-section notes"><legend>フリーメモ</legend>${textarea("notes","撮影時の状況・機材メモ・補足",photo,{span2:true,rows:5,placeholder:"撮影時の状況や設定の意図など"})}</fieldset>
      </div><div class="edit-footer"><p class="form-status" id="edit-status" role="status" aria-live="polite" hidden></p><div class="dialog-actions"><button type="button" class="ghost" data-close="detail-dialog">キャンセル</button><button class="primary" id="edit-save-button">変更を保存</button></div></div></div></form>`;
      const editForm=$("#edit-form");
      if(focusSharing){const visibilitySelect=$("select[name='visibility']",editForm);visibilitySelect.value="users";const sharing=$(".edit-section.sharing",editForm);requestAnimationFrame(()=>{sharing.scrollIntoView({block:"start"});$("#edit-member-filter")?.focus();});}
      $("#edit-member-filter").addEventListener("input",event=>{const query=event.currentTarget.value.trim().toLowerCase();$$('.share-person',editForm).forEach(choice=>{choice.hidden=Boolean(query)&&!choice.dataset.personSearch.includes(query);});});
      $("#edit-member-results").addEventListener("change",event=>{if(!event.target.matches('input[name="allowedUids"]'))return;if(event.target.checked)selectedUsers.add(event.target.value);else selectedUsers.delete(event.target.value);});
      editForm.addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget,button=$("#edit-save-button"),status=$("#edit-status");if(!form.reportValidity())return;const raw=Object.fromEntries(new FormData(form));raw.tags=String(raw.tags||"").split(",").map(v=>v.trim()).filter(Boolean);raw.allowedUids=[...selectedUsers];raw.allowedGroupIds=$$('input[name="allowedGroupIds"]:checked',form).map(v=>v.value);if($('input[name="albumIds"]',form))raw.albumIds=$$('input[name="albumIds"]:checked',form).map(v=>v.value);if((raw.latitude&&!raw.longitude)||(!raw.latitude&&raw.longitude)){setFormStatus(status,"位置情報は緯度と経度を両方入力してください。","error");return;}if(raw.visibility==="users"&&!raw.allowedUids.length&&!raw.allowedGroupIds.length){setFormStatus(status,"公開範囲が「特定メンバー」の場合は、共有するユーザーまたはグループを選んでください。","error");return;}setButtonBusy(button,true,"保存中");setFormStatus(status,state.access.canUpload?"撮影情報・共有範囲・アルバム所属を保存しています…":"撮影情報と共有範囲を保存しています…","loading");try{const response=await api(`/v1/photos/${photo.id}`,{method:"PATCH",body:JSON.stringify(raw)});Object.assign(photo,await response.json());setFormStatus(status,"保存しました。","success");await loadPhotos();setTimeout(()=>{if(dialog.open)dialog.close();notify(state.access.canUpload?"撮影情報とアルバム所属を保存しました。":"撮影情報を保存しました。");},500);}catch(error){setFormStatus(status,friendlyError(error),"error");}finally{setButtonBusy(button,false);}});
    } catch(error) { dialog.innerHTML=`<div class="dialog-error"><h2>編集画面を準備できません</h2><p>${escapeHtml(friendlyError(error))}</p><div class="dialog-actions"><button class="ghost" data-close="detail-dialog">閉じる</button><button class="primary" data-retry-edit="${photo.id}">再試行</button></div></div>`; }
  }

  async function prepareUploadSharing(force = false) {
    const panel=$("#upload-member-picker"),status=$("#upload-member-status");
    if(panel.dataset.loaded==="true"&&!force)return;
    setFormStatus(status,"共有できるシステム利用者とグループを読み込んでいます…","loading");
    try {
      const [friendsResponse,directoryResponse,groupsResponse]=await Promise.all([api("/v1/friends"),api("/v1/directory"),api("/v1/groups")]);
      const people=mergeSharePeople((await friendsResponse.json()).items,(await directoryResponse.json()).items),groups=(await groupsResponse.json()).items;
      $("#upload-user-choices").innerHTML=people.map(person=>sharePersonChoice(person,state.uploadAllowedUids)).join("")||'<p class="field-hint no-share-candidates">共有候補がまだ登録されていません。相手が一度この写真アーカイブへログインすると選択できます。</p>';
      $("#upload-group-choices").innerHTML=groups.map(group=>`<label class="share-choice"><input type="checkbox" name="uploadAllowedGroupIds" value="${group.id}" ${state.uploadAllowedGroupIds.has(group.id)?"checked":""}><span>${escapeHtml(group.name)}<small>${group.members.length}人</small></span></label>`).join("");
      $("#upload-group-area").hidden=!groups.length;panel.dataset.loaded="true";
      setFormStatus(status,people.length||groups.length?`${people.length}人・${groups.length}グループから選択できます。`:"共有候補がまだありません。相手が一度ログインした後に「候補を更新」を押してください。",people.length||groups.length?"success":"error");
    } catch(error) { setFormStatus(status,friendlyError(error,"共有候補を読み込めませんでした。"),"error"); }
  }
  async function openUploadDialog() {
    if(!state.access.canUpload)return notify("このアカウントは閲覧・管理専用です。",true);
    const dialog=$("#upload-dialog");if(!dialog.open)dialog.showModal();
    const users=$("#upload-form select[name='visibility']").value==="users";$("#upload-member-picker").hidden=!users;
    if(users)await prepareUploadSharing();
  }
  function uploadMetadata() { const raw = Object.fromEntries(new FormData($("#upload-form"))); raw.tags = raw.tags.split(",").map(value => value.trim()).filter(Boolean); raw.albumIds = raw.albumIds ? [raw.albumIds] : []; raw.allowedUids = [...state.uploadAllowedUids]; raw.allowedGroupIds = [...state.uploadAllowedGroupIds]; return raw; }
  function individualMetadata() { return state.files.map(entry => ({ title: entry.title, category: entry.category, capturedAt: entry.capturedAt, location: entry.location, station: entry.station, trainNumber: entry.trainNumber, tags: entry.tags.split(",").map(value => value.trim()).filter(Boolean), camera:entry.camera,lens:entry.lens,shutterSpeed:entry.shutterSpeed,aperture:entry.aperture,iso:entry.iso,focalLength:entry.focalLength })); }
  function releaseFile(entry) { if (entry.preview) URL.revokeObjectURL(entry.preview); }
  function makeFileEntry(file) { return { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file), title: file.name.replace(/\.[^.]+$/, ""), category: "", capturedAt: "", location: "", station: "", trainNumber: "", tags: "", camera:"",lens:"",shutterSpeed:"",aperture:"",iso:"",focalLength:"" }; }
  function selectFiles(files) {
    const existing = new Set(state.files.map(entry => `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`));
    const selected=[...files],images=selected.filter(file => file.type.startsWith("image/"));let duplicates=0,overflow=0;
    images.forEach(file => { const key = `${file.name}:${file.size}:${file.lastModified}`; if(existing.has(key)){duplicates+=1;return;}if(state.files.length>=100){overflow+=1;return;}state.files.push(makeFileEntry(file));existing.add(key); });
    renderQueue();
    if(selected.length!==images.length)notify(`${selected.length-images.length}件は画像ファイルではないため追加しませんでした。`,true);
    else if(overflow)notify(`一度に登録できるのは100枚までです。${overflow}件は次回に分けてください。`,true);
    else if(duplicates)notify(`同じ写真${duplicates}件は重複を避けるため追加しませんでした。`,false);
  }
  function setUploadStatus(message,type=""){const status=$("#upload-status");status.textContent=message;status.className=`form-status${type?` ${type}`:""}`;status.hidden=!message;}
  async function upload() {
    if (!state.access.canUpload) return notify("管理用アカウントから写真は登録できません。", true);
    if (!state.files.length) return notify("写真を選択してください。", true);
    const metadata=uploadMetadata();if(metadata.visibility==="users"&&!metadata.allowedUids.length&&!metadata.allowedGroupIds.length)return setUploadStatus("公開範囲が「特定ユーザー／グループ」の場合は、共有先を1件以上選んでください。","error");
    const button=$("#upload-submit"),progress=$("#upload-progress"),bar=$("#upload-progress span");setButtonBusy(button,true,"保存中");progress.hidden=false;bar.style.width="0%";setUploadStatus("ログイン情報を確認しています…","loading");
    try {
      const form = new FormData(); state.files.forEach(entry => form.append("files", entry.file)); form.append("metadata", JSON.stringify(metadata)); form.append("fileMetadata", JSON.stringify(individualMetadata()));
      let user,token;try{user=await window.TayunetFirebaseDataAuth.currentUser();token=await user.getIdToken();}catch(error){throw new Error("ログインの確認に失敗しました。いったんログアウトして、もう一度ログインしてください。");}
      setUploadStatus("Ubuntu HDDへ送信しています…","loading");
      await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open("POST",`${API}/v1/photos`);xhr.timeout=10*60*1000;xhr.setRequestHeader("Authorization",`Bearer ${token}`);xhr.upload.onprogress=event=>{if(event.lengthComputable){const percent=Math.round(event.loaded/event.total*100);bar.style.width=`${percent}%`;setUploadStatus(`${state.files.length}枚を送信しています… ${percent}%`,"loading");}};xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300)return resolve();let detail="";try{detail=JSON.parse(xhr.responseText).detail||""}catch(_){}reject(new Error(statusMessage(xhr.status,detail)));};xhr.onerror=()=>reject(new Error("写真APIへ接続できません。通信状態を確認して再度お試しください。"));xhr.ontimeout=()=>reject(new Error("アップロードが時間内に完了しませんでした。通信状態を確認して再度お試しください。"));xhr.onabort=()=>reject(new Error("アップロードを中断しました。"));xhr.send(form);});
      const savedCount=state.files.length;bar.style.width="100%";setUploadStatus(`${savedCount}枚を保存しました。EXIFとサムネイルを反映しています…`,"success");state.files.forEach(releaseFile);state.files=[];state.uploadAllowedUids.clear();state.uploadAllowedGroupIds.clear();renderQueue();await loadPhotos();notify(`${savedCount}枚の写真、撮影情報、EXIF、サムネイルを保存しました。`);setTimeout(()=>{if($("#upload-dialog").open)$("#upload-dialog").close();},700);
    } catch(error) { setUploadStatus(friendlyError(error,"アップロードに失敗しました。"),"error"); }
    finally { setButtonBusy(button,false); }
  }

  function renderQueue() {
    $("#batch-guide").hidden = !state.files.length;
    $("#file-queue").innerHTML = state.files.map((entry, index) => `<article class="file-editor" data-file-id="${entry.id}"><div class="file-editor-head"><img src="${entry.preview}" alt=""><div><b>${index + 1}. ${escapeHtml(entry.file.name)}</b><small>${bytes(entry.file.size)}</small></div><button type="button" data-remove-file="${entry.id}" aria-label="${escapeHtml(entry.file.name)}を外す">×</button></div><label>タイトル<input data-file-field="title" value="${escapeHtml(entry.title)}" maxlength="1000"></label><details><summary>この写真だけの情報・EXIF補完を編集</summary><div class="file-editor-grid"><label>種類<select data-file-field="category"><option value="">共通設定を使用</option>${categoryOptions(entry.category)}</select></label><label>撮影日時<input data-file-field="capturedAt" type="datetime-local" value="${escapeHtml(entry.capturedAt)}"></label><label>撮影場所<input data-file-field="location" value="${escapeHtml(entry.location)}"></label><label>駅<input data-file-field="station" value="${escapeHtml(entry.station)}"></label><label>列車番号<input data-file-field="trainNumber" value="${escapeHtml(entry.trainNumber)}"></label><label>タグ<input data-file-field="tags" value="${escapeHtml(entry.tags)}" placeholder="カンマ区切り"></label><label>カメラ（EXIFなし時）<input data-file-field="camera" value="${escapeHtml(entry.camera)}"></label><label>レンズ（EXIFなし時）<input data-file-field="lens" value="${escapeHtml(entry.lens)}"></label><label>シャッター速度<input data-file-field="shutterSpeed" value="${escapeHtml(entry.shutterSpeed)}" placeholder="1/1000"></label><label>F値<input data-file-field="aperture" value="${escapeHtml(entry.aperture)}" placeholder="5.6"></label><label>ISO感度<input data-file-field="iso" value="${escapeHtml(entry.iso)}" inputmode="numeric"></label><label>焦点距離<input data-file-field="focalLength" value="${escapeHtml(entry.focalLength)}" placeholder="200mm"></label></div></details></article>`).join("");
  }
  async function editAlbumSharing(albumId) {
    const album=state.albums.find(item=>item.id===albumId),dialog=$("#share-dialog");if(!album)return notify("アルバム情報を再読み込みしてください。",true);
    dialog.innerHTML='<div class="dialog-loading"><div class="spinner"></div><p>共有できるメンバーを読み込んでいます…</p></div>';if(!dialog.open)dialog.showModal();
    try {
      const [people,groupsResponse]=await Promise.all([searchFirebaseMembers(""),api("/v1/groups")]),groups=(await groupsResponse.json()).items;
      const selectedUsers=new Set(album.allowedUids||[]),selectedGroups=new Set(album.allowedGroupIds||[]);
      const visibilityOptions=[{value:"private",label:"自分のみ"},{value:"users",label:"特定メンバー"},{value:"public",label:"全体公開"}].map(option=>`<option value="${option.value}" ${album.visibility===option.value?"selected":""}>${option.label}</option>`).join("");
      dialog.innerHTML=`<form class="share-panel album-sharing-form" id="album-sharing-form"><h2>アルバムをメンバーへ共有</h2><p><b>${escapeHtml(album.title)}</b> をログイン中の特定メンバーまたはグループへ公開します。</p><label class="share-visibility">公開範囲<select name="visibility">${visibilityOptions}</select></label><h3>ユーザー</h3><div class="share-choice-grid album-member-list">${people.map(person=>sharePersonChoice(person,selectedUsers)).join("")||'<p class="field-hint">共有できる利用者がいません。</p>'}</div><h3>グループ</h3><div class="share-choice-grid">${groups.map(group=>`<label class="share-choice"><input type="checkbox" name="allowedGroupIds" value="${group.id}" ${selectedGroups.has(group.id)?"checked":""}><span>${escapeHtml(group.name)}<small>${group.members.length}人</small></span></label>`).join("")||'<p class="field-hint">グループはまだありません。</p>'}</div><p class="form-status" id="album-sharing-status" hidden></p><div class="dialog-actions"><button type="button" class="ghost" data-close="share-dialog">キャンセル</button><button class="primary" id="album-sharing-submit">共有設定を保存</button></div></form>`;
      $("#album-sharing-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,button=$("#album-sharing-submit"),status=$("#album-sharing-status"),visibilityValue=form.elements.visibility.value,allowedUids=$$('input[name="allowedUids"]:checked',form).map(input=>input.value),allowedGroupIds=$$('input[name="allowedGroupIds"]:checked',form).map(input=>input.value);if(visibilityValue==="users"&&!allowedUids.length&&!allowedGroupIds.length){setFormStatus(status,"共有するユーザーまたはグループを選んでください。","error");return;}setButtonBusy(button,true,"保存中");try{const response=await api(`/v1/albums/${album.id}`,{method:"PATCH",body:JSON.stringify({visibility:visibilityValue,allowedUids,allowedGroupIds})});Object.assign(album,await response.json());notify("アルバムのメンバー共有を保存しました。");dialog.close();}catch(error){setFormStatus(status,friendlyError(error),"error");}finally{setButtonBusy(button,false);}});
    } catch(error) { dialog.innerHTML=`<div class="dialog-error"><h2>共有先を読み込めません</h2><p>${escapeHtml(friendlyError(error))}</p><div class="dialog-actions"><button data-close="share-dialog">閉じる</button></div></div>`; }
  }
  async function shareTarget(targetType,targetId,label) {
    const dialog=$("#share-dialog"),tomorrow=new Date(Date.now()+24*60*60*1000),defaultExpiry=new Date(tomorrow.getTime()-tomorrow.getTimezoneOffset()*60000).toISOString().slice(0,16);
    dialog.innerHTML=`<form class="share-panel" id="share-form"><h2>共有方法を選ぶ</h2><p><b>${escapeHtml(label)}</b> の共有範囲を設定します。</p><section class="member-share-shortcut"><div><b>システム内のメンバーへ共有</b><small>フレンド・Firebase利用者・グループを選び、ログインした相手だけに公開します。</small></div><button type="button" class="primary" ${targetType==="photo"?`data-share-members="${targetId}"`:`data-share-album-members="${targetId}"`}>メンバーを選ぶ</button></section><div class="share-divider"><span>または、限定リンクを発行</span></div><p class="share-help">ログインしていない相手へ送る場合に使います。必要に応じてパスワードと期限を設定してください。</p><div class="share-options"><label>パスワード（任意）<input name="password" type="password" autocomplete="new-password" minlength="4" placeholder="4文字以上を推奨"><small>設定した場合はリンクとは別の方法で伝えてください。</small></label><label>有効期限（任意）<input name="expiresAt" type="datetime-local" min="${escapeHtml(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16))}" value="${defaultExpiry}"><small>空欄にすると無期限です。</small></label></div><p class="form-status" id="share-status" role="status" aria-live="polite" hidden></p><div class="dialog-actions"><button type="button" class="ghost" data-close="share-dialog">キャンセル</button><button class="primary" id="share-submit">安全なリンクを作る</button></div></form>`;
    dialog.showModal();
    $("#share-form").addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,button=$("#share-submit"),status=$("#share-status"),raw=Object.fromEntries(new FormData(form));if(raw.password&&raw.password.length<4){setFormStatus(status,"パスワードは4文字以上にしてください。","error");return;}if(raw.expiresAt&&new Date(raw.expiresAt).getTime()<=Date.now()){setFormStatus(status,"有効期限は現在より後の日時を指定してください。","error");return;}raw.targetType=targetType;raw.targetId=targetId;setButtonBusy(button,true,"作成中");setFormStatus(status,"共有リンクを安全に作成しています…","loading");try{const response=await api("/v1/shares",{method:"POST",body:JSON.stringify(raw)});const result=await response.json();dialog.innerHTML=`<div class="share-result"><h2>共有リンクを作成しました</h2><p class="share-result-note">${result.passwordRequired?"パスワード保護あり。パスワードはリンクとは別の方法で相手へ伝えてください。":"リンクを知っている人が閲覧できます。"}${result.expiresAt?`<br>有効期限：${escapeHtml(dateText(result.expiresAt))}`:"<br>有効期限：無期限"}</p><label>公開リンク<input class="share-url" value="${escapeHtml(result.url)}" readonly></label><p class="form-status success" role="status">リンク先を開いて写真が表示されることを確認してから相手へ送ってください。</p><div class="dialog-actions"><button class="ghost" data-copy="${escapeHtml(result.url)}">URLをコピー</button><a class="primary button-link" href="${escapeHtml(result.url)}" target="_blank" rel="noopener">リンクを確認</a><button class="primary" data-close="share-dialog">閉じる</button></div></div>`;}catch(error){setFormStatus(status,friendlyError(error,"共有リンクを作成できませんでした。"),"error");}finally{setButtonBusy(button,false);}});
  }

  async function download(path, filename) { const response = await api(path,{timeoutMs:120000}); const url = URL.createObjectURL(await response.blob()); const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000); }

  function personName(person) { return person.displayName || person.email.split("@")[0]; }
  function directoryRow(person) {
    const action = person.isSelf ? `<span class="relation-badge self">現在のアカウント</span>` : person.relationship === "accepted" ? `<span class="relation-badge">フレンド</span>` : person.incoming ? `<button class="primary" data-friend="${person.uid}">承認する</button>` : person.relationship === "pending" ? `<span class="relation-badge pending">申請中</span>` : `<button data-friend="${person.uid}">追加する</button>`;
    return `<div class="person-row"><span class="person-identity"><b>${escapeHtml(personName(person))}</b><small>${escapeHtml(person.email)}</small></span>${action}</div>`;
  }
  function currentAccountSearch(query) {
    const email=String(state.currentUser?.email||"").trim(),normalized=query.trim().toLowerCase(),local=email.split("@")[0].toLowerCase();
    if(!email||!normalized||![email.toLowerCase(),local].includes(normalized))return null;
    return {uid:state.currentUser.uid,email,displayName:email.split("@")[0],isSelf:true,relationship:"self"};
  }
  async function loadFirebaseDirectory() {
    if(state.firebaseDirectory)return state.firebaseDirectory;
    if(!window.firebase?.firestore)throw new Error("Firebase利用者一覧を読み込めません。ページを再読み込みしてください。");
    const snapshot=await firebase.firestore().collection("photo_member_directory")
      .where("active","==",true).limit(500).get();
    const managerEmails=new Set(["admin@tayunet-traininfo.com","systemadmin@tayunet-traininfo.com"]);
    state.firebaseDirectory=snapshot.docs.map(document=>{
      const profile=document.data()||{},email=String(profile.email||"").trim();
      return {uid:document.id,email,displayName:String(profile.displayName||profile.name||email.split("@")[0]||"").trim()};
    }).filter(person=>person.email&&person.uid!==state.currentUser?.uid&&!managerEmails.has(person.email.toLowerCase()));
    return state.firebaseDirectory;
  }
  async function searchFirebaseMembers(query) {
    const [directory,friendResponse]=await Promise.all([loadFirebaseDirectory(),api("/v1/friends")]);
    const friends=(await friendResponse.json()).items,relationships=new Map(friends.map(friend=>[friend.uid,friend]));
    const needle=query.trim().toLowerCase();
    return directory.filter(person=>!needle||`${person.displayName}\n${person.email}`.toLowerCase().includes(needle)).slice(0,50).map(person=>{
      const relation=relationships.get(person.uid);
      return {...person,relationship:relation?.status||"none",incoming:Boolean(relation?.incoming)};
    });
  }
  async function searchPeople() {
    const query = $("#people-query")?.value.trim() || "",button=$("#people-search");
    const target = $("#directory-results"); if (!target) return;if(query&&query.length<2){target.innerHTML=`<p class="error-text">名前またはメールアドレスを2文字以上入力してください。</p>`;return;}
    const self=currentAccountSearch(query);if(self){target.innerHTML=`<div class="self-search-result">${directoryRow(self)}<p>これは現在ログイン中のアカウントです。自分自身へ申請する必要はありません。上に「あなたへの申請」が届いている場合は、そこで「承認する」を押してください。</p></div>`;return;}
    setButtonBusy(button,true,"検索中");
    target.innerHTML = `<p class="muted">利用者を探しています…</p>`;
    try { const people=await searchFirebaseMembers(query);target.innerHTML=people.map(directoryRow).join("")||`<div class="directory-empty"><b>該当する承認済み利用者はいません</b><p>名前またはメールアドレスを確認してください。無効・承認待ちのアカウントは検索結果に表示されません。</p></div>`; }
    catch(error){target.innerHTML=`<p class="error-text">${escapeHtml(friendlyError(error))}</p>`;}finally{setButtonBusy(button,false);}
  }
  async function showPeople() {
    const dialog=$("#people-dialog");
    let content=$("#people-content",dialog);if(!content){content=document.createElement("div");content.id="people-content";dialog.replaceChildren(content);}
    content.innerHTML=`<div class="dialog-loading"><div class="spinner"></div><p>共有メンバーとグループを読み込んでいます…</p></div>`;if(!dialog.open)dialog.showModal();document.documentElement.classList.add("archive-modal-open");
    try {
      const [friendResponse,groupResponse,directoryResponse]=await Promise.all([api("/v1/friends"),api("/v1/groups"),api("/v1/directory")]);
      const friends=(await friendResponse.json()).items,groups=(await groupResponse.json()).items,suggestions=(await directoryResponse.json()).items;
      const accepted=friends.filter(item=>item.status==="accepted"),incoming=friends.filter(item=>item.incoming),outgoing=friends.filter(item=>item.status==="pending"&&!item.incoming);
      updateFriendNotification(incoming.length);
      content.innerHTML=`<div class="panel-pad people-panel"><div class="people-heading"><div><small>FRIEND & GROUP</small><h2>共有メンバー</h2><p>申請の受信・送信状況と、写真の共有先をここで管理します。</p></div><div class="people-counts"><span><b>${accepted.length}</b>フレンド</span><span class="${incoming.length?"has-request":""}"><b>${incoming.length}</b>あなたへの申請</span><span><b>${outgoing.length}</b>申請中</span></div><button type="button" class="people-close-top" data-close="people-dialog" aria-label="共有メンバーを閉じる">×</button></div>${incoming.length?`<section class="people-section attention"><h3>あなたへの申請 <em>${incoming.length}件</em></h3><p class="request-guide">相手から申請が届いています。「承認する」を押すと、すぐフレンドになります。</p>${incoming.map(directoryRow).join("")}</section>`:`<section class="people-section request-empty"><h3>あなたへの申請</h3><p class="muted">現在、承認を待っている申請はありません。</p></section>`}${outgoing.length?`<section class="people-section outgoing"><h3>あなたが送った申請 <em>${outgoing.length}件</em></h3>${outgoing.map(friend=>`<div class="person-row"><span class="person-identity"><b>${escapeHtml(personName(friend))}</b><small>${escapeHtml(friend.email)} · 相手の承認待ち</small></span><button data-remove-friend="${friend.uid}">申請を取り消す</button></div>`).join("")}</section>`:""}<section class="people-section"><h3>Firebase利用者を探す</h3><p class="current-account-note">承認済みのシステム利用者を検索します。現在ログイン中：<b>${escapeHtml(state.currentUser?.email||"確認中")}</b></p><div class="people-search"><input id="people-query" type="search" placeholder="名前・メールアドレス（2文字以上）"><button class="primary" id="people-search">検索</button></div><div id="directory-results" class="directory-results">${suggestions.map(directoryRow).join("")||`<p class="muted">名前またはメールアドレスを入力して検索してください。</p>`}</div></section><section class="people-section"><h3>フレンド一覧</h3>${accepted.length?accepted.map(friend=>`<div class="person-row"><label class="person-choice"><input class="group-member" type="checkbox" value="${friend.uid}"><span class="person-identity"><b>${escapeHtml(personName(friend))}</b><small>${escapeHtml(friend.email)}</small></span></label><button class="quiet-danger" data-remove-friend="${friend.uid}">解除</button></div>`).join(""):`<p class="muted">フレンドを追加すると写真の共有先に選べます。</p>`}<div class="dialog-actions"><button id="new-group" ${accepted.length?"":"disabled"}>選択した人でグループ作成</button></div></section><section class="people-section"><h3>グループ</h3>${groups.map(group=>`<div class="person-row"><span><b>${escapeHtml(group.name)}</b></span><small>${group.members.length}人</small></div>`).join("")||`<p class="muted">フレンドを選択してグループを作成できます。</p>`}</section><div class="dialog-actions people-bottom-actions"><button class="ghost" data-close="people-dialog">閉じる</button></div></div>`;
    } catch(error) { content.innerHTML=`<div class="dialog-error"><h2>共有メンバーを読み込めません</h2><p>${escapeHtml(friendlyError(error))}</p><div class="dialog-actions"><button class="ghost" data-close="people-dialog">閉じる</button><button class="primary" id="retry-people">再試行</button></div></div>`; }
  }

  document.addEventListener("click", async event => {
    const mobileMenuButton=event.target.closest("#mobile-menu-button");if(mobileMenuButton){setMobileMenuOpen($("#mobile-action-menu").hidden);return;}
    const helpButton=event.target.closest("#help-button,#mobile-help-button");if(helpButton){setMobileMenuOpen(false);const help=$("#help-dialog");if(!help.open)help.showModal();return;}
    const mobileFriend=event.target.closest("#mobile-friend-button");if(mobileFriend){setMobileMenuOpen(false);return showPeople();}
    const mobileUpload=event.target.closest("#mobile-upload-button");if(mobileUpload){setMobileMenuOpen(false);return openUploadDialog();}
    const mobileLogout=event.target.closest("#mobile-logout-button");if(mobileLogout){setMobileMenuOpen(false);$("#firebase-logout-button").click();return;}
    if(!$("#mobile-action-menu").hidden&&!event.target.closest("#mobile-action-menu"))setMobileMenuOpen(false);
    const manageFromEdit=event.target.closest("[data-open-people-from-edit]");if(manageFromEdit){if($("#detail-dialog").open)$("#detail-dialog").close();return showPeople();}
    const close = event.target.closest("[data-close]"); if (close) return $(`#${close.dataset.close}`).close();
    const shareMembers=event.target.closest("[data-share-members]");if(shareMembers){const photo=state.photos.find(item=>item.id===shareMembers.dataset.shareMembers);if(!photo)return notify("写真情報が更新されています。一覧を再読み込みしてください。",true);if($("#share-dialog").open)$("#share-dialog").close();return editDetail(photo,true);}
    const shareAlbumMembers=event.target.closest("[data-share-album-members]");if(shareAlbumMembers)return editAlbumSharing(shareAlbumMembers.dataset.shareAlbumMembers);
    const removeFile = event.target.closest("[data-remove-file]"); if (removeFile) { const index=state.files.findIndex(entry=>entry.id===removeFile.dataset.removeFile);if(index>=0){releaseFile(state.files[index]);state.files.splice(index,1);renderQueue()}return; }
    const cardButton = event.target.closest(".open-card,.calendar-photo"); if (cardButton) return openDetail(cardButton.closest("[data-id]").dataset.id);
    const scope = event.target.closest("[data-scope]"); if (scope) { $$("[data-scope]").forEach(button=>button.classList.toggle("active",button===scope)); state.scope=scope.dataset.scope; state.view="grid"; $("#list-title").textContent=labels[state.scope]; await loadPhotos(); return; }
    const view = event.target.closest("[data-view]"); if (view) { $$(`[data-view]`).forEach(button=>button.classList.toggle("active",button===view)); state.view=view.dataset.view; if(state.view==="grid"||state.view==="timeline")renderGrid();else if(state.view==="calendar")renderCalendar();else renderMap(); return; }
    if (event.target.closest("#upload-button")) return openUploadDialog();
    if (event.target.closest("#friend-button")) return showPeople();
    const retryEdit=event.target.closest("[data-retry-edit]");if(retryEdit){const photo=state.photos.find(item=>item.id===retryEdit.dataset.retryEdit);if(photo)return editDetail(photo);}
    if(event.target.closest("#retry-people"))return showPeople();
    const action=event.target.closest("[data-action]"); if(action){const dialog=$("#detail-dialog"),photo=state.photos.find(item=>item.id===dialog.dataset.photoId);if(!photo)return notify("写真情報が更新されています。一覧を再読み込みしてください。",true);const kind=action.dataset.action,label={edit:"準備中",share:"準備中",download:"取得中",delete:"移動中",restore:"復元中"}[kind]||"処理中";setButtonBusy(action,true,label);try{if(kind==="edit")return await editDetail(photo);if(kind==="share")return await shareTarget("photo",photo.id,photo.title||photo.filename);if(kind==="download"){await download(`/v1/photos/${photo.id}/media/original`,photo.filename);notify("原本画像のダウンロードを開始しました。");return;}if(kind==="delete"){if(!confirm("この写真をゴミ箱へ移しますか？\n30日以内ならゴミ箱から復元できます。"))return;await api(`/v1/photos/${photo.id}`,{method:"DELETE"});dialog.close();await loadPhotos();notify("写真をゴミ箱へ移しました。");return;}if(kind==="restore"){await api(`/v1/photos/${photo.id}/restore`,{method:"POST"});dialog.close();await loadPhotos();notify("写真をゴミ箱から復元しました。");return;}}catch(error){notify(friendlyError(error),true);}finally{setButtonBusy(action,false);}return;}
    const copy=event.target.closest("[data-copy]");if(copy){setButtonBusy(copy,true,"コピー中");try{await navigator.clipboard.writeText(copy.dataset.copy);copy.dataset.idleLabel="コピーしました";notify("共有URLをクリップボードへコピーしました。");}catch(error){notify("URLをコピーできませんでした。入力欄を長押ししてコピーしてください。",true);}finally{setButtonBusy(copy,false);}return;}
    const exportButton=event.target.closest("[data-export]");if(exportButton){const type=exportButton.dataset.export;setButtonBusy(exportButton,true,"準備中");try{await download(type==="zip"?"/v1/export/originals.zip":`/v1/export/metadata.${type}`,`photo-archive.${type}`);notify("バックアップのダウンロードを開始しました。");}catch(error){notify(friendlyError(error,"バックアップを作成できませんでした。"),true);}finally{setButtonBusy(exportButton,false);}return;}
    if(event.target.closest("#new-album")){if(!state.access.canUpload)return notify("管理用アカウントからアルバムは登録できません。",true);const title=prompt("アルバム名");if(!title)return;try{setContentLoading(true,"アルバムを作成しています…");await api("/v1/albums",{method:"POST",body:JSON.stringify({title,visibility:"private"})});await renderAlbums();notify("アルバムを作成しました。");}catch(error){notify(friendlyError(error,"アルバムを作成できませんでした。"),true);}finally{setContentLoading(false);}return;}
    const albumShare=event.target.closest("[data-share-album]");if(albumShare){const album=state.albums.find(item=>item.id===albumShare.dataset.shareAlbum);return shareTarget("album",album.id,album.title);}
    const album=event.target.closest("[data-open-album]");if(album){setButtonBusy(album,true,"読込中");try{setContentLoading(true,"アルバムの写真を読み込んでいます…");const response=await api(`/v1/albums/${album.dataset.openAlbum}/photos`),data=await response.json();state.photos=data.items;state.scope="mine";state.view="grid";$$('[data-scope]').forEach(button=>button.classList.toggle("active",button.dataset.scope==="mine"));$("#list-title").textContent=`アルバム：${data.album.title}`;renderGrid();}catch(error){notify(friendlyError(error,"アルバムを開けませんでした。"),true);}finally{setContentLoading(false);setButtonBusy(album,false);}return;}
    if(event.target.closest("#people-search")){await searchPeople();return;}
    if(event.target.closest("#upload-reload-members")){await prepareUploadSharing(true);return;}
    const friend=event.target.closest("[data-friend]");if(friend){setButtonBusy(friend,true,"処理中");try{await api(`/v1/friends/${friend.dataset.friend}`,{method:"POST"});await showPeople();notify("共有メンバー情報を更新しました。");}catch(error){notify(friendlyError(error,"フレンド申請を更新できませんでした。"),true);}finally{setButtonBusy(friend,false);}return;}
    const removeFriend=event.target.closest("[data-remove-friend]");if(removeFriend){setButtonBusy(removeFriend,true,"処理中");try{await api(`/v1/friends/${removeFriend.dataset.removeFriend}`,{method:"DELETE"});await showPeople();notify("共有メンバー情報を更新しました。");}catch(error){notify(friendlyError(error,"フレンド情報を更新できませんでした。"),true);}finally{setButtonBusy(removeFriend,false);}return;}
    if(event.target.closest("#new-group")){const name=prompt("グループ名を入力してください");if(!name)return;const members=$$(".group-member:checked").map(input=>input.value),button=event.target.closest("#new-group");setButtonBusy(button,true,"作成中");try{await api("/v1/groups",{method:"POST",body:JSON.stringify({name,members})});await showPeople();notify("共有グループを作成しました。");}catch(error){notify(friendlyError(error,"グループを作成できませんでした。"),true);}finally{setButtonBusy(button,false);}return;}
  });

  document.addEventListener("input", event => {
    const field=event.target.closest("[data-file-field]");if(field){const editor=field.closest("[data-file-id]");const entry=state.files.find(item=>item.id===editor.dataset.fileId);if(entry)entry[field.dataset.fileField]=field.value;return;}
    if(event.target.matches("#upload-member-filter")){const query=event.target.value.trim().toLowerCase();$$('.share-person',$("#upload-user-choices")).forEach(choice=>{choice.hidden=Boolean(query)&&!choice.dataset.personSearch.includes(query);});return;}
    if(event.target.matches("#people-query")&&event.inputType==="insertLineBreak")searchPeople();
  });
  document.addEventListener("change",event=>{
    if(event.target.matches('#upload-form select[name="visibility"]')){const users=event.target.value==="users";$("#upload-member-picker").hidden=!users;if(users)prepareUploadSharing();return;}
    if(event.target.closest("#upload-user-choices")&&event.target.matches('input[name="allowedUids"]')){if(event.target.checked)state.uploadAllowedUids.add(event.target.value);else state.uploadAllowedUids.delete(event.target.value);return;}
    if(event.target.closest("#upload-group-choices")&&event.target.matches('input[name="uploadAllowedGroupIds"]')){if(event.target.checked)state.uploadAllowedGroupIds.add(event.target.value);else state.uploadAllowedGroupIds.delete(event.target.value);}
  });
  document.addEventListener("keydown", event => { if(event.target.matches("#people-query")&&event.key==="Enter"){event.preventDefault();searchPeople()} });

  $("#drop-zone").addEventListener("click",()=>$("#file-input").click()); $("#drop-zone").addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" ")$("#file-input").click()});
  $("#file-input").addEventListener("change",event=>{selectFiles(event.target.files);event.target.value=""});
  ["dragenter","dragover"].forEach(type=>$("#drop-zone").addEventListener(type,event=>{event.preventDefault();event.currentTarget.classList.add("drag")}));
  ["dragleave","drop"].forEach(type=>$("#drop-zone").addEventListener(type,event=>{event.preventDefault();event.currentTarget.classList.remove("drag")}));
  $("#drop-zone").addEventListener("drop",event=>selectFiles(event.dataTransfer.files));
  $("#upload-form").addEventListener("submit",event=>{event.preventDefault();upload()});
  $("#filter-toggle").addEventListener("click", () => setFiltersOpen(true));
  $("#filter-close").addEventListener("click", () => setFiltersOpen(false));
  $("#filter-backdrop").addEventListener("click", () => setFiltersOpen(false));
  $("#apply-filters").addEventListener("click", async () => { await loadPhotos(); setFiltersOpen(false); });
  $("#search-q").addEventListener("keydown", async event=>{if(event.key==="Enter"){await loadPhotos();setFiltersOpen(false)}});
  $("#clear-filters").addEventListener("click",async()=>{$$("#filters input,#filters select").forEach(input=>input.value="");await loadPhotos();setFiltersOpen(false)});
  document.addEventListener("keydown", event => { if(event.key!=="Escape")return;if(document.body.classList.contains("filters-open"))setFiltersOpen(false);if(!$("#mobile-action-menu").hidden)setMobileMenuOpen(false); });
  $$(".archive-dialog").forEach(dialog=>dialog.addEventListener("close",()=>{if(dialog.id==="detail-dialog")state.detailRenderId++;if(!$("#people-dialog").open)document.documentElement.classList.remove("archive-modal-open");}));
  window.addEventListener("resize", () => { if (!window.matchMedia("(max-width: 1180px)").matches) setFiltersOpen(false);if(!window.matchMedia("(max-width: 900px)").matches)setMobileMenuOpen(false); });

  window.TayunetAuthReady.then(async ready => {
    if (!ready.ok) return;
    const firebaseUser=await window.TayunetFirebaseDataAuth.currentUser();state.currentUser={uid:firebaseUser.uid,email:firebaseUser.email||""};
    $("#mobile-user-info").textContent=state.currentUser.email?`${state.currentUser.email} でログイン中`:"ログイン中";
    const localManager=["admin@tayunet-traininfo.com","systemadmin@tayunet-traininfo.com"].includes(state.currentUser.email.toLowerCase());
    applyAccess({canUpload:!localManager,canManage:localManager,role:localManager?"manager":"contributor"});
    $("#auth-cover").remove(); $("#main-content").hidden=false;
    try { const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let response;try{response=await fetch(`${API}/health`,{signal:controller.signal,cache:"no-store"});}finally{clearTimeout(timer);}if(!response.ok)throw new Error(`HTTP ${response.status}`);const health=await response.json();$("#storage-count").textContent=bytes(health.storage.usedBytes);$("#trash-days").textContent=`${health.trashDays}日`;$("#photo-count").textContent=health.photos;$("#api-status").className="state-lamp online";$("#api-status").innerHTML="<i></i>写真API 正常";$("#api-status").title="写真サーバーへ接続済み"; } catch(_){$("#storage-count").textContent="確認不可";$("#api-status").className="state-lamp error";$("#api-status").innerHTML="<i></i>写真API 未接続";$("#api-status").title="写真サーバーへ接続できません";notify("写真サーバーへ接続できません。一覧が表示されない場合は、通信状態を確認してから再読み込みしてください。",true,true);}
    try { const response=await api("/v1/me");applyAccess(await response.json()); } catch(error) { notify(friendlyError(error),true,true); }
    await refreshFriendNotifications();
    try { const response=await api("/v1/albums");state.albums=(await response.json()).items;$("#upload-album").innerHTML=`<option value="">なし</option>${state.albums.map(album=>`<option value="${album.id}">${escapeHtml(album.title)}</option>`).join("")}`; } catch(error) {$("#upload-album").innerHTML='<option value="">アルバムを取得できません</option>';$("#upload-album").disabled=true;}
    await loadPhotos();
  });
})();
