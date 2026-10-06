const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('webatos-system/app.js', 'utf8');
const html = fs.readFileSync('webatos-system/index.html', 'utf8');

for (const field of [
  'data-field="diagram-line"',
  'data-query="diagram-date"',
  'data-query="diagram-train"',
  'data-field="diagram-station"'
]) assert.match(app, new RegExp(field), `${field} must remain available`);

for (const feature of [
  'serviceDayMatches',
  'datedTimetables',
  'predictedTime',
  'trainDiagramMarkup',
  'showTrainDiagram',
  'showStationDiagram',
  'showDiagramCalendar',
  'data-station-page',
  'operation-train-link'
]) assert.match(app, new RegExp(feature), `${feature} must remain implemented`);

for (const column of ['列車種別', '抑止', '着時刻', '発時刻', '番線', '運用列番', '遅延']) {
  assert.ok(app.includes(column), `${column} must remain in a diagram monitor`);
}

assert.match(html, /timetable-fields\.js/);
assert.match(html, /timetable-operations\.js/);
assert.match(app, /上りのみ/);
assert.match(app, /下りのみ/);
assert.match(html, />東北<\/b><b id="head-station">東京<\/b><b>atosuser01<\/b>/);

console.log('WebATOS diagram monitor checks: ok');
