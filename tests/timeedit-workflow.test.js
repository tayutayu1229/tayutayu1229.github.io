const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('timeedit.html', 'utf8');
const mainScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(source => source.includes('function buildLinePatterns'));

assert.ok(mainScript, 'timeedit.html の編集処理が見つかりません');

const elements = new Map();
function element(id, value = '') {
  const item = {id, value, hidden: true, textContent: '', className: '', style: {}};
  elements.set(id, item);
  return item;
}

[
  'line', 'origin', 'destination', 'trainNumber', 'tr1', 'tr2', 'kid1', 'kid2', 'tt1', 'tt2'
].forEach(id => element(id));

const context = vm.createContext({
  window: {},
  document: {getElementById: id => elements.get(id)},
  confirm: () => true,
  alert: message => { throw new Error(message); },
  console,
  setTimeout,
});
vm.runInContext(mainScript, context, {filename: 'timeedit.html#editor'});

const timetable = [
  {
    trainNumber: '101', line: 'テスト線',
    stops: [
      {station: '甲', trackN: '1'},
      {station: '乙', trackN: '2'},
      {station: '丙', trackN: '3'},
    ],
  },
  {
    trainNumber: '102', line: 'テスト線',
    stops: [
      {station: '丙', trackN: '4'},
      {station: '乙', trackN: '5'},
      {station: '甲', trackN: '6'},
    ],
  },
];
vm.runInContext(`masterData = ${JSON.stringify(timetable)}`, context);

const patterns = vm.runInContext('buildLinePatterns("テスト線")', context);
assert.equal(patterns.length, 2);
assert.deepEqual(
  JSON.parse(JSON.stringify(patterns.map(pattern => pattern.stops.map(stop => stop.station)))),
  [['甲', '乙', '丙'], ['丙', '乙', '甲']],
);

assert.deepEqual(
  JSON.parse(JSON.stringify(vm.runInContext('directionalTrackCandidates("乙", "丙", "甲", "テスト線")', context))),
  ['5'],
  '逆方向の前後駅に合う番線が優先されること',
);

elements.get('line').value = 'テスト線';
elements.get('origin').value = '甲';
elements.get('destination').value = '丙';
vm.runInContext(`
  stops = [
    {station: '甲', arrival: '', departure: '10:00', trackN: '1'},
    {station: '乙', arrival: '10:10', departure: '10:11', trackN: '2'},
    {station: '丙', arrival: '10:20', departure: '', trackN: '3'}
  ];
  updateUI = () => {};
  showActionMsg = () => {};
  reverseStops();
`, context);
const reversed = JSON.parse(vm.runInContext('JSON.stringify(stops)', context));
assert.deepEqual(reversed.map(stop => stop.station), ['丙', '乙', '甲']);
assert.deepEqual(reversed.map(stop => stop.trackN), ['4', '5', '6']);
assert.equal(elements.get('origin').value, '丙');
assert.equal(elements.get('destination').value, '甲');

elements.get('trainNumber').value = '101';
elements.get('tr2').value = '201';
elements.get('kid2').value = 'K-201';
elements.get('tt2').value = 'k';
elements.get('destination').value = '丙';
vm.runInContext(`
  stops = [{station: '丙', arrival: '10:20', departure: '', trackN: '3'}];
  prepareNextSection();
`, context);
const nextStops = JSON.parse(vm.runInContext('JSON.stringify(stops)', context));
assert.equal(elements.get('trainNumber').value, '201');
assert.equal(elements.get('tr1').value, '101');
assert.equal(elements.get('kid1').value, 'K-201');
assert.equal(elements.get('tt1').value, 'k');
assert.equal(elements.get('tr2').value, '');
assert.equal(elements.get('origin').value, '丙');
assert.equal(elements.get('destination').value, '');
assert.deepEqual(nextStops, [{station: '丙', arrival: '', departure: '', trackN: '3'}]);

console.log('timeedit workflow: ok');
