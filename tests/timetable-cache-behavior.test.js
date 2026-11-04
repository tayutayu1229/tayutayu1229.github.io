const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const records = new Map();
const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const currentUser = {uid: 'alice'};
const window = {TayunetAuth: {auth: {currentUser}}, TayunetAuthReady: Promise.resolve({ok: true, user: currentUser})};
window.indexedDB = {open() {
  const request = {};
  setImmediate(() => {
    request.result = {close() {}, transaction() {
      const tx = {};
      const store = {
        openCursor() {
          const cursorRequest = {};
          const entries = [...records];
          let index = 0;
          function advance() {
            setImmediate(() => {
              const entry = entries[index++];
              cursorRequest.result = entry ? {key: entry[0], value: entry[1], delete() {records.delete(entry[0]);}, continue: advance} : null;
              cursorRequest.onsuccess();
              if (!entry) setImmediate(() => tx.oncomplete());
            });
          }
          advance();
          return cursorRequest;
        },
        put(value, key) {records.set(key, structuredClone(value));},
      };
      tx.objectStore = () => store;
      return tx;
    }};
    request.onsuccess();
  });
  return request;
}};
vm.runInNewContext(fs.readFileSync('assets/js/timetable-selection-cache.js', 'utf8'), {window, console, Date});
const cache = window.TayunetTimetableSelectionCache;
(async () => {
  records.set('anonymous-tab', {items: [{trainNumber: 'old'}], savedAt: now});
  records.set('user:expired', {uid: 'expired', items: [], savedAt: now - 8 * day});
  records.set('user:future', {uid: 'future', items: [], savedAt: now + day});
  records.set('user:bob', {uid: 'bob', items: [{trainNumber: 'bob-only'}], savedAt: now});
  records.set('user:alice', {uid: 'alice', items: [{trainNumber: '101M'}], savedAt: now - day});
  assert.equal((await cache.read())[0].trainNumber, '101M', '翌日も同じ利用者のデータが使える');
  assert.equal(cache.needsRefresh(), true, '古い保存分は先に表示してから更新する');
  assert.equal(records.has('anonymous-tab'), false);
  assert.equal(records.has('user:expired'), false);
  assert.equal(records.has('user:future'), false);
  await cache.write([{trainNumber: '102M'}]);
  await cache.write([{trainNumber: '103M'}]);
  assert.equal(records.size, 2, '更新や別タブで利用者ごとの複製を増やさない');
  assert.equal((await cache.read())[0].trainNumber, '103M');
  assert.equal(cache.needsRefresh(), false);
  window.TayunetAuth.auth.currentUser = {uid: 'bob'};
  window.TayunetAuthReady = Promise.resolve({ok: true, user: {uid: 'bob'}});
  assert.equal((await cache.read())[0].trainNumber, 'bob-only', '別利用者の時刻表を返さない');
  window.TayunetAuthReady = Promise.resolve({ok: false});
  assert.equal(await cache.read(), null, '承認されていない状態では保存分を返さない');
  window.TayunetAuth.auth.currentUser = null;
  assert.equal(await cache.read(), null);
  console.log('timetable cache behavior: ok');
})().catch(error => {console.error(error); process.exitCode = 1;});
