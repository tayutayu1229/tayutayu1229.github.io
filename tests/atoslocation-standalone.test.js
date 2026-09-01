const assert = require('node:assert/strict');
const fs = require('node:fs');

const standalone = fs.readFileSync('ATOSlocation.html', 'utf8');
const monitor = fs.readFileSync('atosweb.html', 'utf8');
const top = fs.readFileSync('toppage.html', 'utf8');

for (const feature of [
  'id="atosLineSelect"',
  'id="atosDirection"',
  'id="atos-monitor"',
  'function atosManualUpdate()',
  'function showAtosStationTT(',
  'async function openAtosTrainTimetable(',
  'id="modal-station-tt"',
  'id="modal-train-tt"',
]) {
  assert.ok(monitor.includes(feature), `shared ATOS monitor is missing: ${feature}`);
}

assert.match(standalone, /<iframe id="atos-standalone" title="ATOS在線モニタ">/,
  'ATOSlocation must provide a full-screen standalone monitor');
assert.match(standalone, /params\.set\('standalone', '1'\)/,
  'ATOSlocation must enable the shared standalone rendering mode');
assert.doesNotMatch(standalone, /location\.replace\(/,
  'ATOSlocation must not redirect to the integrated screen');
assert.match(monitor, /const requestedView=standaloneRealtime\?'realtime'/,
  'the standalone page must stay on its realtime monitor');
assert.match(monitor, /\.standalone-realtime #nav-tabs \{ display: none; \}/,
  'integrated navigation tabs must be hidden in the standalone monitor');
assert.match(monitor, /ATOSlocation\.html/,
  'the standalone monitor must create standalone share URLs');
for (const id of ['standalone-atos-line', 'standalone-atos-trains', 'standalone-atos-delays', 'standalone-atos-stations']) {
  assert.ok(monitor.includes(`id="${id}"`), `standalone summary is missing: ${id}`);
}
assert.match(monitor, /function updateStandaloneAtosSummary\(/,
  'the standalone summary must update with the selected line');
assert.match(monitor, /\.standalone-realtime \.train \{[\s\S]*border-radius: 0;/,
  'standalone train cards must use a fully square frame');
assert.match(monitor, /\.train\.down \{ clip-path:polygon\(0 0,calc\(100% - 24px\)/,
  'train cards must cut the upper leading corner to show direction');
assert.doesNotMatch(monitor, /train-line-chip/,
  'train cards must not show a railway-name chip');
assert.match(monitor, /上野東京ライン（品川〜上野 共用線路）/,
  'the four-line shared corridor must be selectable');
for (const line of ['JobanRapid', 'Tokaido', 'Takasaki', 'Utsunomiya']) {
  assert.ok(monitor.includes(`JR-East.${line}`), `shared corridor is missing: ${line}`);
}
assert.match(monitor, /Maebashi:'前橋'/,
  'external JR station names must be localized');
assert.match(monitor, /function supplementTimetableWithRouteStations\(/,
  'prediction timetables must supplement omitted pass-through stations');
assert.match(top, /data-name="ATOS在線モニタ"[^>]+ATOSlocation\.html/,
  'the top-page tile must open the standalone monitor');

console.log('ATOS standalone monitor tests: ok');
