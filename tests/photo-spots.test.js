const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('photo-spots.html', 'utf8');
const css = fs.readFileSync('assets/css/photo-spots.css', 'utf8');
const client = fs.readFileSync('assets/js/photo-spots.js', 'utf8');
const topPage = fs.readFileSync('toppage.html', 'utf8');
const apiControl = fs.readFileSync('server/photo-archive/tayunet-photo-archive', 'utf8');
const apiInstaller = fs.readFileSync('server/photo-archive/install-photo-archive.sh', 'utf8');

for (const text of [
  '撮影地検索', 'id="plan-date"', 'id="plan-time"', 'id="sun-summary"',
  'id="spot-map"', 'id="direction-filter"', 'id="subject-filter"',
  'id="editor-map"', 'id="editor-train-fields"', 'id="editor-non-train-fields"',
  'id="spot-form"', 'PSP-01', 'OpenStreetMap'
]) assert.match(html, new RegExp(text));

for (const kind of ['all', 'train', 'nonTrain', 'favorite']) assert.match(html, new RegExp(`data-kind="${kind}"`));
assert.equal((html.match(/data-kind=/g) || []).length, 4);
assert.match(html, /name="kind"[^>]*>[\s\S]*value="train"[\s\S]*value="nonTrain"/);
assert.match(html, /name="subject" list="subject-examples"/);
assert.match(html, /photo-spots\.css\?v=2026\.10\.13\.3/);
assert.match(html, /photo-spots\.js\?v=2026\.10\.13\.3/);
assert.match(html, /firebase-data-auth\.js/);
assert.match(html, /class="header-menu"[\s\S]*id="user-info"[\s\S]*撮影記録[\s\S]*id="firebase-logout-button"/);
assert.doesNotMatch(html + client, /列車以外/);
assert.match(html, /data-kind="nonTrain"><span>その他<\/span>/);
assert.match(html, /value="nonTrain">その他<\/option>/);
assert.match(client, /nonTrain: "その他"/);
assert.match(client, /headerMenu\.open && !headerMenu\.contains\(event\.target\)/);
assert.match(client, /event\.key !== "Escape" \|\| !headerMenu\.open/);
for (const id of ['trash-button', 'history-dialog', 'trash-dialog', 'conflict-dialog']) assert.match(html, new RegExp(`id="${id}"`));

for (const text of [
  '条件を判定', '検索機能 正常', 'system-clock',
  'data-kind="flower"', 'data-kind="autumn"', 'data-kind="scenery"',
  '指定日時と現地確認済み条件で検索中', 'おすすめ順', '駐車場あり'
]) assert.doesNotMatch(html + client, new RegExp(text));

assert.doesNotMatch(html, /id="season-filter"[^>]*checked|id="safe-filter"[^>]*checked/);
assert.match(html, /id="empty-state"[\s\S]*id="spot-cards"/);
assert.doesNotMatch(client, /map-list-layout[^\n]*hidden/);
assert.match(client, /\["#plan-date", "#plan-time"\][\s\S]*addEventListener\("change", filterResults\)/);
assert.match(client, /state\.kind === "train"[\s\S]*state\.kind === "nonTrain"/);
assert.match(client, /state\.editorMap\.invalidateSize\(\)/);
assert.match(client, /state\.editorMap\.on\("click"/);
assert.match(client, /MIGRATION_BACKUP_KEY = "tayunet-photo-spots-v1-backup-before-v3"/);
assert.match(client, /API_MIGRATION_BACKUP_KEY = "tayunet-photo-spots-v1-backup-before-api"/);
assert.match(client, /API_MIGRATION_KEY = "tayunet-photo-spots-api-import-v1"/);
assert.match(client, /https:\/\/photo-api\.tayunet-traininfo\.com/);
assert.match(client, /\/v1\/spots\/import/);
assert.match(client, /\/v1\/spots/);
assert.match(client, /\/verify/);
assert.match(client, /\/history/);
assert.match(client, /\/restore/);
assert.match(client, /\/permanent/);
assert.match(client, /Authorization/);
assert.match(client, /IntersectionObserver/);
assert.match(client, /root: null, rootMargin: "80px"/);
assert.match(client, /apiBlob/);
assert.match(client, /URL\.revokeObjectURL/);
assert.match(client, /expectedRevision/);
assert.match(client, /error\.status === 409/);
assert.match(client, /lens: "推奨レンズ"/);
assert.match(client, /name: "名称"/);
assert.match(client, /create: "登録しました"/);
assert.match(client, /item\.action !== "create"/);
assert.match(client, /displayHistoryDateTime/);
assert.match(client, /deletedByName \|\| "不明"/);
assert.match(client, /if \(state\.me\?\.canManage\)/);
assert.match(client, /setView\(\[lat, lng\], 15\)/);
assert.doesNotMatch(client, /readAsDataURL/);
assert.match(client, /撮影地をサーバーに保存しました/);
assert.match(client, /if \(!localStorage\.getItem\(MIGRATION_BACKUP_KEY\)\) localStorage\.setItem\(MIGRATION_BACKUP_KEY, source\)/);
assert.match(client, /if \(raw\.schemaVersion === SCHEMA_VERSION\) return raw/);
assert.doesNotMatch(client, /function scoreSpot/);
assert.doesNotMatch(client, /\.innerHTML\s*=/);
assert.match(client, /replaceChildren/);
assert.match(client, /textContent/);
assert.match(client, /OpenStreetMap contributors/);
assert.match(client, /fitBounds\(bounds/);
assert.match(client, /ResizeObserver/);
assert.match(client, /TayunetAuthReady\.then\(finishAuthenticatedLayout\)/);
assert.match(client, /profile\.displayName, profile\.name, user\.displayName, user\.email/);
assert.match(client, /text: "★ お気に入り"/);
assert.doesNotMatch(client, /レンズ未登録|作例イメージ/);

assert.match(css, /\.category-tabs \{[^}]*height: 36px/);
assert.match(css, /--marker-train: #0A5C2E/);
assert.match(css, /--marker-non-train: #9C5A24/);
assert.match(css, /\.spot-marker[^}]*width: 13px !important[^}]*border: 1\.5px solid var\(--paper\)/);
assert.match(css, /\.spot-marker\.nonTrain[^}]*var\(--marker-non-train\)/);
assert.match(css, /#editor-map \{[^}]*height: 280px/);
assert.match(css, /@media \(max-width: 560px\)[\s\S]*#editor-map \{ height: 220px/);
assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.map-shell \{ height: 240px; min-height: 240px/);
assert.match(css, /\.leaflet-control-attribution[^}]*white-space: normal/);
assert.match(css, /#editor-map[^}]*touch-action: none[^}]*overscroll-behavior: contain/);
assert.match(css, /#editor-train-fields \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(css, /\.editor-grid input, \.editor-grid select \{ height: 36px; \}/);
assert.match(css, /\.memo-box[^}]*white-space: pre-wrap/);
assert.doesNotMatch(css, /gradient/i);
assert.doesNotMatch(css, /box-shadow/i);
assert.match(topPage, /class="tile c-gray psp-preparing"[^>]*disabled[^>]*aria-disabled="true"/);
assert.ok(apiControl.indexOf('docker build -t "$IMAGE"') < apiControl.indexOf('docker stop "$NAME"'), 'Docker build must finish before the old container is stopped');
assert.match(apiControl, /docker rename "\$PREVIOUS_NAME" "\$NAME"[\s\S]*docker start "\$NAME"/);
assert.doesNotMatch(apiInstaller, /systemctl restart tayunet-photo-archive/);
assert.match(apiInstaller, /systemctl is-active --quiet tayunet-photo-archive\.service[\s\S]*\/usr\/local\/sbin\/tayunet-photo-archive start/);

const context = {
  window: {},
  document: { addEventListener() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  setTimeout() {},
  clearTimeout() {},
  console,
  Date,
  Intl,
};
vm.createContext(context);
vm.runInContext(client, context);
const utils = context.window.PhotoSpotUtils;
assert.ok(utils);
assert.equal(utils.angularDistance(10, 350), 20);
assert.equal(utils.angularDistance(350, 10), 20);
assert.equal(utils.monthInRange(1, 12, 2), true);
assert.equal(utils.monthInRange(7, 12, 2), false);
const noon = utils.solarPosition(new Date('2026-06-21T12:00:00+09:00'), 35.6812, 139.7671);
assert.ok(noon.elevation > 70 && noon.elevation < 85, `unexpected elevation: ${noon.elevation}`);
assert.equal(utils.lightCondition({ bearing: 0 }, { azimuth: 180, elevation: 30 }).key, 'front');
assert.equal(utils.lightCondition({ bearing: 0 }, { azimuth: 0, elevation: 30 }).key, 'back');
assert.equal(utils.authenticatedName({ profile: { displayName: '登録表示名' }, user: { email: 'user@example.test' } }), '登録表示名');
assert.equal(utils.authenticatedName({ profile: {}, user: { displayName: 'Firebase表示名', email: 'user@example.test' } }), 'Firebase表示名');
assert.equal(utils.authenticatedName({ profile: {}, user: { email: 'user@example.test' } }), 'user@example.test');

const oldFlower = utils.normalizeSpot({ kind: 'flower', flower: '', safety: '花メモ', parking: true, rating: 5 });
assert.equal(oldFlower.kind, 'nonTrain');
assert.equal(oldFlower.subject, '花');
assert.equal(oldFlower.memo, '花メモ');
assert.equal(oldFlower.schemaVersion, 3);
assert.equal('flower' in oldFlower, false);
assert.equal('safety' in oldFlower, false);
assert.equal('parking' in oldFlower, false);
assert.equal('rating' in oldFlower, false);

assert.equal(utils.normalizeSpot({ kind: 'autumn', subject: '' }).subject, '紅葉');
assert.equal(utils.normalizeSpot({ kind: 'scenery', subject: '' }).subject, '風景');
assert.equal(utils.normalizeSpot({ kind: 'flower', subject: '桜' }).subject, '桜');
assert.equal(utils.normalizeSpot({ kind: 'train', line: '中央本線' }).kind, 'train');
for (const kind of ['flower', 'autumn', 'scenery']) assert.equal(utils.normalizeSpot({ kind, subject: '夜景' }).kind, 'nonTrain');

const current = { schemaVersion: 3, kind: 'nonTrain', subject: '桜', memo: '現行' };
assert.equal(utils.normalizeSpot(current), current);
const xss = utils.normalizeSpot({ kind: 'scenery', subject: '<img onerror=alert(1)>', safety: '<script>alert(1)</script>\n次の行' });
assert.equal(xss.subject, '<img onerror=alert(1)>');
assert.equal(xss.memo, '<script>alert(1)</script>\n次の行');

console.log('photo spot planner audit: ok');
