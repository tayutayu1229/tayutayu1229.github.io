const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('operation-dispatch.html', 'utf8');
const client = fs.readFileSync('assets/js/operation-dispatch.js', 'utf8');
const css = fs.readFileSync('assets/css/operation-dispatch.css', 'utf8');
const server = fs.readFileSync('server/photo-archive/operation_dispatch.py', 'utf8');
const top = fs.readFileSync('toppage.html', 'utf8');
const docker = fs.readFileSync('server/photo-archive/Dockerfile', 'utf8');

assert.match(top, /運転情報打電・状況報告/);
assert.match(html, /auth_guard\.js/);
assert.match(html, /firebase-data-auth\.js/);
assert.match(html, /ODS-01/);
assert.match(html, /情報打電/);
assert.match(html, /id="compose-button" data-open-compose/);
assert.match(html, /対応中/);
assert.match(html, /引継ぎ/);
assert.match(html, /お気に入り/);
assert.match(html, /完了/);
assert.match(html, /使い方・機能概要/);
assert.match(html, /ダーク/);
assert.match(html, /実際の鉄道事業者の指令・保安システムではありません/);
assert.match(html, /Ubuntu HDD/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /id="compose-dialog"/);
assert.match(html, /id="detail-dialog"/);
assert.match(html, /id="settings-dialog"/);
assert.match(html, /id="filter-mobile-button"/);

for (const label of ['運転休止・運休', '急病人救護・遅延', '踏切支障', '旅客案内・放送指示', '編成両数変更', '便宜乗車特認']) {
  assert.match(html, new RegExp(label));
}
for (const action of ['運転休止', '運休', '遅延', '折返し変更', '行先変更', '編成変更', '便宜乗車', '指定輸送']) {
  assert.match(client, new RegExp(action));
}
assert.match(client, /unacknowledged/);
assert.match(client, /tayunet-operation-draft/);
assert.match(client, /AbortController/);
assert.match(client, /friendlyError/);
assert.match(client, /Ubuntuの運転情報データベースへ保存しています/);
assert.match(client, /localDate/);
assert.match(client, /確認済みにする/);
assert.match(client, /続報・訂正・引継ぎを追記/);
assert.match(client, /原文は変更せず/);
assert.match(client, /operation-dispatch\.csv/);

assert.match(server, /PRAGMA journal_mode=WAL/);
assert.match(server, /dispatch_acknowledgements/);
assert.match(server, /dispatch_audit/);
assert.match(server, /BEGIN IMMEDIATE/);
assert.match(server, /unacknowledged/);
assert.doesNotMatch(server, /@app\.(patch|put)\(f?"\{prefix\}\/\{\{dispatch_id\}\}"/);
assert.match(docker, /operation_dispatch\.py/);
assert.match(docker, /test_operation_dispatch\.py/);

assert.match(css, /@media\(max-width:820px\)/);
assert.match(css, /@media\(max-width:560px\)/);
assert.match(css, /100dvh/);
assert.match(css, /overflow-y:auto/);
assert.match(css, /@media print/);

console.log('operation dispatch audit: ok');
