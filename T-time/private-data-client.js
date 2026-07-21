(function () {
  "use strict";

  const API_ORIGIN = "https://secure.tayunet-traininfo.com";
  const LOGIN_URL = `${API_ORIGIN}/healthz`;

  class PrivateDataError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "PrivateDataError";
      this.code = code;
    }
  }

  function showLoginNotice() {
    if (!document.body || document.getElementById("tayunet-private-data-notice")) return;
    const notice = document.createElement("div");
    notice.id = "tayunet-private-data-notice";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;padding:14px 16px;background:#fff;border:2px solid #087f5b;border-radius:8px;box-shadow:0 6px 24px #0004;color:#17352c;font:14px/1.5 sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap";
    const message = document.createElement("span");
    message.textContent = "時刻表データの認証が必要です。ログイン後、この画面を再読み込みしてください。";
    message.style.flex = "1 1 320px";
    const login = document.createElement("a");
    login.href = LOGIN_URL;
    login.target = "_blank";
    login.rel = "noopener noreferrer";
    login.textContent = "データ用ログインを開く";
    login.style.cssText = "display:inline-block;padding:8px 12px;border-radius:5px;background:#087f5b;color:#fff;text-decoration:none;font-weight:700";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "再読み込み";
    reload.style.cssText = "padding:8px 12px;border:1px solid #087f5b;border-radius:5px;background:#fff;color:#087f5b;font-weight:700;cursor:pointer";
    reload.addEventListener("click", () => window.location.reload());
    notice.append(message, login, reload);
    document.body.appendChild(notice);
  }

  async function fetchJson(path, params) {
    const url = new URL(path, API_ORIGIN);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
    } catch (_error) {
      showLoginNotice();
      throw new PrivateDataError(
        "保護データへ接続できません。先にデータ用ログインを開き、認証後にこの画面を再読み込みしてください。",
        "access_required"
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      showLoginNotice();
      throw new PrivateDataError(
        "保護データの認証が必要です。データ用ログインを開いてから再読み込みしてください。",
        response.status === 403 ? "forbidden" : "access_required"
      );
    }

    return response.json();
  }

  async function fetchTimetables(params) {
    const payload = await fetchJson("/api/timetables", params);
    if (!payload || !Array.isArray(payload.items)) {
      throw new PrivateDataError("時刻表APIの応答形式が不正です。", "invalid_response");
    }
    return payload.items;
  }

  async function fetchStations() {
    return fetchJson("/api/stations");
  }

  function openLogin() {
    window.open(LOGIN_URL, "tayunet-private-data-login", "noopener,noreferrer");
  }

  window.TayunetPrivateData = Object.freeze({
    API_ORIGIN,
    LOGIN_URL,
    PrivateDataError,
    fetchTimetables,
    fetchStations,
    openLogin,
    showLoginNotice
  });
})();
