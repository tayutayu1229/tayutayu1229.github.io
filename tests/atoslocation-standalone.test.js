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
assert.match(monitor, /\.standalone-realtime \.train \{[\s\S]*border-radius: 15px;/,
  'standalone train cards must use the dedicated rounded design');
assert.match(monitor, /\.standalone-realtime \.train\.down::after \{ content: '›';/,
  'standalone train cards must retain a clear direction marker');
assert.match(top, /data-name="ATOS在線モニタ"[^>]+ATOSlocation\.html/,
  'the top-page tile must open the standalone monitor');

console.log('ATOS standalone monitor tests: ok');
