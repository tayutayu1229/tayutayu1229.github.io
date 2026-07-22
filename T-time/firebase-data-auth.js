(function (global) {
  "use strict";

  class FirebaseDataAuthError extends Error {
    constructor(message, code) {
      super(message);
      this.name = "FirebaseDataAuthError";
      this.code = code;
    }
  }

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function firebaseAuth(timeoutMilliseconds = 10000) {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      if (global.firebase?.apps?.length && typeof global.firebase.auth === "function") {
        return global.firebase.auth();
      }
      await delay(50);
    }
    throw new FirebaseDataAuthError("Firebase認証を初期化できませんでした。", "firebase_unavailable");
  }

  async function currentUser() {
    const auth = await firebaseAuth();
    if (auth.currentUser) return auth.currentUser;
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new FirebaseDataAuthError("Firebaseへのログインが必要です。", "firebase_login_required"));
      }, 10000);
      unsubscribe = auth.onAuthStateChanged((user) => {
        clearTimeout(timer);
        unsubscribe();
        if (user) resolve(user);
        else reject(new FirebaseDataAuthError("Firebaseへのログインが必要です。", "firebase_login_required"));
      }, (error) => {
        clearTimeout(timer);
        unsubscribe();
        reject(new FirebaseDataAuthError(error.message || "Firebase認証を確認できませんでした。", "firebase_unavailable"));
      });
    });
  }

  async function getIdToken() {
    const user = await currentUser();
    return user.getIdToken(false);
  }

  async function authorizedOptions(options) {
    const settings = Object.assign({}, options || {});
    const headers = new Headers(settings.headers || {});
    headers.set("Authorization", `Bearer ${await getIdToken()}`);
    settings.headers = headers;
    return settings;
  }

  global.TayunetFirebaseDataAuth = Object.freeze({
    FirebaseDataAuthError,
    currentUser,
    getIdToken,
    authorizedOptions,
  });
})(window);
