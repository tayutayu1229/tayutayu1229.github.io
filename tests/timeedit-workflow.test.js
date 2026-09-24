const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('timeedit.html', 'utf8');
const mainScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(source => source.includes('function buildLinePatterns'));

assert.ok(mainScript, 'timeedit.html の編集処理が見つかりません');

const elements = new Map();
const yardInputs = [];
function element(id, value = '') {
  const item = {id, value, hidden: true, textContent: '', className: '', style: {}, addEventListener() {}};
  elements.set(id, item);
  return item;
}

[
  'line', 'origin', 'destination', 'trainNumber', 'type', 'dataKind', 'continuationGroupId', 'dayType', 'startDate', 'name', 'speed',
  'footnoteEnabled', 'footnote',
  'tr1', 'tr2', 'kid1', 'kid2', 'tt1', 'tt2'
].forEach(id => element(id));

const context = vm.createContext({
  window: {},
  document: {getElementById: id => elements.get(id), querySelectorAll: selector => selector === '[data-yard-field]' ? yardInputs : []},
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
    {station: '乙', arrival: '10:10', departure: '10:11', trackN: '2', operationInfo:'分割', operationTrainNumber:'103'},
    {station: '丙', arrival: '10:20', departure: '', trackN: '3'}
  ];
  updateUI = () => {};
  showActionMsg = () => {};
  reverseStops();
`, context);
const reversed = JSON.parse(vm.runInContext('JSON.stringify(stops)', context));
assert.deepEqual(reversed.map(stop => stop.station), ['丙', '乙', '甲']);
assert.deepEqual(reversed.map(stop => stop.trackN), ['4', '5', '6']);
assert.equal(reversed[1].operationInfo, '分割');
assert.equal(reversed[1].operationTrainNumber, '103');
assert.equal(elements.get('origin').value, '丙');
assert.equal(elements.get('destination').value, '甲');

element('routePattern', '0');
element('quoteStart', '0');
element('quoteEnd', '1');
element('lineQuotePanel');
elements.get('origin').value = '範囲外始発';
elements.get('destination').value = '範囲外終着';
vm.runInContext(`
  linePatterns = [{stops:[{station:'甲',trackN:'1'},{station:'乙',trackN:'2'}]}];
  applyLineTemplate();
`, context);
assert.equal(elements.get('origin').value, '範囲外始発');
assert.equal(elements.get('destination').value, '範囲外終着');

const basicFields = {
  trainNumber: '101', type: '普通', dayType: '平日', startDate: '2026-09-19',
  line: 'テスト線', name: 'テスト号', speed: 'A', origin: '甲', destination: '丙',
};
Object.entries(basicFields).forEach(([id, value]) => { elements.get(id).value = value; });
elements.get('tr2').value = '201';
elements.get('kid2').value = 'K-201';
elements.get('tt2').value = 'k';
vm.runInContext(`
  stops = [{station: '丙', arrival: '10:20', departure: '', trackN: '3'}];
  prepareNextSection();
`, context);
const nextStops = JSON.parse(vm.runInContext('JSON.stringify(stops)', context));
assert.equal(elements.get('trainNumber').value, '201', '次区間の列車番号へ切り替わること');
assert.equal(elements.get('origin').value, '丙');
assert.equal(elements.get('destination').value, '');
for (const id of ['type','dayType','startDate','line','name','speed']) assert.equal(elements.get(id).value, basicFields[id]);
assert.equal(elements.get('tr1').value, '101');
assert.equal(elements.get('kid1').value, 'K-201');
assert.equal(elements.get('tt1').value, 'k');
assert.equal(elements.get('tr2').value, '');
assert.deepEqual(nextStops, [{station: '丙', arrival: '', departure: '', trackN: '3'}]);

['dayType', 'startDate', 'speed', 'name', 'yardPanel', 'yardCategory', 'jsonOutput'].forEach(id => element(id));
for (const field of ['category', 'power', 'previousTrainNumber', 'nextTrainNumber', 'departureTime', 'departureTrack', 'viaTime', 'viaTrack', 'arrivalTime', 'arrivalTrack']) {
  const input = {dataset: {yardField: field}, value: ''};
  yardInputs.push(input);
  if (field === 'category') elements.set('yardCategory', input);
}
elements.get('trainNumber').value = '出9820M';
elements.get('type').value = '出区';
elements.get('line').value = '東海道貨物';
elements.get('startDate').value = '2026-09-20';
elements.get('destination').value = '国府津';
yardInputs.find(input => input.dataset.yardField === 'departureTime').value = '09:00:00';
yardInputs.find(input => input.dataset.yardField === 'arrivalTime').value = '09:08:00';
yardInputs.find(input => input.dataset.yardField === 'arrivalTrack').value = '８番';
vm.runInContext('setYardConnectionStop(); updateJSON()', context);
const yardRecord = JSON.parse(elements.get('jsonOutput').value);
assert.equal(yardRecord.yardMovement.category, '出区');
assert.equal(yardRecord.yardMovement.departureTime, '09:00:00');
assert.deepEqual(yardRecord.stops, [{station: '国府津', arrival: '09:08:00', departure: '', trackN: '８番'}]);
assert.equal(elements.get('yardPanel').hidden, false);

elements.get('footnoteEnabled').value = 'yes';
elements.get('footnote').value = '列車防護係員省略';
vm.runInContext(`stops = [{station:'国府津',arrival:'09:08:00',departure:'',trackN:'８番',operationInfo:'分割',operationTrainNumber:'9821M',operationKid:'K-9821'}]; updateJSON()`, context);
const annotatedRecord = JSON.parse(elements.get('jsonOutput').value);
assert.equal(annotatedRecord.footnote, '列車防護係員省略');
assert.equal(annotatedRecord.stops[0].operationInfo, '分割');
assert.equal(annotatedRecord.stops[0].operationTrainNumber, '9821M');

elements.get('dataKind').value = '入区';
elements.get('trainNumber').value = '入9240M';
elements.get('origin').value = '池　袋';
elements.get('destination').value = '';
elements.get('tr1').value = '回9240M';
elements.get('kid1').value = 'KID-20260921-回9240M-入9240M-池袋';
elements.get('continuationGroupId').value = 'KID-20260921-2240M-入9240M';
for (const input of yardInputs) input.value = input.dataset.yardField === 'category' ? '入区' : '';
yardInputs.find(input => input.dataset.yardField === 'power').value = 'EC';
yardInputs.find(input => input.dataset.yardField === 'departureTime').value = '19:09:00';
yardInputs.find(input => input.dataset.yardField === 'departureTrack').value = '山貨下';
yardInputs.find(input => input.dataset.yardField === 'viaTime').value = '19:11:00';
yardInputs.find(input => input.dataset.yardField === 'viaTrack').value = '連';
yardInputs.find(input => input.dataset.yardField === 'arrivalTime').value = '19:14:00';
yardInputs.find(input => input.dataset.yardField === 'arrivalTrack').value = '１５番';
vm.runInContext('handleDataKindChange(); setYardConnectionStop(); updateJSON()', context);
const inboundRecord = JSON.parse(elements.get('jsonOutput').value);
assert.equal(inboundRecord.type, '入区');
assert.equal(inboundRecord.continuationGroupId, 'KID-20260921-2240M-入9240M');
assert.equal(inboundRecord.yardMovement.previousTrainNumber, '回9240M');
assert.equal(inboundRecord.yardMovement.viaTrack, '連');
assert.equal(inboundRecord.yardMovement.arrivalTrack, '１５番');
assert.deepEqual(inboundRecord.stops, [{station: '池　袋', arrival: '', departure: '19:09:00', trackN: '山貨下'}]);

console.log('timeedit workflow: ok');
