const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('atosweb.html', 'utf8');

for (const action of [
  'toggle-history',
  'open-operation-train',
  'switch-station-view',
  'filter-station-rows',
  'open-train-from-station',
  'render-unified-source',
  'open-external-linked',
]) {
  assert.match(html, new RegExp(`data-atos-action=["']${action}["']`), `missing delegated action: ${action}`);
}
assert.doesNotMatch(
  html,
  /(?:html|choices\.push|operationTrainHtml|linked)=?[^\n]*onclick=/,
  'dynamically generated ATOS controls must not use inline onclick handlers',
);

function sourceBetween(start, end) {
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return html.slice(startIndex, endIndex);
}

const context = {
  reportedAtosDestinationChanges: new Set(),
  atosHistoryServiceDate() { return '2026-08-08'; },
  addDiagnostic() {},
  historyActualTime(item) { return item?.observedAt?.slice(11, 19) || ''; },
  timetableStopStation(stop) { return stop?.['odpt:station'] || ''; },
  samePhysicalStation(left, right) { return left === right; },
};
vm.createContext(context);
vm.runInContext(
  `${sourceBetween('function supplementTimetableWithHistory', 'function applyLiveDestinationChange')}
   ${sourceBetween('function applyLiveDestinationChange', 'async function openAtosTrainTimetable')}`,
  context,
);

const timetable = {
  'odpt:railway': 'LineA',
  'odpt:trainNumber': '100M',
  'odpt:originStation': ['A'],
  'odpt:destinationStation': ['C'],
  'odpt:trainTimetableObject': [
    {'odpt:station': 'A', 'odpt:departureTime': '10:00'},
    {'odpt:station': 'B', 'odpt:arrivalTime': '10:10', 'odpt:departureTime': '10:11'},
    {'odpt:station': 'C', 'odpt:arrivalTime': '10:20'},
  ],
};
const history = {
  railways: ['LineA'],
  stations: {
    A: {departure: {observedAt: '2026-08-08T10:00:05+09:00'}},
    X: {departure: {observedAt: '2026-08-08T10:05:07+09:00'}},
    B: {arrival: {observedAt: '2026-08-08T10:10:09+09:00'}},
  },
};
const merged = context.supplementTimetableWithHistory(timetable, null, history);
assert.deepEqual(
  merged['odpt:trainTimetableObject'].map(stop => stop['odpt:station']),
  ['A', 'X', 'B', 'C'],
  'history-only stations must not move ahead of the planned terminal',
);
assert.equal(
  merged['odpt:trainTimetableObject'][1].__actualArrivalTime,
  '10:05:07',
  'a pass-through observation should be shown in the prediction/actual column',
);

const changed = context.applyLiveDestinationChange(timetable, {
  'odpt:fromStation': 'B',
  'odpt:toStation': null,
  'odpt:destinationStation': ['X'],
});
assert.deepEqual(
  Array.from(changed['odpt:trainTimetableObject'], stop => stop['odpt:station']),
  ['A', 'B', 'X'],
  'an unplanned short-turn destination should be inserted after the current station',
);
assert.deepEqual(changed.__plannedDestinationStation, ['C']);

context.atosRailwayData = [{
  'owl:sameAs': 'LineA',
  'odpt:stationOrder': [
    {'odpt:station': 'A'},
    {'odpt:station': 'P'},
    {'odpt:station': 'C'},
  ],
}];
context.historyPredictionForStation = (routeHistory, station) => routeHistory?.predictions?.[station] || null;
const passSupplemented = context.supplementTimetableWithRouteStations({
  'odpt:railway': 'LineA',
  'odpt:trainTimetableObject': [
    {'odpt:station': 'A', 'odpt:departureTime': '10:00:00'},
    {'odpt:station': 'C', 'odpt:arrivalTime': '10:20:00'},
  ],
}, null, {predictions: {P: {plannedTime: '10:09:30'}}});
assert.deepEqual(
  Array.from(passSupplemented['odpt:trainTimetableObject'], stop => stop['odpt:station']),
  ['A', 'P', 'C'],
  'omitted pass-through stations must be restored from railway order',
);
assert.equal(passSupplemented['odpt:trainTimetableObject'][1]['odpt:arrivalTime'], '10:09:30');
assert.equal(passSupplemented['odpt:trainTimetableObject'][1].__predictionBasis, 'history');

console.log('atosweb history tests: ok');

const operationContext = {
  externalTimetables: [{
    line: '東海道線', trainNumber: '100M', startDate: '2026/08/08',
    origin: '東京', destination: '熱海', tt1: 'k', tr1: '90M', kid1: 'K001',
    tt2: 'o', tr2: '101M', kid2: 'K002', stops: [{station: '東京'}, {station: '熱海'}],
  }],
  normalizeTrainKey(value) { return String(value || '').toUpperCase(); },
  timetableStopStation(stop) { return stop?.['odpt:station'] || ''; },
  operationStationKey(value) { return String(value || '').replace(/[\s　駅]/g, ''); },
  externalTrainEndpoint(train, direction) {
    return direction === 'previous' ? train.origin : train.destination;
  },
  externalTrainVersionsForDate(candidates) { return candidates; },
  getLineTitle() { return '東海道線'; },
};
vm.createContext(operationContext);
vm.runInContext(
  sourceBetween('function findExternalOperationSource', 'async function openAtosOperationTrain'),
  operationContext,
);
const operation = operationContext.findExternalOperationSource(
  '100M',
  'odpt.Railway:JR-East.Tokaido',
  [{'odpt:station': '東京'}, {'odpt:station': '熱海'}],
  '2026-08-08',
  null,
);
assert.equal(operation.previousTrain, '90M');
assert.equal(operation.previousKid, 'K001');
assert.equal(operation.previousStation, '東京');
assert.equal(operation.nextTrain, '101M');
assert.equal(operation.nextKid, 'K002');
assert.equal(operation.nextStation, '熱海');

console.log('atosweb operation tests: ok');
