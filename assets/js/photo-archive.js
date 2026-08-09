(function () {
  "use strict";
  const API = "https://photo-api.tayunet-traininfo.com";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { scope: "mine", view: "grid", photos: [], albums: [], files: [], blobs: new Map(), map: null, mapLayer: null, mapRenderer: null, leafletPromise: null, mapRenderId: 0 };
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
    const response = await fetch(`${API}${path}`, { ...options, headers, mode: "cors", cache: "no-store" });
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
    $("#photo-list").hidden = true; $("#calendar-view").hidden = true; $("#album-view").hidden = true; $("#map-view").hidden = false;
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
    $("#album-view").innerHTML = `<button class="album-card album-create" id="new-album">＋ 新しいアルバム</button>${state.albums.map(album => `<div class="album-card" data-album="${album.id}"><h3>${escapeHtml(album.title)}</h3><p>${escapeHtml(album.description)}</p><span>${album.photoCount}枚 · ${visibility(album.visibility)}</span><div class="dialog-actions"><button data-open-album="${album.id}">開く</button><button data-share-album="${album.id}">限定リンク</button></div></div>`).join("")}`;
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
    catch (error) { notify(error.message, true); $("#result-count").textContent = "取得失敗"; }
  }

  function setFiltersOpen(open) {
    const enabled = open && window.matchMedia("(max-width: 1180px)").matches;
    document.body.classList.toggle("filters-open", enabled);
    $("#filter-toggle").setAttribute("aria-expanded", String(enabled));
    $("#filter-backdrop").tabIndex = enabled ? 0 : -1;
    if (enabled) setTimeout(() => $("#search-q").focus(), 180);
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
    dialog.innerHTML = `<div class="detail-shell"><div class="detail-top"><h2>${escapeHtml(photo.trainNumber ? `第 ${photo.trainNumber} 列車` : (photo.title || photo.filename))}</h2><button data-close="detail-dialog">×</button></div><div class="detail-layout"><div class="detail-photo"><div class="spinner"></div></div><dl class="detail-data">${dataRows(photo)}</dl></div><div class="detail-actions">${photo.ownerUid === (await window.TayunetFirebaseDataAuth.currentUser()).uid ? `<button data-action="edit">編集</button><button data-action="share">限定リンク</button><button data-action="download">原本</button>${photo.deletedAt ? `<button data-action="restore">復元</button>` : `<button class="danger" data-action="delete">ゴミ箱へ</button>`}` : `<button data-action="download">原本</button>`}</div></div>`;
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
  async function upload() {
    if (!state.files.length) return notify("写真を選択してください。", true);
    const form = new FormData(); state.files.forEach(file => form.append("files", file)); form.append("metadata", JSON.stringify(uploadMetadata()));
    const user = await window.TayunetFirebaseDataAuth.currentUser(); const token = await user.getIdToken();
    $("#upload-progress").hidden = false; $("#upload-status").textContent = "Ubuntu HDDへ保存しています…";
    const xhr = new XMLHttpRequest(); xhr.open("POST", `${API}/v1/photos`); xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = event => { if (event.lengthComputable) $("#upload-progress span").style.width = `${event.loaded / event.total * 100}%`; };
    xhr.onload = async () => { if (xhr.status >= 200 && xhr.status < 300) { $("#upload-status").textContent = `${state.files.length}枚を保存しました。`; state.files=[]; renderQueue(); setTimeout(()=>$("#upload-dialog").close(),700); await loadPhotos(); notify("EXIFとサムネイルを含めて保存しました。"); } else { let message="アップロードに失敗しました"; try{message=JSON.parse(xhr.responseText).detail||message}catch(_){} $("#upload-status").textContent=message; } };
    xhr.onerror = () => { $("#upload-status").textContent = "写真APIへ接続できません。"; }; xhr.send(form);
  }

  function renderQueue() { $("#file-queue").innerHTML = state.files.map(file => `<span class="file-pill">${escapeHtml(file.name)} · ${bytes(file.size)}</span>`).join(""); }
  async function shareTarget(targetType,targetId,label) {
    const dialog=$("#share-dialog"); dialog.innerHTML=`<form class="panel-pad" id="share-form"><h2>限定リンクを作成</h2><p>${escapeHtml(label)}</p><label>パスワード（任意）<input name="password" type="password"></label><label>有効期限（任意）<input name="expiresAt" type="datetime-local"></label><div class="dialog-actions"><button type="button" class="ghost" data-close="share-dialog">キャンセル</button><button class="primary">リンクを作る</button></div></form>`; dialog.showModal(); $("#share-form").addEventListener("submit",async event=>{event.preventDefault();const raw=Object.fromEntries(new FormData(event.currentTarget));raw.targetType=targetType;raw.targetId=targetId;try{const response=await api("/v1/shares",{method:"POST",body:JSON.stringify(raw)});const result=await response.json();dialog.innerHTML=`<div class="panel-pad"><h2>共有リンクを作成しました</h2><p>${result.passwordRequired?"設定したパスワードを別の方法で相手へ伝えてください。":"リンクを知っている人が閲覧できます。"}</p><input class="share-url" value="${escapeHtml(result.url)}" readonly><div class="dialog-actions"><button class="ghost" data-copy="${escapeHtml(result.url)}">コピー</button><button class="primary" data-close="share-dialog">閉じる</button></div></div>`;}catch(error){notify(error.message,true)}});
  }

  async function download(path, filename) { const response = await api(path); const url = URL.createObjectURL(await response.blob()); const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000); }

  async function showPeople() {
    const dialog=$("#people-dialog"); const [friendResponse,groupResponse]=await Promise.all([api("/v1/friends"),api("/v1/groups")]); const friends=(await friendResponse.json()).items,groups=(await groupResponse.json()).items;
    dialog.innerHTML=`<div class="panel-pad"><h2>共有メンバー</h2><p>撮影記録アーカイブを一度開いたFirebase利用者をメールで探せます。</p><div class="people-search"><input id="people-query" type="search" placeholder="メールアドレス（3文字以上）"><button class="primary" id="people-search">検索</button></div><div class="people-list"><h3>フレンド</h3>${friends.length?friends.map(friend=>`<div class="person-row"><label><input class="group-member" type="checkbox" value="${friend.uid}" ${friend.status!=="accepted"?"disabled":""}> ${escapeHtml(friend.email)} <small>${friend.status==="accepted"?"承認済み":friend.incoming?"承認待ち（相手から）":"申請中"}</small></label>${friend.incoming?`<button data-friend="${friend.uid}">承認</button>`:""}</div>`).join(""):"<p>まだフレンドはいません。</p>"}<div class="dialog-actions"><button id="new-group">選択した人でグループ作成</button></div><h3>グループ</h3>${groups.map(group=>`<div class="person-row"><span>${escapeHtml(group.name)}</span><small>${group.members.length}人</small></div>`).join("")||"<p>まだグループはありません。</p>"}</div><div class="dialog-actions"><button class="ghost" data-close="people-dialog">閉じる</button></div></div>`;if(!dialog.open)dialog.showModal();
  }

  document.addEventListener("click", async event => {
    const close = event.target.closest("[data-close]"); if (close) return $(`#${close.dataset.close}`).close();
    const cardButton = event.target.closest(".open-card,.calendar-photo"); if (cardButton) return openDetail(cardButton.closest("[data-id]").dataset.id);
    const scope = event.target.closest("[data-scope]"); if (scope) { $$("[data-scope]").forEach(button=>button.classList.toggle("active",button===scope)); state.scope=scope.dataset.scope; $("#list-title").textContent=labels[state.scope]; await loadPhotos(); return; }
    const view = event.target.closest("[data-view]"); if (view) { $$(`[data-view]`).forEach(button=>button.classList.toggle("active",button===view)); state.view=view.dataset.view; if(state.view==="grid"||state.view==="timeline")renderGrid();else if(state.view==="calendar")renderCalendar();else renderMap(); return; }
    if (event.target.closest("#upload-button")) return $("#upload-dialog").showModal();
    if (event.target.closest("#friend-button")) return showPeople();
    const action=event.target.closest("[data-action]"); if(action){const dialog=$("#detail-dialog");const photo=state.photos.find(item=>item.id===dialog.dataset.photoId);if(!photo)return; if(action.dataset.action==="edit")return editDetail(photo);if(action.dataset.action==="share")return shareTarget("photo",photo.id,photo.title||photo.filename);if(action.dataset.action==="download")return download(`/v1/photos/${photo.id}/media/original`,photo.filename);if(action.dataset.action==="delete"&&confirm("この写真をゴミ箱へ移しますか？")){await api(`/v1/photos/${photo.id}`,{method:"DELETE"});dialog.close();await loadPhotos();}if(action.dataset.action==="restore"){await api(`/v1/photos/${photo.id}/restore`,{method:"POST"});dialog.close();await loadPhotos();}return;}
    const copy=event.target.closest("[data-copy]");if(copy){await navigator.clipboard.writeText(copy.dataset.copy);copy.textContent="コピーしました";return;}
    const exportButton=event.target.closest("[data-export]");if(exportButton){const type=exportButton.dataset.export;return download(type==="zip"?"/v1/export/originals.zip":`/v1/export/metadata.${type}`,`photo-archive.${type}`);}
    if(event.target.closest("#new-album")){const title=prompt("アルバム名");if(title){await api("/v1/albums",{method:"POST",body:JSON.stringify({title,visibility:"private"})});await renderAlbums();}return;}
    const albumShare=event.target.closest("[data-share-album]");if(albumShare){const album=state.albums.find(item=>item.id===albumShare.dataset.shareAlbum);return shareTarget("album",album.id,album.title);}
    const album=event.target.closest("[data-open-album]");if(album){const response=await api(`/v1/albums/${album.dataset.openAlbum}/photos`);const data=await response.json();state.photos=data.items;state.scope="mine";$("#list-title").textContent=data.album.title;renderGrid();return;}
    if(event.target.closest("#people-search")){const q=$("#people-query").value;const response=await api(`/v1/directory?q=${encodeURIComponent(q)}`);const people=(await response.json()).items;$(".people-list").innerHTML=`<h3>検索結果</h3>${people.map(person=>`<div class="person-row"><span>${escapeHtml(person.email)}</span><button data-friend="${person.uid}">追加</button></div>`).join("")||"<p>見つかりませんでした。</p>"}`;return;}
    const friend=event.target.closest("[data-friend]");if(friend){await api(`/v1/friends/${friend.dataset.friend}`,{method:"POST"});await showPeople();return;}
    if(event.target.closest("#new-group")){const name=prompt("グループ名を入力してください");if(!name)return;const members=$$(".group-member:checked").map(input=>input.value);await api("/v1/groups",{method:"POST",body:JSON.stringify({name,members})});await showPeople();return;}
  });

  $("#drop-zone").addEventListener("click",()=>$("#file-input").click()); $("#drop-zone").addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" ")$("#file-input").click()});
  $("#file-input").addEventListener("change",event=>{state.files=[...event.target.files];renderQueue()});
  ["dragenter","dragover"].forEach(type=>$("#drop-zone").addEventListener(type,event=>{event.preventDefault();event.currentTarget.classList.add("drag")}));
  ["dragleave","drop"].forEach(type=>$("#drop-zone").addEventListener(type,event=>{event.preventDefault();event.currentTarget.classList.remove("drag")}));
  $("#drop-zone").addEventListener("drop",event=>{state.files=[...event.dataTransfer.files].filter(file=>file.type.startsWith("image/"));renderQueue()});
  $("#upload-form").addEventListener("submit",event=>{event.preventDefault();upload()});
  $("#filter-toggle").addEventListener("click", () => setFiltersOpen(true));
  $("#filter-close").addEventListener("click", () => setFiltersOpen(false));
  $("#filter-backdrop").addEventListener("click", () => setFiltersOpen(false));
  $("#apply-filters").addEventListener("click", async () => { await loadPhotos(); setFiltersOpen(false); });
  $("#search-q").addEventListener("keydown", async event=>{if(event.key==="Enter"){await loadPhotos();setFiltersOpen(false)}});
  $("#clear-filters").addEventListener("click",async()=>{$$("#filters input,#filters select").forEach(input=>input.value="");await loadPhotos();setFiltersOpen(false)});
  document.addEventListener("keydown", event => { if (event.key === "Escape" && document.body.classList.contains("filters-open")) setFiltersOpen(false); });
  window.addEventListener("resize", () => { if (!window.matchMedia("(max-width: 1180px)").matches) setFiltersOpen(false); });

  window.TayunetAuthReady.then(async ready => {
    if (!ready.ok) return;
    $("#auth-cover").remove(); $("#main-content").hidden=false;
    try { const response=await fetch(`${API}/health`,{cache:"no-store"});if(!response.ok)throw new Error(`HTTP ${response.status}`);const health=await response.json();$("#storage-count").textContent=bytes(health.storage.usedBytes);$("#trash-days").textContent=`${health.trashDays}日`;$("#photo-count").textContent=health.photos;$("#api-status").className="state-lamp online";$("#api-status").innerHTML="<i></i>写真API 正常"; } catch(_){$("#storage-count").textContent="確認不可";$("#api-status").className="state-lamp error";$("#api-status").innerHTML="<i></i>写真API 未接続";}
    await renderAlbums(); await loadPhotos();
  });
})();
