'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const editor = fs.readFileSync('timeedit.html', 'utf8');
assert.doesNotMatch(editor, /footnoteEnabled|付記を出力/, '作成時の付記有無スイッチを残さないこと');
assert.match(editor, /<textarea id="footnote"/, '付記を複数行入力できること');
assert.match(editor, /JSON貼り付け/);
assert.match(editor, /id="jsonPasteDialog"/);
assert.match(editor, /parsePastedTrainJson/);
assert.match(editor, /addDetailInput\('この駅からの列車種別', 'trainType'\)/);
assert.match(editor, /detailButton\.textContent = '別項を編集'/);

const viewer = fs.readFileSync('JREgyoumu/ATOSsys/train_timetable.html', 'utf8');
assert.match(viewer, /id="output-datetime"/);
assert.match(viewer, /id="execution-date"/);
assert.match(viewer, /applyExecutionDate/);
assert.match(viewer, /id="include-footnotes"/);
assert.match(viewer, /class="timetable-footnotes" id="timetable-footnotes"/);
assert.match(viewer, /TayunetTimetableFields\.footnotes/);

const station = fs.readFileSync('T-time/ekibetuatos.html', 'utf8');
assert.match(station, /appendLinkCell\(tr, train\.trainNumber, \(\) => showOverlay\(train\)\)/);
assert.doesNotMatch(station, /class="modal-header"/, '駅別から開く列車モーダルにヘッダーを表示しないこと');
assert.match(station, /class="close-btn"[^>]*>閉じる/);

for (const file of ['T-time/webatos.html', 'T-time/mobileatos.html']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /指定された列車番号は存在しません。/);
  assert.match(source, /TayunetTimetableFields\.displayedType/);
}

console.log('timetable optional fields UI: ok');
