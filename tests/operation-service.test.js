'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('operation-service/styles.css', 'utf8');
const publicHtml = fs.readFileSync('operation-service/index.html', 'utf8');
const adminHtml = fs.readFileSync('operation-service/admin.html', 'utf8');
const publicJs = fs.readFileSync('operation-service/public.js', 'utf8');
const adminJs = fs.readFileSync('operation-service/admin.js', 'utf8');
const noticeHtml = fs.readFileSync('operation-service/notice.html', 'utf8');

assert.match(css, /--face:\s*#ece9d8/i, 'Windowsクラシック配色を使うこと');
assert.match(css, /border-radius:\s*0\s*!important/, '角丸を全面禁止すること');
assert.match(css, /button:active[\s\S]*border-color:\s*var\(--border-dark\) var\(--border-light\)/, '押下時に枠を反転すること');
assert.match(css, /table\.data-grid[\s\S]*table-layout:\s*fixed/, '一覧列幅を固定すること');
assert.doesNotMatch(css, /box-shadow\s*:/, 'ふんわりした影を使わないこと');

for (const html of [publicHtml, adminHtml, noticeHtml]) {
  assert.match(html, /back-navigation\.js/, '共通の戻る導線を読み込むこと');
}
assert.match(publicHtml, /id="viewMode"[\s\S]*線区毎[\s\S]*運転のみ[\s\S]*運休のみ/, '公開一覧の指定表示を備えること');
assert.match(publicJs, /latestChange[\s\S]*addedCount[\s\S]*removedCount[\s\S]*changedCount/, '公開差分を表示すること');
assert.match(publicJs, /plannedHistory/, '予定臨の列車別履歴を表示すること');
assert.match(adminHtml, /id="diagramPeriod"/, 'ダイヤ改正を選択できること');
assert.match(adminHtml, /運転報PDF/, '運転活休通達PDFへの導線を備えること');
assert.match(adminJs, /diagramPeriodId/, '選択した改正をAPIへ渡すこと');
assert.match(adminJs, /timeChanges:\s*collectTimeChanges\(\)/, '駅ごとの時刻変更を保存すること');
assert.match(noticeHtml, /@page\s*\{\s*size:A4 portrait/, '通達をA4 PDF出力できること');

console.log('operation service tests: ok');
