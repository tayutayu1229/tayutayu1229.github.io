(function () {
  "use strict";
  const API = "https://photo-api.tayunet-traininfo.com";
  const token = new URLSearchParams(location.search).get("token") || "";
  const content = document.getElementById("public-content");
  const unlock = document.getElementById("public-unlock");
  const unlockForm = document.getElementById("unlock-form");
  const unlockStatus = document.getElementById("share-unlock-status");
  const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  let password = "";
  const objectUrls = [];

  function setUnlockStatus(message = "", type = "") {
    unlockStatus.textContent = message;
    unlockStatus.className = `form-status${type ? ` ${type}` : ""}`;
    unlockStatus.hidden = !message;
  }

  function setUnlockBusy(busy) {
    const button = unlockForm.querySelector("button");
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.textContent = busy ? "確認中…" : "開く";
  }

  async function request(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`${API}${path}`, { headers: password ? { "X-Share-Password": password } : {}, signal: controller.signal, cache: "no-store" });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("通信が時間内に完了しませんでした。もう一度お試しください。");
      throw new Error("写真サーバーへ接続できません。通信状態を確認してください。");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) { unlock.hidden = false; content.hidden = true; throw new Error("password"); }
    if (!response.ok) {
      if (response.status === 404) throw new Error("共有リンクが無効、期限切れ、または写真が削除されています。");
      if (response.status >= 500) throw new Error("写真サーバーで一時的な問題が発生しています。少し待ってから再度お試しください。");
      throw new Error("共有記録を読み込めませんでした。");
    }
    return response;
  }

  async function media(photo, variant = "thumbnail") {
    const response = await request(`/public/${encodeURIComponent(token)}/media/${photo.id}/${variant}`);
    const url = URL.createObjectURL(await response.blob());
    objectUrls.push(url);
    return url;
  }

  function rows(photo) {
    return [["列車番号", photo.trainNumber], ["始発・終着", [photo.origin, photo.destination].filter(Boolean).join(" → ")], ["列車種別", photo.trainType], ["始発駅日付", photo.serviceDate], ["変更事項", photo.changes], ["撮影日時", photo.capturedAt], ["撮影場所", photo.location], ["駅", photo.station], ["輸送経路", photo.transportRoute], ["記事・備考", photo.article], ["フリーメモ", photo.notes], ["カメラ", photo.camera], ["レンズ", photo.lens], ["シャッター", photo.shutterSpeed], ["F値", photo.aperture], ["ISO", photo.iso], ["焦点距離", photo.focalLength], ["タグ", photo.tags.join(" / ")]].filter(([, value]) => value).map(([key, value]) => `<div class="data-group"><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("");
  }

  async function load() {
    content.hidden = false;
    if (!password) content.innerHTML = `<div class="dialog-loading"><div class="spinner"></div><p>共有記録を読み込んでいます…</p></div>`;
    try {
      const response = await request(`/public/${encodeURIComponent(token)}`);
      const data = await response.json();
      unlock.hidden = true; content.hidden = false; setUnlockStatus();
      if (data.type === "photo") {
        const photo = data.item;
        content.innerHTML = `<article class="public-record"><div class="detail-top"><h2>${esc(photo.trainNumber ? `第 ${photo.trainNumber} 列車` : photo.title || photo.filename)}</h2></div><div class="detail-layout"><div class="detail-photo"><div class="dialog-loading"><div class="spinner"></div><p>原本画像を読み込んでいます…</p></div></div><dl class="detail-data">${rows(photo)}</dl></div></article>`;
        document.querySelector(".detail-photo").innerHTML = `<img src="${await media(photo, "original")}" alt="${esc(photo.title || photo.filename)}">`;
      } else {
        content.innerHTML = `<h1>${esc(data.album.title)}</h1><p>${esc(data.album.description)}</p><div class="public-album">${data.items.map(photo => `<figure data-id="${photo.id}"><div class="photo-image loading-card"><img alt="${esc(photo.title || photo.filename)}"></div><figcaption><b>${esc(photo.title || photo.trainNumber || photo.filename)}</b><br><small>${esc(photo.capturedAt || photo.location || "")}</small></figcaption></figure>`).join("")}</div>`;
        await Promise.all(data.items.map(async photo => { document.querySelector(`[data-id="${photo.id}"] img`).src = await media(photo); }));
      }
    } catch (error) {
      if (error.message === "password") {
        setUnlockStatus(password ? "パスワードが違います。入力内容を確認してください。" : "パスワードを入力してください。", "error");
        document.getElementById("share-password").focus();
      } else {
        content.hidden = false;
        content.innerHTML = `<div class="unlock-card"><h1>表示できません</h1><p>${esc(error.message)}</p><button class="primary" id="retry-share">再試行</button></div>`;
        document.getElementById("retry-share")?.addEventListener("click", load);
      }
    } finally {
      setUnlockBusy(false);
    }
  }

  unlockForm.addEventListener("submit", event => {
    event.preventDefault(); password = document.getElementById("share-password").value;
    setUnlockBusy(true); setUnlockStatus("パスワードを確認しています…", "loading"); load();
  });
  window.addEventListener("beforeunload", () => objectUrls.forEach(URL.revokeObjectURL));
  if (!token) content.innerHTML = '<div class="unlock-card"><h1>共有リンクがありません</h1><p>送られたURLを省略せずに開いてください。</p></div>';
  else load();
})();
