'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const css = fs.readFileSync('operation-service/styles.css', 'utf8');
const publicHtml = fs.readFileSync('operation-service/index.html', 'utf8');
const adminHtml = fs.readFileSync('operation-service/admin.html', 'utf8');
const publicJs = fs.readFileSync('operation-service/public.js', 'utf8');
const adminJs = fs.readFileSync('operation-service/admin.js', 'utf8');
const noticeHtml = fs.readFileSync('operation-service/notice.html', 'utf8');
const noticeJs = fs.readFileSync('operation-service/notice.js', 'utf8');
const authGuard = fs.readFileSync('auth_guard.js', 'utf8');
const periodHtml = fs.readFileSync('operation-service/diagram-periods.html', 'utf8');
const guideHtml = fs.readFileSync('operation-service/guide.html', 'utf8');
const adminUtils = require('../operation-service/admin-utils.js');

assert.match(css, /--face:\s*#ece9d8/i, 'Windowsクラシック配色を使うこと');
assert.match(css, /border-radius:\s*0\s*!important/, '角丸を全面禁止すること');
assert.match(css, /button:active[\s\S]*border-color:\s*var\(--border-dark\) var\(--border-light\)/, '押下時に枠を反転すること');
assert.match(css, /table\.data-grid[\s\S]*table-layout:\s*fixed/, '一覧列幅を固定すること');
assert.doesNotMatch(css, /box-shadow\s*:/, 'ふんわりした影を使わないこと');

for (const html of [publicHtml, adminHtml, noticeHtml, periodHtml, guideHtml]) {
  assert.match(html, /back-navigation\.js/, '共通の戻る導線を読み込むこと');
}
assert.match(publicHtml, /id="viewMode"[\s\S]*線区毎[\s\S]*運転のみ[\s\S]*運休のみ/, '公開一覧の指定表示を備えること');
assert.match(publicHtml, /運転日[\s\S]*線区[\s\S]*始発駅[\s\S]*終着駅[\s\S]*備考[\s\S]*更新日時/, '公開一覧に業務上必要な列を備えること');
const publicTable = publicHtml.match(/<table[^>]*public-notice-grid[\s\S]*?<\/table>/)[0];
const publicHeaders = [...publicTable.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1]);
assert.deepEqual(publicHeaders, ['活休', '区分', '運転日', '線区', '列車番号', '列車種別', '始発駅', '終着駅', '表題', '備考', '更新日時']);
assert.equal([...publicTable.matchAll(/<col\s/g)].length, publicHeaders.length, '列幅の定義を見出しの列数と揃えること');
assert.match(publicTable, /colspan="11"/, '読込中の表示は11列分にすること');
assert.match(publicHtml, /id="diagramPeriod"/, '公開画面でも切替期間の改正を選べること');
assert.match(publicJs, /latestChange[\s\S]*addedCount[\s\S]*removedCount[\s\S]*changedCount/, '公開差分を表示すること');
assert.match(publicJs, /plannedHistory/, '予定臨の列車別履歴を表示すること');
assert.match(adminHtml, /id="diagramPeriod"/, 'ダイヤ改正を選択できること');
assert.match(adminHtml, /運転報PDF/, '運転活休通達PDFへの導線を備えること');
assert.match(adminJs, /diagramPeriodId/, '選択した改正をAPIへ渡すこと');
assert.match(adminJs, /timeChanges:\s*collectTimeChanges\(\)/, '駅ごとの時刻変更を保存すること');
assert.match(adminHtml, /id="serviceDateMode"[\s\S]*複数日[\s\S]*期間/, '運転日を単日・複数日・期間で指定できること');
assert.match(adminHtml, /id="bulkServiceDateMode"[\s\S]*id="bulkOperationDatePicker"[\s\S]*id="bulkOperationDateList"/, '一括操作の複数日を日付追加式で指定できること');
assert.match(adminHtml, /運転日指定[\s\S]*id="serviceDateMode"[\s\S]*id="operationDatePicker"[\s\S]*id="operationDateList"/, '通常登録の複数日も編集欄内で指定できること');
assert.match(adminHtml, /id="catalogSort"[\s\S]*線区順/, 'ダイヤ原簿を線区でソートできること');
assert.match(adminHtml, /id="trainLine"/, '管理画面で線区絞り込みができること');
assert.match(publicHtml, /id="lineFilter"/, '公開画面で線区絞り込みができること');
assert.match(publicHtml, />発表件数</, '公開画面の件数表示は「発表件数」とすること');
assert.doesNotMatch(publicHtml, />公表件数</, '「公表件数」の旧表記を残さないこと');
assert.match(publicHtml, /href="guide\.html">ご利用案内/, '公開画面から専用のご利用案内を開けること');
assert.match(adminHtml, /href="guide\.html">ご利用案内/, '管理画面から専用のご利用案内を開けること');
assert.match(guideHtml, /一括運転・一括運休[\s\S]*100列車の上限はありません/, '専用案内に一括操作を記載すること');
assert.match(adminJs, /line\s*&&\s*!\(train\.lines\s*\|\|\s*\[\]\)\.includes\(line\)/, '統合列車が通る全線区を絞り込み対象にすること');
assert.match(publicJs, /line\s*&&\s*!\(item\.lines\s*\|\|\s*\[\]\)\.includes\(line\)/, '公開画面も列車が通る全線区を絞り込み対象にすること');
assert.match(adminHtml, /id="bulkSuspend"[\s\S]*一括運休/, '複数列車の一括運休操作を備えること');
assert.match(adminHtml, /id="bulkOperate"[\s\S]*一括運転/, '複数列車の一括運転操作を備えること');
assert.match(adminHtml, /id="bulkClearActivity"[\s\S]*活休未入力/, '複数列車の活休未入力操作を備えること');
assert.match(adminHtml, /id="clearActivity"[\s\S]*活休未入力へ戻す/, '単独列車の活休未入力操作を備えること');
assert.match(adminJs, /operationKind:\s*operate\s*\?\s*'operation'\s*:\s*'suspension'[\s\S]*operationState:\s*operate\s*\?\s*'operate'\s*:\s*'suspend'/, '一括運転・運休を対応する活休として登録すること');
assert.match(adminJs, /\/api\/operation-service\/notices\/clear-activity[\s\S]*trainNumbers/, '活休未入力は専用APIへ列車番号と運転日を送ること');
assert.match(adminJs, /operationState === 'unknown'[\s\S]*未入力状態は公開できません/, '活休未入力を公開通達として保存しないこと');
assert.match(adminJs, /title:\s*operate\s*\?[^:]+:\s*'運転休止'/, '一括運休の表題を運転休止とすること');
assert.doesNotMatch(adminJs, /100列車まで/, '一括登録の件数を100列車に制限しないこと');
assert.match(adminJs, /Promise\.all\(Array\.from\(\{length:\s*Math\.min\(4,\s*trains\.length\)\}/, '大量一括登録を4件並行で処理すること');
assert.match(adminHtml, /id="bulkResultPanel"[\s\S]*id="bulkFailureRows"/, '一括処理の全失敗詳細を表示すること');
assert.doesNotMatch(adminJs, /failed\.slice\(/, '失敗詳細を先頭数件に切り捨てないこと');
assert.match(adminJs, /bulkOperationRunning[\s\S]*setBulkOperationRunning/, '一括処理中の二重実行と選択変更を防ぐこと');
assert.match(adminJs, /function existingNoticeForTrain[\s\S]*scheduleKey === train\.scheduleKey[\s\S]*sameIntegratedTrain/, 'ダイヤ原簿の選択から登録済み活休を復元できること');
assert.match(adminJs, /sameUniqueTrainNumber[\s\S]*catalog\.filter/, '旧統合データも列車番号が一意なら登録済み活休を復元すること');
assert.match(adminJs, /if \(existing\) \{[\s\S]*editNotice\(existing, train\)/, '登録済み列車の選択時は新規入力ではなく編集表示すること');
assert.doesNotMatch(adminJs, /trainNumbers[\s\S]{0,80}join\('→'\)/, '異なる列車番号を矢印で連結表示しないこと');
assert.match(adminHtml, /<th>選<\/th><th>活休<\/th>/, 'ダイヤ原簿に活休列を表示すること');
assert.match(adminJs, /const notice = existingNoticeForTrain\(train\)[\s\S]*badge-\$\{escapeHtml\(state\)\}/, 'ダイヤ原簿に登録済み活休状態を表示すること');
assert.match(css, /\.catalog-grid td\s*\{[\s\S]*height:\s*18px[\s\S]*padding:\s*0 3px/, 'ダイヤ原簿の行高を密にすること');
assert.match(adminHtml, /data-auth-display="flex"/, '認証後も管理画面本体をflex表示すること');
assert.match(authGuard, /mainContent\.dataset\.authDisplay\s*\|\|\s*'block'/, '画面ごとの認証後表示方式を守ること');
assert.doesNotMatch(publicJs, /<th>No\.<\/th><th>線区<\/th>/, '公開時刻表にNo.・線区列を戻さないこと');
assert.doesNotMatch(adminHtml, /<th>No\.<\/th><th>線区<\/th>/, '管理時刻表にNo.・線区列を戻さないこと');
assert.doesNotMatch(noticeJs, /<th>No\.<\/th><th>線区<\/th>/, '通達時刻表にNo.・線区列を戻さないこと');
assert.match(noticeHtml, /@page\s*\{\s*size:A4 portrait/, '通達をA4 PDF出力できること');
assert.match(css, /font:\s*11px[^;]*"MS UI Gothic",\s*"MS PGothic",\s*Tahoma/, 'クラシック和文フォントを優先すること');
assert.doesNotMatch(css, /\.data-grid tbody tr:hover/, '一覧に現代的な行ホバーを設けないこと');
assert.match(css, /\.summary-strip\s*\{[\s\S]*display:\s*flex[\s\S]*flex-wrap:\s*nowrap/, '集計欄を左寄せ一列にすること');
assert.match(css, /\.summary-value\s*\{[\s\S]*min-width:\s*40px[\s\S]*text-align:\s*right[\s\S]*font-variant-numeric:\s*tabular-nums/, '集計値を固定幅の凹み欄にすること');
assert.match(css, /body\s*\{[\s\S]*height:\s*100dvh[\s\S]*overflow:\s*hidden/, 'デスクトップ表示でページ全体をスクロールさせないこと');
assert.doesNotMatch(css, /calc\(100vh\s*-/, '固定値を引く高さ計算を使わないこと');

assert.equal(adminUtils.normalizeDate('2026/10/15'), '2026-10-15');
assert.equal(adminUtils.normalizeDate('2026/02/29'), '', '存在しない日付を受け入れないこと');
assert.equal(adminUtils.normalizeDate('2026/02/31'), '', '日の範囲外を受け入れないこと');
assert.match(adminUtils.dateSelectionResult({mode:'single', single:'2026/02/31'}).message, /^単日/);
assert.match(adminUtils.dateSelectionResult({mode:'multiple', dates:[]}).message, /日付追加/);
assert.match(adminUtils.dateSelectionResult({mode:'range', start:'2026/10/18', end:'2026/10/17'}).message, /開始日が終了日以前/);
assert.deepEqual(adminUtils.dateSelectionResult({mode:'multiple', dates:['2026/10/17', '2026/10/15']}).spec.serviceDates, ['2026-10-15', '2026-10-17']);
const failures = Array.from({length: 7}, (_, index) => ({trainNumber: `9${index}`, reason: `失敗${index}`}));
const bulkResult = adminUtils.bulkResultModel('一括運休', 2, failures, 9);
assert.equal(bulkResult.failed.length, 7, '6件以上の失敗もすべて保持すること');
assert.deepEqual(bulkResult.failed.map(item => item.trainNumber), failures.map(item => item.trainNumber));
assert.match(publicJs, /notice\.html\?id=.*serviceDate=/, '公開側PDFに一覧の運転日を渡すこと');
assert.match(noticeJs, /searchParams\.set\('serviceDate'/, '通達詳細も指定日の現行原簿を参照すること');

// Exercise the actual list renderer without fetching or modifying production data.
const publicNodes = new Map();
function publicNode(id) {
  if (!publicNodes.has(id)) publicNodes.set(id, {
    value: '', textContent: '', markup: '', classList: {toggle() {}},
    addEventListener() {}, querySelectorAll() { return []; },
    replaceChildren(markup) { this.markup = markup; },
  });
  return publicNodes.get(id);
}
const publicContext = {
  document: {
    getElementById: publicNode,
    createRange: () => ({selectNodeContents() {}, createContextualFragment: markup => markup}),
  },
  location: {hostname: 'localhost', search: '?date=2026-10-18'},
  URLSearchParams, Intl, Date,
};
const rendererSource = publicJs.replace(/  loadNotices\(\);\s*\}\)\(\);\s*$/, `  globalThis.renderTestList = items => { notices = items; renderList(); };
})();`);
assert.notEqual(rendererSource, publicJs, 'テスト時だけ初期API読込を一覧描画の入口に置き換えること');
vm.runInNewContext(rendererSource, publicContext);
publicContext.renderTestList([{
  id: 'test', trainNumber: '5091', trainType: '貨物', category: 'regular', operationState: 'suspend',
  serviceDate: '2026-10-18', sectionStart: '新鶴見', sectionEnd: '真鶴', title: '運転休止',
  lines: ['東海道'], scheduleSnapshot: {stops: [{station: '新鶴見', departure: '02:44:00'}]},
}]);
const publicCells = [...publicNode('noticeRows').markup.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
assert.equal(publicCells.length, publicHeaders.length, 'データ行と見出しの列数を揃えること');
assert.deepEqual(publicCells.slice(6, 9), ['新鶴見', '真鶴', '運転休止'], '始発駅・終着駅を隣接させ、表題はその後に表示すること');
assert.doesNotMatch(publicNode('noticeRows').markup, /02:44/, '一覧には運転時刻を表示しないこと');
assert.match(publicNode('detail').markup, /02:44:00/, '詳細の列車時刻表は残すこと');
publicContext.renderTestList([]);
assert.match(publicNode('noticeRows').markup, /colspan="11"/, '該当なしの表示も11列分にすること');

console.log('operation service tests: ok');
