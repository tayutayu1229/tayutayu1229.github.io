(function () {
  "use strict";

  const API_ORIGIN = "https://secure.tayunet-traininfo.com";
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const LOGIN_URL = `/index.html?return=${encodeURIComponent(returnTo)}&reason=login_required`;
  const AUTH_HELPER_URL = "/T-time/firebase-data-auth.js";
  const TIMETABLE_MANIFEST_PATH = "/api/timetable-files";
  let authHelperPromise;

  class PrivateDataError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "PrivateDataError";
      this.code = code;
    }
  }

  function loadAuthHelper() {
    if (window.TayunetFirebaseDataAuth) return Promise.resolve(window.TayunetFirebaseDataAuth);
    if (authHelperPromise) return authHelperPromise;
    authHelperPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = AUTH_HELPER_URL;
      script.onload = () => window.TayunetFirebaseDataAuth
        ? resolve(window.TayunetFirebaseDataAuth)
        : reject(new PrivateDataError("Firebase認証ヘルパーを読み込めませんでした。", "firebase_unavailable"));
      script.onerror = () => reject(new PrivateDataError("Firebase認証ヘルパーを読み込めませんでした。", "firebase_unavailable"));
      document.head.appendChild(script);
    });
    return authHelperPromise;
  }

  function showLoginNotice(messageText) {
    if (!document.body || document.getElementById("tayunet-private-data-notice")) return;
    const notice = document.createElement("div");
    notice.id = "tayunet-private-data-notice";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;padding:14px 16px;background:#fff;border:2px solid #087f5b;border-radius:8px;box-shadow:0 6px 24px #0004;color:#17352c;font:14px/1.5 sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap";
    const message = document.createElement("span");
    message.textContent = messageText || "時刻表データを表示するには通常のTAYUNETログインが必要です。";
    message.style.flex = "1 1 320px";
    const login = document.createElement("a");
    login.href = LOGIN_URL;
    login.textContent = "ログインして元の画面へ戻る";
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
      const authHelper = await loadAuthHelper();
      const token = await authHelper.getIdToken();
      response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
      });
      if (response.status === 401) {
        const refreshedToken = await authHelper.getIdToken(true);
        response = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json", Authorization: `Bearer ${refreshedToken}` }
        });
      }
    } catch (error) {
      const firebaseMessage = error?.code === "firebase_login_required"
        ? "システムへFirebaseログインしてから、画面を再読み込みしてください。"
        : "保護データへ接続できません。通信状態を確認して通常のTAYUNETログインをやり直してください。";
      showLoginNotice(firebaseMessage);
      throw new PrivateDataError(
        firebaseMessage,
        error?.code || "access_required"
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      let errorCode = response.status === 401 ? "firebase_login_required" : "access_required";
      try {
        const payload = contentType.includes("application/json") ? await response.clone().json() : null;
        if (payload?.error) errorCode = payload.error;
      } catch (_error) { /* use the status-derived error */ }
      const message = errorCode === "firebase_not_approved"
        ? "このFirebaseアカウントはデータ利用が未承認、停止中、または無効です。管理者へ確認してください。"
        : "保護データの認証を確認できません。通常のTAYUNETログインをやり直してください。";
      showLoginNotice(message);
      throw new PrivateDataError(
        message,
        errorCode
      );
    }

    return response.json();
  }

  async function fetchTimetables(params) {
    const manifest = await fetchJson(TIMETABLE_MANIFEST_PATH);
    if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
      throw new PrivateDataError("時刻表ファイル一覧の応答形式が不正です。", "invalid_response");
    }
    const payloads = await Promise.all(manifest.files.map(async fileName => {
      const payload = await fetchJson(`/api/timetables/${encodeURIComponent(fileName)}`, params);
      if (!payload || !Array.isArray(payload.items)) {
        throw new PrivateDataError(`${fileName} の応答形式が不正です。`, "invalid_response");
      }
      return payload.items;
    }));
    return payloads.flat();
  }

  async function fetchStations() {
    return fetchJson("/api/stations");
  }

  function openLogin() {
    window.location.href = LOGIN_URL;
  }

  window.TayunetPrivateData = Object.freeze({
    API_ORIGIN,
    LOGIN_URL,
    PrivateDataError,
    TIMETABLE_MANIFEST_PATH,
    fetchTimetables,
    fetchStations,
    openLogin,
    showLoginNotice
  });
})();
