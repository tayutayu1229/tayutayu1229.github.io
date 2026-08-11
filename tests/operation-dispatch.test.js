const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('operation-dispatch.html', 'utf8');
const client = fs.readFileSync('assets/js/operation-dispatch.js', 'utf8');
const css = fs.readFileSync('assets/css/operation-dispatch.css', 'utf8');
const server = fs.readFileSync('server/photo-archive/operation_dispatch.py', 'utf8');
const top = fs.readFileSync('toppage.html', 'utf8');
const docker = fs.readFileSync('server/photo-archive/Dockerfile', 'utf8');

assert.match(top, /旅客電報システム/);
assert.match(html, /auth_guard\.js/);
assert.match(html, /firebase-data-auth\.js/);
assert.match(html, /PTS-01/);
assert.match(html, /旅客電報システム/);
assert.match(html, /新規打電/);
assert.match(html, /data-open-compose/);
assert.match(html, /対応中/);
assert.match(html, /引継ぎ/);
assert.match(html, /お気に入り/);
assert.match(html, /完了/);
assert.match(html, /使い方・機能概要/);
assert.match(html, /ダーク/);
assert.doesNotMatch(html, /業務上の考え方|実際の鉄道事業者の指令・保安システムではありません/);
assert.match(html, /Ubuntu HDD/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /id="compose-dialog"/);
assert.match(html, /id="detail-dialog"/);
assert.match(html, /id="settings-dialog"/);
assert.match(html, /id="filter-mobile-button"/);
assert.match(html, /id="past-dispatch-select"/);
assert.match(html, /id="apply-past-dispatch"/);
for (const layout of ['table', 'cards', 'grid']) assert.match(html, new RegExp(`data-layout="${layout}"`));
assert.doesNotMatch(html, /A報|B報|C報|重要度/);
assert.match(html, /車種・両数変更/);
assert.match(html, /name="dispatchedAt"/);
assert.match(html, /id="optional-trains"/);
assert.match(html, /id="unacknowledged-alert"/);
assert.match(html, /運転関係（TKG-501号から）/);
assert.match(html, /旅客・保安関係（TKG-701号から）/);
assert.match(html, /周知関係（TKG-901号から）/);
assert.doesNotMatch(html, /PASSENGER TELEGRAM|PASSENGER TELEGRAM REGISTER|class="system-symbol"/);

for (const label of ['運転休止・運休', '急病人救護・遅延', '踏切支障', '旅客案内・放送指示', '車種・両数変更', '便宜乗車特認']) {
  assert.match(html, new RegExp(label));
}
for (const action of ['運転休止', '運休', '遅延', '折返し変更', '行先変更', '編成変更', '便宜乗車', '指定輸送']) {
  assert.match(client, new RegExp(action));
}
assert.match(client, /unacknowledged/);
assert.match(client, /tayunet-operation-draft/);
assert.match(client, /meaningful=/);
assert.match(client, /\["trainNumber","sectionFrom","sectionTo","delayMinutes","planned","changed","notes"\]/);
assert.match(client, /AbortController/);
assert.match(client, /friendlyError/);
assert.match(client, /Ubuntuの電報データベースへ保存しています/);
assert.match(client, /localDate/);
assert.match(client, /localDateTime/);
assert.match(client, /\$\("#train-rows"\)\.innerHTML=""/);
assert.match(client, /unack-alert-count/);
assert.match(client, /確認済みにする/);
assert.match(client, /続報・訂正・引継ぎを追記/);
assert.match(client, /原文は変更せず/);
assert.match(client, /passenger-telegrams\.csv/);
assert.match(client, /受付日時/);
assert.match(client, /打電日時/);
assert.match(client, /telegramReference/);
assert.match(client, /処理状態を変更/);
assert.match(client, /paper-viewport/);
assert.match(client, /detail-operations/);
assert.match(client, /function setView\(view\)/);
assert.match(client, /case"monitoring":map\.set\("status","monitoring"\)/);
assert.match(client, /case"unacknowledged":map\.set\("unacknowledged","true"\)/);
assert.doesNotMatch(client, /statusOverride|state\.unacknowledged/);

assert.match(server, /PRAGMA journal_mode=WAL/);
assert.match(server, /dispatch_acknowledgements/);
assert.match(server, /dispatch_audit/);
assert.match(server, /BEGIN IMMEDIATE/);
assert.match(server, /unacknowledged/);
assert.match(server, /TKG-\{number\}号/);
assert.match(server, /CATEGORY_NUMBER_BASES/);
assert.match(server, /sequence_key = f"\{received_day\}:\{base\}"/);
assert.doesNotMatch(server, /@app\.(patch|put)\(f?"\{prefix\}\/\{\{dispatch_id\}\}"/);
assert.match(docker, /operation_dispatch\.py/);
assert.match(docker, /test_operation_dispatch\.py/);

assert.match(css, /@media\(max-width:900px\)/);
assert.match(css, /@media\(max-width:640px\)/);
assert.match(css, /100dvh/);
assert.match(css, /overflow-y:auto/);
assert.match(css, /@media print/);
assert.match(css, /\.loading\[hidden\]/);
assert.match(css, /size:A4 portrait/);
assert.match(css, /#detail-content\{height:100%;min-height:0\}/);
assert.match(css, /\.paper-viewport\{[^}]*overflow:auto/);
assert.match(css, /\.detail-operations\{[^}]*overflow:auto/);
assert.match(css, /width:210mm!important;height:297mm!important/);
assert.match(css, /"MS PGothic"/);
assert.match(css, /\.unacknowledged-alert/);
assert.match(css, /\.sound-setting input\[type="checkbox"\]/);
assert.match(css, /\.status-actions/);
assert.doesNotMatch(css, /linear-gradient/);

console.log('operation dispatch audit: ok');
