(function (global) {
  "use strict";

  const origin = "https://api.tayunet-traininfo.com";
  const authHelperUrl = "/T-time/firebase-data-auth.js";
  let authHelperPromise;

  function loadAuthHelper() {
    if (global.TayunetFirebaseDataAuth) return Promise.resolve(global.TayunetFirebaseDataAuth);
    if (authHelperPromise) return authHelperPromise;
    authHelperPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = authHelperUrl;
      script.onload = () => global.TayunetFirebaseDataAuth
        ? resolve(global.TayunetFirebaseDataAuth)
        : reject(new Error("Firebase認証ヘルパーを読み込めませんでした。"));
      script.onerror = () => reject(new Error("Firebase認証ヘルパーを読み込めませんでした。"));
      document.head.appendChild(script);
    });
    return authHelperPromise;
  }

  async function requestUrl(url, options) {
    const settings = Object.assign({
      credentials: "include",
      cache: "no-store",
    }, options || {});
    const authHelper = await loadAuthHelper();
    return fetch(url, await authHelper.authorizedOptions(settings));
  }

  function request(path, options) {
    return requestUrl(`${origin}${path}`, options);
  }

  function loginNotice(message) {
    const wrapper = document.createElement("div");
    wrapper.className = "tayunet-document-access-notice";
    wrapper.setAttribute("role", "alert");
    wrapper.style.cssText = "margin:12px 0;padding:14px;border:1px solid #d4a72c;border-radius:8px;background:#fff8dc;color:#3b2f00;line-height:1.6";

    const text = document.createElement("span");
    text.textContent = message || "運転関係書類を表示するにはデータ利用ログインが必要です。";
    wrapper.appendChild(text);
    wrapper.appendChild(document.createElement("br"));

    const login = document.createElement("a");
    login.href = `${origin}/api/files`;
    login.target = "_blank";
    login.rel = "noopener noreferrer";
    login.textContent = "データ利用ログインを開く";
    login.style.cssText = "font-weight:700;margin-right:14px";
    wrapper.appendChild(login);

    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "ログイン後に再読み込み";
    reload.addEventListener("click", () => location.reload());
    wrapper.appendChild(reload);
    return wrapper;
  }

  function showLoginNotice(container, message) {
    if (!container) return;
    container.replaceChildren(loginNotice(message));
  }

  global.TayunetDocumentAPI = Object.freeze({
    origin,
    apiBase: `${origin}/api`,
    fileBase: `${origin}/file`,
    request,
    requestUrl,
    loginNotice,
    showLoginNotice,
  });
})(window);
