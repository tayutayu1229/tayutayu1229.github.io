'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const U = require('../operation-service/daily-utils.js');
const css = fs.readFileSync('operation-service/daily.css', 'utf8');
const preview = fs.readFileSync('operation-service/daily-notice.js', 'utf8');
const admin = fs.readFileSync('operation-service/daily-admin.js', 'utf8');
const html = U.rowsMarkup(Object.keys(U.states).map((state, i) => ({
  trainNumber: `架空${8000 + i}`, operationState: state, category: 'planned_extra',
  sectionStart: '途中駅', sectionEnd: '終点', remarks: '<script>危険</script>',
  scheduleSnapshot: {origin:'始発', destination:'終着'},
  timeChanges: [{station:'途中駅', departure:'10:05', note:'変更記事'}],
})));
assert.equal((html.match(/<tr /g) || []).length, 5);
assert.equal((html.match(/<td[ >]/g) || []).length, 50);
assert.match(html, /始発<\/td><td>終着/);
assert.match(html, /途中駅～終点/);
assert.match(html, /変更記事/);
assert.doesNotMatch(html, /<script>/);
assert.match(html, /&lt;script&gt;/);
assert.match(html, /class="state-unknown"/);
assert.match(U.rowsMarkup([{trainNumber:'<img>', operationState:'bad" injected'}]), /class="state-unknown"/);
assert.equal(U.key({trainNumber:'回 8001M'}), U.key({trainNumber:'回8001m'}));
assert.match(css, /state-prohibited \{ --cancel-line:3px double #c00000/);
assert.match(css, /nth-child\(n\+3\):nth-child\(-n\+7\)::after/);
assert.match(css, /td:nth-child\(-n\+2\), \.daily-grid td:nth-child\(n\+9\) \{ color:#000/);
assert.match(css, /thead \{ display:table-header-group/);
assert.match(css, /size:A4 landscape/);
assert.doesNotMatch(preview, /setTimeout|print=1/);
assert.match(preview, /if \(ready\) window\.print\(\)/);
assert.match(preview, /下書きプレビュー・未発表/);
assert.match(admin, /先に行の編集を一覧へ反映し/);
assert.match(admin, /選択行を指定日|発表は行いません/);

// Run the real preview entry: fetching/rendering must not start printing.
(async () => {
  const nodes = new Map();
  for (const id of ['main-content','printDaily','closeDaily','previewStatus']) nodes.set(id, {
    disabled:true, textContent:'', html:'', events:{},
    addEventListener(type, fn) { this.events[type] = fn; },
    replaceChildren(value) { this.html = value; },
  });
  let printCount = 0;
  const context = {
    window:{OperationDailyUtils:U, OperationServiceAdminUtils:require('../operation-service/admin-utils.js'), print() { printCount++; }, close() {}},
    location:{search:'?serviceDate=2026-10-20', hostname:'localhost'}, URLSearchParams,
    document:{getElementById:id => nodes.get(id), createRange:() => ({selectNodeContents() {}, createContextualFragment:html => html})},
    fetch:async () => ({ok:true, json:async () => ({serviceDate:'2026-10-20', status:'published', edition:1,
      noticeNumber:'運転活休通達第2026-001号', items:[{trainNumber:'8001', category:'planned_extra', operationState:'suspend'}]})}),
  };
  await vm.runInNewContext(preview, context);
  assert.equal(printCount, 0);
  assert.equal(nodes.get('printDaily').disabled, false);
  assert.match(nodes.get('main-content').html, /運転活休通達第2026-001号/);
  nodes.get('printDaily').events.click();
  assert.equal(printCount, 1);
  console.log('operation daily tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
