(function (global) {
  'use strict';

  const DATABASE = 'tayunetTimetableSelectionCache';
  const STORE = 'bundles';
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const REFRESH_AGE = 10 * 60 * 1000;
  let savedAt = 0;

  async function userId() {
    const ready = await global.TayunetAuthReady;
    const uid = global.TayunetAuth?.auth?.currentUser?.uid;
    return ready?.ok && ready.user?.uid === uid ? uid : null;
  }

  function open() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) { resolve(null); return; }
      const request = global.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('列車一覧の保存領域が使用中です'));
    });
  }

  function valid(record, now) {
    return Boolean(record && typeof record.uid === 'string' && Array.isArray(record.items)
      && Number.isFinite(record.savedAt) && record.savedAt <= now && now - record.savedAt <= MAX_AGE);
  }

  // Keep one bundle per user. Remove expired bundles and the old anonymous,
  // per-tab records so closed tabs cannot accumulate copies indefinitely.
  async function transaction(database, uid, items) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const now = Date.now();
      let result = null;
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (!valid(entry.value, now) || entry.key !== `user:${entry.value.uid}`) entry.delete();
        else if (!items && entry.value.uid === uid) result = entry.value;
        entry.continue();
      };
      if (items) {
        result = {uid, savedAt: now, items};
        store.put(result, `user:${uid}`);
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('列車一覧の保存に失敗しました'));
    });
  }

  async function access(items) {
    let database;
    try {
      const uid = await userId();
      if (!uid) return null;
      database = await open();
      if (!database) return null;
      const record = await transaction(database, uid, items);
      if (uid !== await userId()) return null;
      savedAt = record?.savedAt || 0;
      return record?.items || null;
    } catch (error) {
      console.warn('列車一覧の保存データを利用できませんでした。', error);
      return null;
    } finally {
      database?.close();
    }
  }

  global.TayunetTimetableSelectionCache = Object.freeze({
    read: () => access(),
    write: items => access(items),
    needsRefresh: () => Date.now() - savedAt > REFRESH_AGE,
    savedLabel: () => savedAt ? new Date(savedAt).toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}) : '',
  });
})(window);
