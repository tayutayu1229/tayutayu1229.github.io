(function () {
  "use strict";
  const API = "https://photo-api.tayunet-traininfo.com";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { scope: "mine", view: "grid", photos: [], albums: [], files: [], blobs: new Map(), map: null, mapLayer: null, mapRenderer: null, leafletPromise: null, mapRenderId: 0, currentUser: null, access: { canUpload: true, canManage: false, role: "contributor" } };
  const labels = { mine: "個人一覧", shared: "共有一覧", public: "全体公開", albums: "アルバム", map: "マップ", calendar: "カレンダー", trash: "ゴミ箱" };

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const dateText = value => value ? String(value).replace("T", " ").slice(0, 16) : "未記録";
  const bytes = value => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
  const visibility = value => ({ private: "自分のみ", users: "特定メンバー", link: "限定リンク", public: "全体公開" })[value] || value;
  const category = value => ({ train: "列車", freight: "貨物列車", landscape: "風景", other: "その他" })[value] || "その他";

  function updateClock() {
    const clock = $("#system-clock");
    if (clock) clock.textContent = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
  }
  updateClock(); setInterval(updateClock, 1000);

  async function api(path, options = {}, retry = true) {
    const user = await window.TayunetFirebaseDataAuth.currentUser();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${await user.getIdToken(!retry)}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    let response;
    try { response = await fetch(`${API}${path}`, { ...options, headers, mode: "cors", cache: "no-store" }); }
    catch (_) { throw new Error("写真APIに接続できません。通信またはDNSの状態を確認してください。"); }
    if (response.status === 401 && retry) return api(path, options, false);
    if (!response.ok) {
      let detail = "処理に失敗しました";
      try { detail = (await response.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    return response;
  }

  function notify(message, error = false) {
    const element = $("#notice"); element.textContent = message; element.hidden = false;
    element.style.borderColor = error ? "#d98085" : "#e8c36b";
    element.style.background = error ? "#fff0f1" : "#fff8df";
    clearTimeout(notify.timer); notify.timer = setTimeout(() => { element.hidden = true; }, 7000);
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
      try { const img = $("img", element); img.src = await imageUrl(photo); img.onload = () => $(".photo-image", element).classList.remove("loading-card"); } catch (_) {}
    }));
  }

  function fillSuggestions() {
    const specs = [["camera", "#camera-list"], ["lens", "#lens-list"]];
    specs.forEach(([key, selector]) => { $(selector).innerHTML = [...new Set(state.photos.map(item => item[key]).filter(Boolean))].sort().map(value => `<option value="${escapeHtml(value)}">`).join(""); });
    $("#tag-list").innerHTML = [...new Set(state.photos.flatMap(item => item.tags))].sort().map(value => `<option value="${escapeHtml(value)}">`).join("");
  }

  function renderGrid() {
    state.mapRenderId += 1;
    $("#calendar-view").hidden = true; $("#map-view").hidden = true; $("#album-view").hidden = true;
    const list = $("#photo-list"); list.hidden = false; list.className = `photo-grid${state.view === "timeline" ? " timeline" : ""}`;
    list.innerHTML = state.photos.map(card).join("");
    $("#empty-state").hidden = state.photos.length > 0; $("#result-count").textContent = `${state.photos.length}件`;
    hydrateImages(list);
  }

  function monthDays() {
    const byDay = new Map(); state.photos.forEach(photo => { const day = (photo.capturedAt || photo.createdAt || "").slice(0, 10); if (day) byDay.set(day, [...(byDay.get(day) || []), photo]); });
    const days = [...byDay.keys()].sort().reverse();
    const calendar = $("#calendar-view"); calendar.innerHTML = days.map(day => `<div class="calendar-day"><time>${escapeHtml(day)}</time><div class="calendar-thumbs">${byDay.get(day).slice(0,9).map(photo => `<button class="calendar-photo" data-id="${photo.id}"><img alt="${escapeHtml(photo.title || photo.filename)}"></button>`).join("")}</div><small>${byDay.get(day).length}枚</small></div>`).join("");
    $$(`.calendar-photo`, calendar).forEach(async button => { const photo = state.photos.find(item => item.id === button.dataset.id); try { $("img", button).src = await imageUrl(photo); } catch (_) {} });
  }

  function renderCalendar() {
    state.mapRenderId += 1;
    $("#photo-list").hidden = true; $("#map-view").hidden = true; $("#album-view").hidden = true; $("#calendar-view").hidden = false; $("#empty-state").hidden = state.photos.length > 0; monthDays();
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
    $("#photo-list").hidden = true; $("#calendar-view").hidden = true; $("#album-view").hidden = true; $("#empty-state").hidden = true; $("#map-view").hidden = false;
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
      if (renderId === state.mapRenderId) { notify(error.message, true); $("#result-count").textContent = "地図取得失敗"; }
    } finally {
      if (renderId === state.mapRenderId) mapView.classList.remove("map-loading");
    }
  }

  async function renderAlbums() {
    state.mapRenderId += 1;
    $("#photo-list").hidden = true; $("#calendar-view").hidden = true; $("#map-view").hidden = true; $("#album-view").hidden = false; $("#empty-state").hidden = true;
    const response = await api("/v1/albums"); state.albums = (await response.json()).items;
    $("#upload-album").innerHTML = `<option value="">なし</option>${state.albums.map(album => `<option value="${album.id}">${escapeHtml(album.title)}</option>`).join("")}`;
    $("#album-view").innerHTML = `${state.access.canUpload ? `<button class="album-card album-create" id="new-album">＋ 新しいアルバム</button>` : ""}${state.albums.map(album => `<div class="album-card" data-album="${album.id}"><h3>${escapeHtml(album.title)}</h3><p>${escapeHtml(album.description)}</p><span>${album.photoCount}枚 · ${visibility(album.visibility)}</span><div class="dialog-actions"><button data-open-album="${album.id}">開く</button><button data-share-album="${album.id}">限定リンク</button></div></div>`).join("")}`;
    $("#result-count").textContent = `${state.albums.length}件`;
  }

  function queryString() {
    const pairs = { scope: state.scope, q: $("#search-q").value, from: $("#date-from").value, to: $("#date-to").value, category: $("#category-filter").value, train_number: $("#train-filter").value, camera: $("#camera-filter").value, lens: $("#lens-filter").value, tag: $("#tag-filter").value, focal_min: $("#focal-min").value, focal_max: $("#focal-max").value };
    const params = new URLSearchParams(); Object.entries(pairs).forEach(([key, value]) => { if (value) params.set(key, value); }); return params;
  }

  async function loadPhotos() {
    if (state.scope === "albums") return renderAlbums();
    const requestedView = state.scope === "map" ? "map" : state.scope === "calendar" ? "calendar" : state.view;
    const scope = ["map", "calendar"].includes(state.scope) ? "mine" : state.scope;
    const params = queryString(); params.set("scope", scope);
    $("#result-count").textContent = "読み込み中";
    try { const response = await api(`/v1/photos?${params}`); state.photos = (await response.json()).items; fillSuggestions(); if (requestedView === "map") await renderMap(); else if (requestedView === "calendar") renderCalendar(); else renderGrid(); }
    catch (error) { state.photos=[];renderGrid();notify(error.message, true); $("#result-count").textContent = "取得失敗"; }
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
    const rows = [
      ["列車番号", photo.trainNumber], ["始発・終着", [photo.origin, photo.destination].filter(Boolean).join(" → ")], ["列車種別", photo.trainType], ["始発駅日付", photo.serviceDate], ["変更事項", photo.changes],
      ["撮影日時", dateText(photo.capturedAt)], ["撮影場所", photo.location], ["駅", photo.station], ["輸送経路", photo.transportRoute], ["記事・備考", photo.article], ["フリーメモ", photo.notes],
      ["カメラ", photo.camera], ["レンズ", photo.lens], ["シャッター", photo.shutterSpeed], ["F値", photo.aperture], ["ISO", photo.iso], ["焦点距離", photo.focalLength && `${photo.focalLength} mm`], ["タグ", photo.tags.join(" / ")], ["公開範囲", visibility(photo.visibility)], ["ファイル", `${photo.filename}（${bytes(photo.byteSize)}）`]
    ];
    return rows.filter(([, value]) => value).map(([name, value]) => `<div class="data-group"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  }

  async function openDetail(id) {
    const photo = state.photos.find(item => item.id === id); if (!photo) return;
    const dialog = $("#detail-dialog"); dialog.dataset.photoId = photo.id;
    const manageable = state.access.canManage || photo.ownerUid === (await window.TayunetFirebaseDataAuth.currentUser()).uid;
    dialog.innerHTML = `<div class="detail-shell"><div class="detail-top"><h2>${escapeHtml(photo.trainNumber ? `第 ${photo.trainNumber} 列車` : (photo.title || photo.filename))}</h2><button data-close="detail-dialog">×</button></div><div class="detail-layout"><div class="detail-photo"><div class="spinner"></div></div><dl class="detail-data">${dataRows(photo)}</dl></div><div class="detail-actions">${manageable ? `<button data-action="edit">編集</button><button data-action="share">限定リンク</button><button data-action="download">原本</button>${photo.deletedAt ? `<button data-action="restore">復元</button>` : `<button class="danger" data-action="delete">ゴミ箱へ</button>`}` : `<button data-action="download">原本</button>`}</div></div>`;
    dialog.showModal();
    try { const url = await imageUrl(photo, "original"); $(".detail-photo", dialog).innerHTML = `<img src="${url}" alt="${escapeHtml(photo.title || photo.filename)}">`; } catch (error) { $(".detail-photo", dialog).textContent = error.message; }
  }

  function input(name, label, photo, extra = "") { const value=name==="capturedAt"?String(photo[name]||"").slice(0,16):(photo[name]||"");return `<label>${label}<input name="${name}" value="${escapeHtml(value)}" ${extra}></label>`; }
  async function editDetail(photo) {
    const [friendsResponse,groupsResponse]=await Promise.all([api("/v1/friends"),api("/v1/groups")]);
    const friends=(await friendsResponse.json()).items.filter(item=>item.status==="accepted"),groups=(await groupsResponse.json()).items;
    $("#detail-dialog").innerHTML = `<form class="panel-pad" id="edit-form"><h2>撮影情報を編集</h2><div class="form-grid">${input("title","タイトル",photo)}<label>種類<select name="category">${["train","freight","landscape","other"].map(v=>`<option value="${v}" ${photo.category===v?"selected":""}>${category(v)}</option>`).join("")}</select></label>${input("capturedAt","撮影日時",photo,"type=datetime-local")}${input("location","撮影場所",photo)}${input("station","駅",photo)}${input("trainNumber","列車番号",photo)}${input("origin","始発駅",photo)}${input("destination","終着駅",photo)}${input("trainType","列車種別",photo)}${input("serviceDate","始発駅日付",photo,"type=date")}${input("changes","変更事項",photo)}${input("transportRoute","貨物輸送経路",photo)}${input("article","記事・備考",photo)}${input("camera","カメラ",photo)}${input("lens","レンズ",photo)}${input("shutterSpeed","シャッター",photo)}${input("aperture","F値",photo)}${input("iso","ISO",photo)}${input("focalLength","焦点距離",photo)}${input("latitude","緯度",photo,"type=number step=any")}${input("longitude","経度",photo,"type=number step=any")}<label>タグ<input name="tags" value="${escapeHtml(photo.tags.join(", "))}"></label><label>公開範囲<select name="visibility">${["private","users","link","public"].map(v=>`<option value="${v}" ${photo.visibility===v?"selected":""}>${visibility(v)}</option>`).join("")}</select></label><label>共有するユーザー<select name="allowedUids" multiple size="4">${friends.map(v=>`<option value="${v.uid}" ${photo.allowedUids.includes(v.uid)?"selected":""}>${escapeHtml(v.email)}</option>`).join("")}</select></label><label>共有するグループ<select name="allowedGroupIds" multiple size="4">${groups.map(v=>`<option value="${v.id}" ${photo.allowedGroupIds.includes(v.id)?"selected":""}>${escapeHtml(v.name)}</option>`).join("")}</select></label><label class="span2">フリーメモ<textarea name="notes" rows="5">${escapeHtml(photo.notes)}</textarea></label></div><div class="dialog-actions"><button type="button" class="ghost" data-close="detail-dialog">キャンセル</button><button class="primary">保存</button></div></form>`;
    $("#edit-form").addEventListener("submit", async event => { event.preventDefault(); const form=event.currentTarget,raw=Object.fromEntries(new FormData(form)); raw.tags = raw.tags.split(",").map(v=>v.trim()).filter(Boolean); raw.allowedUids=[...form.elements.allowedUids.selectedOptions].map(v=>v.value);raw.allowedGroupIds=[...form.elements.allowedGroupIds.selectedOptions].map(v=>v.value); try { const response = await api(`/v1/photos/${photo.id}`, { method:"PATCH", body:JSON.stringify(raw) }); Object.assign(photo, await response.json()); $("#detail-dialog").close(); await loadPhotos(); notify("撮影情報を保存しました。"); } catch(error){ notify(error.message,true); } });
  }

  function uploadMetadata() { const raw = Object.fromEntries(new FormData($("#upload-form"))); raw.tags = raw.tags.split(",").map(value => value.trim()).filter(Boolean); raw.albumIds = raw.albumIds ? [raw.albumIds] : []; raw.allowedUids = []; raw.allowedGroupIds = []; return raw; }
  function individualMetadata() { return state.files.map(entry => ({ title: entry.title, category: entry.category, capturedAt: entry.capturedAt, location: entry.location, station: entry.station, trainNumber: entry.trainNumber, tags: entry.tags.split(",").map(value => value.trim()).filter(Boolean) })); }
  function releaseFile(entry) { if (entry.preview) URL.revokeObjectURL(entry.preview); }
  function makeFileEntry(file) { return { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, file, preview: URL.createObjectURL(file), title: file.name.replace(/\.[^.]+$/, ""), category: "", capturedAt: "", location: "", station: "", trainNumber: "", tags: "" }; }
  function selectFiles(files) {
    const existing = new Set(state.files.map(entry => `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`));
    [...files].filter(file => file.type.startsWith("image/")).forEach(file => { const key = `${file.name}:${file.size}:${file.lastModified}`; if (!existing.has(key) && state.files.length < 100) { state.files.push(makeFileEntry(file)); existing.add(key); } });
    renderQueue();
  }
  async function upload() {
    if (!state.access.canUpload) return notify("管理用アカウントから写真は登録できません。", true);
    if (!state.files.length) return notify("写真を選択してください。", true);
    const form = new FormData(); state.files.forEach(entry => form.append("files", entry.file)); form.append("metadata", JSON.stringify(uploadMetadata())); form.append("fileMetadata", JSON.stringify(individualMetadata()));
    const user = await window.TayunetFirebaseDataAuth.currentUser(); const token = await user.getIdToken();
    $("#upload-progress").hidden = false; $("#upload-status").textContent = "Ubuntu HDDへ保存しています…";
    const xhr = new XMLHttpRequest(); xhr.open("POST", `${API}/v1/photos`); xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = event => { if (event.lengthComputable) $("#upload-progress span").style.width = `${event.loaded / event.total * 100}%`; };
    xhr.onload = async () => { if (xhr.status >= 200 && xhr.status < 300) { $("#upload-status").textContent = `${state.files.length}枚を保存しました。`; state.files.forEach(releaseFile); state.files=[]; renderQueue(); setTimeout(()=>$("#upload-dialog").close(),700); await loadPhotos(); notify("写真ごとの情報、EXIF、サムネイルを保存しました。"); } else { let message="アップロードに失敗しました"; try{message=JSON.parse(xhr.responseText).detail||message}catch(_){} $("#upload-status").textContent=message; } };
    xhr.onerror = () => { $("#upload-status").textContent = "写真APIへ接続できません。"; }; xhr.send(form);
  }

  function renderQueue() {
    $("#batch-guide").hidden = !state.files.length;
    $("#file-queue").innerHTML = state.files.map((entry, index) => `<article class="file-editor" data-file-id="${entry.id}"><div class="file-editor-head"><img src="${entry.preview}" alt=""><div><b>${index + 1}. ${escapeHtml(entry.file.name)}</b><small>${bytes(entry.file.size)}</small></div><button type="button" data-remove-file="${entry.id}" aria-label="${escapeHtml(entry.file.name)}を外す">×</button></div><label>タイトル<input data-file-field="title" value="${escapeHtml(entry.title)}" maxlength="1000"></label><details><summary>この写真だけの情報を編集</summary><div class="file-editor-grid"><label>種類<select data-file-field="category"><option value="">共通設定を使用</option>${["train","freight","landscape","other"].map(value=>`<option value="${value}" ${entry.category===value?"selected":""}>${category(value)}</option>`).join("")}</select></label><label>撮影日時<input data-file-field="capturedAt" type="datetime-local" value="${escapeHtml(entry.capturedAt)}"></label><label>撮影場所<input data-file-field="location" value="${escapeHtml(entry.location)}"></label><label>駅<input data-file-field="station" value="${escapeHtml(entry.station)}"></label><label>列車番号<input data-file-field="trainNumber" value="${escapeHtml(entry.trainNumber)}"></label><label>タグ<input data-file-field="tags" value="${escapeHtml(entry.tags)}" placeholder="カンマ区切り"></label></div></details></article>`).join("");
  }
  async function shareTarget(targetType,targetId,label) {
    const dialog=$("#share-dialog"); dialog.innerHTML=`<form class="panel-pad" id="share-form"><h2>限定リンクを作成</h2><p>${escapeHtml(label)}</p><label>パスワード（任意）<input name="password" type="password"></label><label>有効期限（任意）<input name="expiresAt" type="datetime-local"></label><div class="dialog-actions"><button type="button" class="ghost" data-close="share-dialog">キャンセル</button><button class="primary">リンクを作る</button></div></form>`; dialog.showModal(); $("#share-form").addEventListener("submit",async event=>{event.preventDefault();const raw=Object.fromEntries(new FormData(event.currentTarget));raw.targetType=targetType;raw.targetId=targetId;try{const response=await api("/v1/shares",{method:"POST",body:JSON.stringify(raw)});const result=await response.json();dialog.innerHTML=`<div class="panel-pad"><h2>共有リンクを作成しました</h2><p>${result.passwordRequired?"設定したパスワードを別の方法で相手へ伝えてください。":"リンクを知っている人が閲覧できます。"}</p><input class="share-url" value="${escapeHtml(result.url)}" readonly><div class="dialog-actions"><button class="ghost" data-copy="${escapeHtml(result.url)}">コピー</button><button class="primary" data-close="share-dialog">閉じる</button></div></div>`;}catch(error){notify(error.message,true)}});
  }

  async function download(path, filename) { const response = await api(path); const url = URL.createObjectURL(await response.blob()); const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000); }

  function personName(person) { return person.displayName || person.email.split("@")[0]; }
  function directoryRow(person) {
    const action = person.relationship === "accepted" ? `<span class="relation-badge">フレンド</span>` : person.incoming ? `<button class="primary" data-friend="${person.uid}">承認する</button>` : person.relationship === "pending" ? `<span class="relation-badge pending">申請中</span>` : `<button data-friend="${person.uid}">追加する</button>`;
    return `<div class="person-row"><span class="person-identity"><b>${escapeHtml(personName(person))}</b><small>${escapeHtml(person.email)}</small></span>${action}</div>`;
  }
  async function searchPeople() {
    const query = $("#people-query")?.value || "";
    const target = $("#directory-results"); if (!target) return;
    target.innerHTML = `<p class="muted">利用者を探しています…</p>`;
    try { const response=await api(`/v1/directory?q=${encodeURIComponent(query)}`);const people=(await response.json()).items;target.innerHTML=people.map(directoryRow).join("")||`<p class="muted">該当する利用者はいません。</p>`; }
    catch(error){target.innerHTML=`<p class="error-text">${escapeHtml(error.message)}</p>`;}
  }
  async function showPeople() {
    const dialog=$("#people-dialog");
    try {
      const [friendResponse,groupResponse,directoryResponse]=await Promise.all([api("/v1/friends"),api("/v1/groups"),api("/v1/directory")]);
      const friends=(await friendResponse.json()).items,groups=(await groupResponse.json()).items,suggestions=(await directoryResponse.json()).items;
      const accepted=friends.filter(item=>item.status==="accepted"),incoming=friends.filter(item=>item.incoming),outgoing=friends.filter(item=>item.status==="pending"&&!item.incoming);
      dialog.innerHTML=`<div class="panel-pad people-panel"><div class="people-heading"><div><small>FRIEND & GROUP</small><h2>共有メンバー</h2><p>候補から追加するか、名前・メールアドレスで検索できます。</p></div><div class="people-counts"><span><b>${accepted.length}</b>フレンド</span><span><b>${incoming.length}</b>承認待ち</span></div></div>${incoming.length?`<section class="people-section attention"><h3>あなたへの申請</h3>${incoming.map(directoryRow).join("")}</section>`:""}<section class="people-section"><h3>利用者を探す</h3><div class="people-search"><input id="people-query" type="search" placeholder="名前・メールアドレス（2文字以上）"><button class="primary" id="people-search">検索</button></div><div id="directory-results" class="directory-results">${suggestions.map(directoryRow).join("")||`<p class="muted">候補がまだありません。メールアドレスで検索してください。</p>`}</div></section><section class="people-section"><h3>フレンド一覧</h3>${accepted.length?accepted.map(friend=>`<div class="person-row"><label class="person-choice"><input class="group-member" type="checkbox" value="${friend.uid}"><span class="person-identity"><b>${escapeHtml(personName(friend))}</b><small>${escapeHtml(friend.email)}</small></span></label><button class="quiet-danger" data-remove-friend="${friend.uid}">解除</button></div>`).join(""):`<p class="muted">フレンドを追加すると写真の共有先に選べます。</p>`}${outgoing.map(friend=>`<div class="person-row"><span class="person-identity"><b>${escapeHtml(personName(friend))}</b><small>${escapeHtml(friend.email)} · 申請中</small></span><button data-remove-friend="${friend.uid}">取消</button></div>`).join("")}<div class="dialog-actions"><button id="new-group" ${accepted.length?"":"disabled"}>選択した人でグループ作成</button></div></section><section class="people-section"><h3>グループ</h3>${groups.map(group=>`<div class="person-row"><span><b>${escapeHtml(group.name)}</b></span><small>${group.members.length}人</small></div>`).join("")||`<p class="muted">フレンドを選択してグループを作成できます。</p>`}</section><div class="dialog-actions"><button class="ghost" data-close="people-dialog">閉じる</button></div></div>`;
      if(!dialog.open)dialog.showModal();
    } catch(error) { notify(error.message,true); }
  }

  document.addEventListener("click", async event => {
    const mobileMenuButton=event.target.closest("#mobile-menu-button");if(mobileMenuButton){setMobileMenuOpen($("#mobile-action-menu").hidden);return;}
    const mobileFriend=event.target.closest("#mobile-friend-button");if(mobileFriend){setMobileMenuOpen(false);return showPeople();}
    const mobileUpload=event.target.closest("#mobile-upload-button");if(mobileUpload){setMobileMenuOpen(false);if(!state.access.canUpload)return notify("このアカウントは閲覧・管理専用です。",true);$("#upload-dialog").showModal();return;}
    const mobileLogout=event.target.closest("#mobile-logout-button");if(mobileLogout){setMobileMenuOpen(false);$("#firebase-logout-button").click();return;}
    if(!$("#mobile-action-menu").hidden&&!event.target.closest("#mobile-action-menu"))setMobileMenuOpen(false);
    const close = event.target.closest("[data-close]"); if (close) return $(`#${close.dataset.close}`).close();
    const removeFile = event.target.closest("[data-remove-file]"); if (removeFile) { const index=state.files.findIndex(entry=>entry.id===removeFile.dataset.removeFile);if(index>=0){releaseFile(state.files[index]);state.files.splice(index,1);renderQueue()}return; }
    const cardButton = event.target.closest(".open-card,.calendar-photo"); if (cardButton) return openDetail(cardButton.closest("[data-id]").dataset.id);
    const scope = event.target.closest("[data-scope]"); if (scope) { $$("[data-scope]").forEach(button=>button.classList.toggle("active",button===scope)); state.scope=scope.dataset.scope; $("#list-title").textContent=labels[state.scope]; await loadPhotos(); return; }
    const view = event.target.closest("[data-view]"); if (view) { $$(`[data-view]`).forEach(button=>button.classList.toggle("active",button===view)); state.view=view.dataset.view; if(state.view==="grid"||state.view==="timeline")renderGrid();else if(state.view==="calendar")renderCalendar();else renderMap(); return; }
    if (event.target.closest("#upload-button")) { if(!state.access.canUpload)return notify("このアカウントは閲覧・管理専用です。",true); return $("#upload-dialog").showModal(); }
    if (event.target.closest("#friend-button")) return showPeople();
    const action=event.target.closest("[data-action]"); if(action){const dialog=$("#detail-dialog");const photo=state.photos.find(item=>item.id===dialog.dataset.photoId);if(!photo)return; if(action.dataset.action==="edit")return editDetail(photo);if(action.dataset.action==="share")return shareTarget("photo",photo.id,photo.title||photo.filename);if(action.dataset.action==="download")return download(`/v1/photos/${photo.id}/media/original`,photo.filename);if(action.dataset.action==="delete"&&confirm("この写真をゴミ箱へ移しますか？")){await api(`/v1/photos/${photo.id}`,{method:"DELETE"});dialog.close();await loadPhotos();}if(action.dataset.action==="restore"){await api(`/v1/photos/${photo.id}/restore`,{method:"POST"});dialog.close();await loadPhotos();}return;}
    const copy=event.target.closest("[data-copy]");if(copy){await navigator.clipboard.writeText(copy.dataset.copy);copy.textContent="コピーしました";return;}
    const exportButton=event.target.closest("[data-export]");if(exportButton){const type=exportButton.dataset.export;return download(type==="zip"?"/v1/export/originals.zip":`/v1/export/metadata.${type}`,`photo-archive.${type}`);}
    if(event.target.closest("#new-album")){if(!state.access.canUpload)return notify("管理用アカウントからアルバムは登録できません。",true);const title=prompt("アルバム名");if(title){await api("/v1/albums",{method:"POST",body:JSON.stringify({title,visibility:"private"})});await renderAlbums();}return;}
    const albumShare=event.target.closest("[data-share-album]");if(albumShare){const album=state.albums.find(item=>item.id===albumShare.dataset.shareAlbum);return shareTarget("album",album.id,album.title);}
    const album=event.target.closest("[data-open-album]");if(album){const response=await api(`/v1/albums/${album.dataset.openAlbum}/photos`);const data=await response.json();state.photos=data.items;state.scope="mine";$("#list-title").textContent=data.album.title;renderGrid();return;}
    if(event.target.closest("#people-search")){await searchPeople();return;}
    const friend=event.target.closest("[data-friend]");if(friend){await api(`/v1/friends/${friend.dataset.friend}`,{method:"POST"});await showPeople();return;}
    const removeFriend=event.target.closest("[data-remove-friend]");if(removeFriend){await api(`/v1/friends/${removeFriend.dataset.removeFriend}`,{method:"DELETE"});await showPeople();return;}
    if(event.target.closest("#new-group")){const name=prompt("グループ名を入力してください");if(!name)return;const members=$$(".group-member:checked").map(input=>input.value);await api("/v1/groups",{method:"POST",body:JSON.stringify({name,members})});await showPeople();return;}
  });

  document.addEventListener("input", event => {
    const field=event.target.closest("[data-file-field]");if(field){const editor=field.closest("[data-file-id]");const entry=state.files.find(item=>item.id===editor.dataset.fileId);if(entry)entry[field.dataset.fileField]=field.value;return;}
    if(event.target.matches("#people-query")&&event.inputType==="insertLineBreak")searchPeople();
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
  window.addEventListener("resize", () => { if (!window.matchMedia("(max-width: 1180px)").matches) setFiltersOpen(false);if(!window.matchMedia("(max-width: 900px)").matches)setMobileMenuOpen(false); });

  window.TayunetAuthReady.then(async ready => {
    if (!ready.ok) return;
    const firebaseUser=await window.TayunetFirebaseDataAuth.currentUser();state.currentUser={uid:firebaseUser.uid,email:firebaseUser.email||""};
    $("#mobile-user-info").textContent=state.currentUser.email?`${state.currentUser.email} でログイン中`:"ログイン中";
    const localManager=["admin@tayunet-traininfo.com","systemadmin@tayunet-traininfo.com"].includes(state.currentUser.email.toLowerCase());
    applyAccess({canUpload:!localManager,canManage:localManager,role:localManager?"manager":"contributor"});
    $("#auth-cover").remove(); $("#main-content").hidden=false;
    try { const response=await fetch(`${API}/health`,{cache:"no-store"});if(!response.ok)throw new Error(`HTTP ${response.status}`);const health=await response.json();$("#storage-count").textContent=bytes(health.storage.usedBytes);$("#trash-days").textContent=`${health.trashDays}日`;$("#photo-count").textContent=health.photos;$("#api-status").className="state-lamp online";$("#api-status").innerHTML="<i></i>写真API 正常"; } catch(_){$("#storage-count").textContent="確認不可";$("#api-status").className="state-lamp error";$("#api-status").innerHTML="<i></i>写真API 未接続";}
    try { const response=await api("/v1/me");applyAccess(await response.json()); } catch(error) { notify(error.message,true); }
    try { const response=await api("/v1/albums");state.albums=(await response.json()).items;$("#upload-album").innerHTML=`<option value="">なし</option>${state.albums.map(album=>`<option value="${album.id}">${escapeHtml(album.title)}</option>`).join("")}`; } catch(_) {}
    await loadPhotos();
  });
})();
