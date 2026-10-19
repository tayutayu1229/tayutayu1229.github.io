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
assert.match(admin, /daily\/commit/);
assert.match(admin, /daily\/apply-publish/);
const sample = {trainNumber:'回8002', category:'planned_extra', trainType:'試験貨物', lines:['試験線'],
  operationState:'suspend', scheduleSnapshot:{origin:'甲駅', destination:'乙駅', stops:[{station:'途中駅', departure:'09:00'}]}, remarks:'手配確認'};
assert.equal(U.matches(sample, {query:'途中 駅', category:'planned_extra', line:'試験線', state:'suspend'}), true);
for (const filters of [{query:'不存在'}, {category:'extra'}, {line:'別線'}, {state:'operate'}]) assert.equal(U.matches(sample, filters), false);
assert.equal(U.matches(sample, {query:'手配確認'}), true);
assert.equal(U.matches(sample, {query:'試験貨物'}), true);
assert.equal(U.categoryFor('回 8002M'), 'planned_extra');
assert.equal(U.categoryFor('9001'), 'extra');
assert.equal(U.categoryFor('5091'), 'regular');
assert.ok(U.compare({trainNumber:'10'}, {trainNumber:'2'}, 'number') > 0);
assert.ok(U.compare(sample, {trainNumber:'1', stops:[{departure:'10:00'}]}, 'time') < 0);
assert.ok(U.compare({trainNumber:'1'}, sample, 'time') > 0);
assert.ok(U.compare({trainNumber:'1', lines:['A']}, {trainNumber:'2', lines:['B']}, 'line') < 0);
const adminHtml = fs.readFileSync('operation-service/daily-admin.html', 'utf8');
for (const id of ['newRow','duplicateRow','clearRow','editKind','editTitle','editNumber','editType','catalogCategory','catalogLine','catalogSort','dailyQuery','dailyState','dailyLine','dailySort','updatedAt']) assert.ok(adminHtml.includes(`id="${id}"`), id);
assert.match(admin, /duplicate|複製元の保存済み内容/);
assert.match(admin, /同じ列車番号は既に一覧にあります/);
assert.match(admin, /if \(U.matches\(item, filters\('daily'\)\)\) selected.add\(index\)/);
assert.match(fs.readFileSync('operation-service/index.html', 'utf8'), />全件数</);
assert.match(fs.readFileSync('operation-service/public.js', 'utf8'), /最終更新/);
const timeHtml = U.timeRowsMarkup([
  {station:'甲<&駅', arrival:'', departure:'10:00:00', trackN:'1'},
  {station:'乙駅', arrival:'11:00:00', departure:'=', trackN:'2'},
], [{station:'甲<&駅', departure:'10:05:00', note:'<script>変更</script>'}, {station:'乙駅', arrival:''}]);
assert.equal((timeHtml.match(/<tr /g) || []).length, 2);
assert.equal((timeHtml.match(/<input /g) || []).length, 8);
assert.equal((timeHtml.match(/class="time-modified"/g) || []).length, 3);
assert.match(timeHtml, /aria-label="甲&lt;&amp;駅 発"/);
assert.match(timeHtml, /value="10:05:00" data-original="10:00:00"/);
assert.match(timeHtml, /value="" data-original="11:00:00" class="time-modified"/);
assert.doesNotMatch(timeHtml, /<script>/);
assert.match(U.timeRowsMarkup([]), /列車時刻表はありません/);
assert.match(adminHtml, /id="saveRow"/);
assert.doesNotMatch(adminHtml, /<details><summary>詳細時刻表/);
assert.match(adminHtml, /class="data-grid time-edit-table daily-time-table"/);
assert.match(css, /daily-time-table th \{ position:sticky; top:0/);
assert.doesNotMatch(css, /max-height:35vh/);
assert.match(css, /\.daily-admin-body \.daily-grid \{ min-width:760px; \}/);
assert.match(adminHtml, /width:46px.*width:68px.*width:56px.*width:66px.*width:66px.*width:58px.*width:110px/);
assert.match(admin, /if \(editorDirty\) commitEditor\(\)/);
assert.match(admin, /\$\('saveRow'\)\.addEventListener\('click', \(\) => run\(saveDay\)\)/);
assert.doesNotMatch(adminHtml, /id="publishDay"/);
for (const id of ['numberOperate','numberSuspend','bulkOperate','bulkSuspend','editTimeChanged','editProhibited','sectionRows','applyMode']) assert.ok(adminHtml.includes(`id="${id}"`), id);
assert.deepEqual(U.parseNumbers('８００１,8002\n8001、回8003M'), ['8001','8002','回8003M']);
const layered = {trainNumber:'8001', operationState:'changed', timeChanges:[{station:'乙', departure:'11:05'}],
  scheduleSnapshot:{stops:['甲','乙','丙','丁'].map(station => ({station}))},
  sectionOverrides:[{start:'乙', end:'丁', state:'suspend'}, {start:'丙', end:'丁', state:'operate'}]};
const suspended = U.withBase(layered, 'suspend');
assert.equal(suspended.timeChanged, true);
assert.equal(suspended.operationState, 'suspend');
assert.equal(suspended.timeChanges, layered.timeChanges);
assert.equal(suspended.sectionOverrides, layered.sectionOverrides);
assert.deepEqual(U.resolvedSections(layered), [{start:'甲', end:'乙', state:'operate'}, {start:'乙', end:'丙', state:'suspend'}, {start:'丙', end:'丁', state:'operate'}]);
assert.equal(U.activityMatches(layered, 'operate'), true);
assert.equal(U.activityMatches(layered, 'suspend'), true);
assert.equal(U.activityMatches(suspended, 'changed'), true);
assert.equal(U.statusText(suspended), '運休');
assert.match(U.arrangementNotes(suspended), /時刻変更あり/);
assert.doesNotMatch(U.statusText(layered), /区間指定|時刻変更/);
assert.equal(U.sectionNotes(layered), '乙～丁 運休\n丙～丁 運転');
assert.doesNotMatch(U.rowsMarkup([suspended]), /state-suspend/); // Mixed sections must not get a full cancellation line.
assert.equal(U.layers({operationState:'changed', timeChanged:false}).timeChanged, false);
assert.equal(U.resolvedSections({...layered, sectionOverrides:[{start:'原簿外', end:'丁', state:'suspend'}]}), null);
assert.doesNotMatch(U.sectionNotes(layered), /適用結果|後の指定を優先/);
assert.doesNotMatch(U.rowsMarkup([{...layered, sectionOverrides:[{start:'<script>', end:'丁', state:'suspend'}]}]), /<script>/);
const unchecked = {...layered, operationState:'changed', baseActivity:'operate', timeChanged:false, sectionOverrides:[]};
assert.equal(U.layers(unchecked).timeChanged, false);
assert.equal(U.activityMatches(unchecked, 'changed'), false);
assert.equal(U.withBase(unchecked, 'operate').operationState, 'operate');
assert.match(U.rowsMarkup([unchecked]), /class="state-operate"/);
assert.doesNotMatch(U.rowsMarkup([{...unchecked, timetableWarning:'施行日の指定原簿に該当なし。保存時刻表を参照'}]), /施行日の指定原簿/);
assert.doesNotMatch(admin, /if \(item\.timeChanges\.length\) item\.timeChanged = true/);
assert.doesNotMatch(U.rowsMarkup([{trainNumber:'1', timeChanges:[{station:'甲', departure:''}], scheduleSnapshot:{stops:[{station:'甲', departure:'10:00'}]}}]), /（空欄）/);
const oldAdminCode = fs.readFileSync('operation-service/admin.js', 'utf8');
assert.doesNotMatch(oldAdminCode, /checked \|\| row\.timeChanges\.length/);
for (const id of ['numberTools','catalogTools','dateApplyTools']) {
  const tag = adminHtml.match(new RegExp('<details[^>]*id="'+id+'"[^>]*>'))?.[0];
  assert.ok(tag, id); assert.doesNotMatch(tag, /\bopen\b/);
}
assert.equal(U.cleanRemarks('手入力\n管理画面の一括運休で登録\n残す記事'), '手入力\n残す記事');
assert.equal(U.cleanRemarks('ダイヤ原簿設定あり（活休未判定）'), '');
assert.equal(U.cleanRemarks('管理画面の一括運転で登録'), '');
assert.equal(U.cleanRemarks('  手入力\n\n記事  '), '  手入力\n\n記事  ');
assert.doesNotMatch(U.rowsMarkup([{trainNumber:'1', remarks:'ダイヤ原簿設定あり（活休未判定）'}]), /ダイヤ原簿設定あり/);
assert.ok(U.compare({trainNumber:'1', category:'planned_extra'}, {trainNumber:'2', category:'regular'}, 'category') < 0);
assert.ok(U.compare({operationState:'operate'}, {operationState:'suspend'}, 'activity') < 0);
assert.ok(U.compare({scheduleSnapshot:{stops:[{station:'甲',departure:'09:00'}]}, timeChanges:[{station:'甲', departure:'11:00'}]}, {stops:[{station:'甲', departure:'10:00'}]}, 'time') > 0);

// Run the real preview entry: fetching/rendering must not start printing.
(async () => {
  const nodes = new Map();
  for (const id of ['main-content','printDaily','closeDaily','previewStatus','dailyPdfSort','dailyPreviewRows']) nodes.set(id, {
    disabled:true, textContent:'', html:'', events:{},
    addEventListener(type, fn) { this.events[type] = fn; },
    replaceChildren(value) { this.html = value; },
  });
  let printCount = 0;
  const sourceItems = [{trainNumber:'8001', category:'planned_extra', operationState:'operate'}, {trainNumber:'7001', category:'planned_extra', operationState:'suspend'}];
  const context = {
    window:{OperationDailyUtils:U, OperationServiceAdminUtils:require('../operation-service/admin-utils.js'), print() { printCount++; }, close() {}},
    location:{search:'?serviceDate=2026-10-20', hostname:'localhost'}, URLSearchParams,
    document:{getElementById:id => nodes.get(id), createRange:() => ({selectNodeContents() {}, createContextualFragment:html => html})},
    fetch:async () => ({ok:true, json:async () => ({serviceDate:'2026-10-20', status:'published', edition:1,
      noticeNumber:'運転活休通達第2026-001号', items:sourceItems})}),
  };
  await vm.runInNewContext(preview, context);
  assert.equal(printCount, 0);
  assert.equal(nodes.get('printDaily').disabled, false);
  assert.match(nodes.get('main-content').html, /運転活休通達第2026-001号/);
  assert.ok(nodes.get('main-content').html.indexOf('7001') < nodes.get('main-content').html.indexOf('8001'));
  nodes.get('dailyPdfSort').value = 'activity'; nodes.get('dailyPdfSort').events.change();
  assert.ok(nodes.get('dailyPreviewRows').html.indexOf('8001') < nodes.get('dailyPreviewRows').html.indexOf('7001'));
  assert.equal(sourceItems[0].trainNumber, '8001');
  assert.equal(printCount, 0);
  nodes.get('printDaily').events.click();
  assert.equal(printCount, 1);
  console.log('operation daily tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
