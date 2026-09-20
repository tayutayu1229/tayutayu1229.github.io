const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const file of ['T-time/webatos.html', 'T-time/mobileatos.html']) {
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('function jumpToTrain(');
  const end = html.indexOf('function updateSystemClock(', start);
  assert.ok(start >= 0 && end > start, `${file}: 接続先検索が見つかりません`);
  const values = new Map([
    ['dateInput', {value: '2026-09-20'}], ['lineSelect', {value: ''}],
    ['crownSelect', {value: ''}], ['trainNoInput', {value: ''}],
  ]);
  let searched = false;
  const context = vm.createContext({
    rawJsonData: [],
    normalizeString: value => String(value || '').toUpperCase().replace(/\s/g, ''),
    document: {getElementById: id => values.get(id)},
    TayunetYardMovement: {open: () => false},
    performSearch: () => { searched = true; },
  });
  vm.runInContext(html.slice(start, end), context, {filename: file});

  context.rawJsonData = [{
    trainNumber: '回3101M', line: '東北', startDate: '2026/09/20',
    origin: '東大宮操', destination: '東　京', kid1: 'K-3101',
    stops: [{station: '大　宮'}, {station: '東　京'}],
  }];
  context.jumpToTrain('回3101M', 'K-3101', 'next', '大　宮');
  assert.equal(values.get('lineSelect').value, '東北', `${file}: 区間先頭の大宮へ継走できる`);
  assert.equal(values.get('trainNoInput').value, '3101M');
  assert.equal(searched, true);

  searched = false;
  context.rawJsonData = [{
    trainNumber: '回3101M', line: '東北回', startDate: '2026/09/20',
    origin: '東大宮操', destination: '東　京', kid2: 'K-3101',
    stops: [{station: '東大宮操'}, {station: '大　宮'}],
  }];
  context.jumpToTrain('回3101M', 'K-3101', 'prev', '大　宮');
  assert.equal(values.get('lineSelect').value, '東北回', `${file}: 区間末尾の大宮へ戻れる`);
  assert.equal(searched, true);
}
console.log('timetable segment links: ok');
