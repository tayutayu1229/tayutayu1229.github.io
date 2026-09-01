const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');
const files = {
  tobu: read('JREgyoumu/tobusys/tobu.html'),
  metro: read('JREgyoumu/METROsys/metro.html'),
  dispatch: read('JREgyoumu/tsutatuIP/top.html'),
  account: read('testaccount.html'),
  home: read('NewHome.html'),
  tools: read('All-Useful.htm'),
  monitor: read('system_monitor.html'),
};

for (const [name, source] of Object.entries(files)) {
  const eventAttribute = /\bon[a-z]+\s*=\s*(["'])([\s\S]*?)\1/gi;
  for (const match of source.matchAll(eventAttribute)) {
    assert.ok(!match[2].includes('${'), `${name}: イベント属性へ動的値を埋め込まないこと`);
  }
}

assert.match(files.tobu, /const esc=value=>/);
assert.match(files.tobu, /\$\{esc\(loc\(s\['odpt:stationTitle'\]\)\)\}/);
assert.match(files.tobu, /\$\{esc\(no\)\}/);

assert.match(files.metro, /const esc=value=>/);
assert.match(files.metro, /\$\{esc\(loc\(s\['odpt:stationTitle'\]\)\)\}/);
assert.match(files.metro, /\$\{esc\(e\.message\)\}/);

assert.doesNotMatch(files.dispatch, /onclick="saveAndGo/);
assert.match(files.dispatch, /data-train-id="\$\{escapeHtml\(t\.id\)\}"/);
assert.match(files.dispatch, /train-list'\)\.addEventListener\('click'/);

assert.match(files.account, /data-admin-action="delete-budget"/);
assert.match(files.account, /data-admin-action="delete-user"/);
assert.match(files.home, /data-history-id=/);
assert.match(files.tools, /data-open-tool=/);
assert.match(files.monitor, /data-monitor-action="check"/);

console.log('xss output contexts: ok');
