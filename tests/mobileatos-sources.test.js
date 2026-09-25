const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('T-time/mobileatos.html', 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .find(source => source.includes('function renderTable(data)'));
assert.ok(script, 'mobileatos の検索処理が見つかりません');
assert.match(html, /\.cancelled-row td\.cancelled-cell \{ background: #4b5563; color: #fff; \}/);

class Element {
  constructor(value = '') {
    this.value = value;
    this.children = [];
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
    };
    this.textContent = '';
    this.innerText = '';
  }
  set innerHTML(value) { this.children = []; this._innerHTML = value; }
  get innerHTML() { return this._innerHTML || ''; }
  appendChild(child) { this.children.push(child); return child; }
}

const elements = new Map([
  ['scheduleBody', new Element()], ['lineSelect', new Element('常磐線快速')],
  ['dateInput', new Element('2026-09-19')], ['crownSelect', new Element('')],
  ['trainNoInput', new Element('2438M')], ['messageArea', new Element()],
  ['contentArea', new Element()],
]);
const odptTrain = {
  'odpt:trainNumber': '2438M', 'odpt:railway': 'odpt.Railway:JR-East.JobanRapid',
  'odpt:trainType': 'odpt.TrainType:JR-East.Local',
  'odpt:originStation': ['odpt.Station:JR-East.JobanRapid.Toride'],
  'odpt:destinationStation': ['odpt.Station:JR-East.JobanRapid.Ueno'],
  'odpt:trainTimetableObject': [
    {'odpt:departureStation': 'odpt.Station:JR-East.JobanRapid.Toride', 'odpt:departureTime': '19:28'},
    {'odpt:arrivalStation': 'odpt.Station:JR-East.JobanRapid.Ueno', 'odpt:arrivalTime': '20:07'},
  ],
};
const history = {
  count: 1, railways: ['odpt.Railway:JR-East.JobanRapid'],
  stations: {
    'odpt.Station:JR-East.JobanRapid.Toride': {
      departure: {observedAt: '2026-09-19T19:29:00+09:00'},
    },
  },
};
let odptRows = [odptTrain];
let captured = null;
const fetchedUrls = [];
const context = vm.createContext({
  window: {},
  TayunetTimetableVersion: require('../assets/js/timetable-version.js'),
  TayunetTimetableOperations: require('../assets/js/timetable-operations.js'),
  TayunetTimetableFields: require('../assets/js/timetable-fields.js'),
  document: {getElementById: id => elements.get(id), createElement: () => new Element(), createTextNode: text => ({textContent: text})},
  fetch: async url => {
    fetchedUrls.push(String(url));
    const data = String(url).includes('train-history') ? history
      : String(url).includes('odpt:Railway') ? [{
        'owl:sameAs': 'odpt.Railway:JR-East.JobanRapid',
        'odpt:railwayTitle': {ja: '常磐線快速'},
        'odpt:stationOrder': [{
          'odpt:station': 'odpt.Station:JR-East.JobanRapid.Toride',
          'odpt:stationTitle': {ja: '取手'},
        }],
      }]
      : String(url).includes('odpt:Station') ? [{
        'owl:sameAs': 'odpt.Station:JR-East.JobanRapid.Ueno',
        'odpt:stationTitle': {ja: '上野'},
      }]
      : odptRows;
    return {ok: true, json: async () => data};
  },
  URLSearchParams, AbortController, setTimeout, clearTimeout, Date, Intl, console,
});
vm.runInContext(script, context, {filename: 'mobileatos.html#script'});
vm.runInContext('updateSummaryAndTable = (...args) => { window.captured = args; }', context);

(async () => {
  await vm.runInContext('loadOdptMetadata()', context);
  const record = vm.runInContext('odptRecord(' + JSON.stringify(odptTrain) + ')', context);
  assert.equal(record.origin, '取手');
  assert.equal(record.destination, '上野');
  assert.equal(record.stops[0].departure, '19:28');

  await vm.runInContext('performSearch()', context);
  captured = context.window.captured;
  assert.equal(captured[0].trainNumber, '2438M');
  assert.equal(captured[0].stops[0].departureActual, '19:29:00');
  assert.match(captured[5], /ODPT列車時刻表.*Ubuntu運行履歴/);
  assert.ok(fetchedUrls.some(url => url.includes('railway=odpt.Railway%3AJR-East.JobanRapid')));

  odptRows = [];
  await vm.runInContext('performSearch()', context);
  captured = context.window.captured;
  assert.equal(captured[0].stops[0].station, '取手');
  assert.equal(captured[0].stops[0].departureActual, '19:29:00');
  assert.match(captured[5], /Ubuntu列車運行履歴（実績）/);

  vm.runInContext(`renderTable({type: '普通', stops: [{station: '$取手', arrival: '20:00',
    arrivalActual: '20:01:00', departure: '=', departureActual: '20:02:00', trackN: '1', trainType:'快速'}]})`, context);
  const row = elements.get('scheduleBody').children[0];
  assert.equal(row.classes.has('cancelled-row'), true);
  for (const index of [2, 3, 4, 6]) assert.match(row.children[index].className, /cancelled-cell/);
  assert.match(row.children[5].className, /cancelled-equals/);
  for (const index of [0, 7, 8, 9]) assert.doesNotMatch(row.children[index].className, /cancelled-cell/);
  assert.equal(row.children[0].textContent, '快速');
  vm.runInContext(`renderTable({type: '普通', stops: [{station: '＄上野', arrival: '20:00', departure: '20:02'}]})`, context);
  assert.equal(elements.get('scheduleBody').children[0].classes.has('cancelled-row'), true);
  console.log('mobileatos source and cancellation display: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
