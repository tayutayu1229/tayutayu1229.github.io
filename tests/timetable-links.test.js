const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

for (const file of ['T-time/webatos.html', 'T-time/mobileatos.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /opTrain\.connectionStation, opTrain\.continuationGroupId/,
    `${file}: 継送リンクへ continuationGroupId を渡す`);
  const start = html.indexOf('function jumpToTrain(');
  const end = html.indexOf('function updateSystemClock(', start);
  assert.ok(start >= 0 && end > start, `${file}: 接続先検索が見つかりません`);
  const values = new Map([
    ['dateInput', {value: '2026-09-20'}], ['lineSelect', {value: ''}],
    ['crownSelect', {value: ''}], ['trainNoInput', {value: ''}],
  ]);
  let searched = false;
  let displayed = null;
  const context = vm.createContext({
    rawJsonData: [],
    normalizeString: value => String(value || '').toUpperCase().replace(/\s/g, ''),
    document: {getElementById: id => values.get(id)},
    TayunetYardMovement: {open: () => false},
    TayunetTimetableVersion: require('../assets/js/timetable-version.js'),
    isHoliday: () => false,
    performSearch: () => { searched = true; },
    updateSummaryAndTable: (...args) => { displayed = args; },
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
  assert.equal(searched, false, `${file}: 特定済みの継走先を再検索しない`);
  assert.equal(displayed[0].trainNumber, '回3101M');
  assert.equal(displayed[1], '東北');
  assert.equal(displayed[2], '2026/09/20');

  searched = false;
  context.rawJsonData = [{
    trainNumber: '回3101M', line: '東北回', startDate: '2026/09/20',
    origin: '東大宮操', destination: '東　京', kid2: 'K-3101',
    stops: [{station: '東大宮操'}, {station: '大　宮'}],
  }];
  context.jumpToTrain('回3101M', 'K-3101', 'prev', '大　宮');
  assert.equal(values.get('lineSelect').value, '東北回', `${file}: 区間末尾の大宮へ戻れる`);
  assert.equal(searched, false, `${file}: 戻り方向も特定済みの継走先を再検索しない`);
  assert.equal(displayed[0].line, '東北回');

  values.get('lineSelect').value = '尻手短';
  values.get('dateInput').value = '2026-09-28';
  values.get('crownSelect').value = '';
  values.get('trainNoInput').value = '9571';
  context.rawJsonData = [{
    trainNumber: '9571', line: '尻手短', startDate: '2026/09/28', dayType: '平日',
    continuationGroupId: 'KID-20260928-9571',
    stops: [{station: '尻　手'}, {station: '割　畑'}],
  }, {
    trainNumber: '9571', line: '東海道貨物', startDate: '2026/09/28', dayType: '平日',
    continuationGroupId: 'KID-20260928-9571',
    stops: [{station: '割　畑'}, {station: '新鶴見'}],
  }];
  context.jumpToTrain('9571', '', 'either', '割　畑', 'KID-20260928-9571');
  assert.equal(displayed[0].line, '東海道貨物', `${file}: 同一列番の継送先は別線区を開く`);
  assert.equal(values.get('lineSelect').value, '東海道貨物');
}
console.log('timetable segment links: ok');
