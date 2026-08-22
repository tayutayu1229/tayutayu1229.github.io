(() => {
  "use strict";

  const DATABASE_NAME = "incident-share-terminal-data";
  const STORE_NAME = "pending-uploads";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("端末保存データを開けません"));
    });
  }

  async function transaction(mode, run) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try { result = run(store); } catch (error) { database.close(); reject(error); return; }
      tx.oncomplete = () => { database.close(); resolve(result?.result); };
      tx.onerror = () => { database.close(); reject(tx.error || new Error("端末保存に失敗しました")); };
      tx.onabort = () => { database.close(); reject(tx.error || new Error("端末保存が中断されました")); };
    });
  }

  const api = {
    put(record) { return transaction("readwrite", (store) => store.put(record)); },
    remove(id) { return transaction("readwrite", (store) => store.delete(id)); },
    count() { return transaction("readonly", (store) => store.count()); },
    async list() {
      const database = await openDatabase();
      return new Promise((resolve, reject) => {
        const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
        request.onsuccess = () => { database.close(); resolve((request.result || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))); };
        request.onerror = () => { database.close(); reject(request.error || new Error("端末保存データを読み込めません")); };
      });
    },
  };

  window.IncidentOfflineStore = Object.freeze(api);
})();
