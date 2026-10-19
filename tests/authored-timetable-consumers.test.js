'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const segments = [
  {source:'operation-service', operationServiceDate:'2026-10-20', startDate:'2026/10/20', trainNumber:'試9999', line:'第一線',
    stops:[{station:'甲',departure:'10:00'}, {station:'中',arrival:'10:30',departure:'#10:35',note:'境界駅の記事'}]},
  {source:'operation-service', operationServiceDate:'2026-10-20', startDate:'2026/10/20', trainNumber:'試9999', line:'第二線',
    stops:[{station:'中',arrival:'10:30',departure:'#10:35',note:'境界駅の記事'}, {station:'乙',arrival:'11:00'}]},
];

async function checkDtac(file, staff) {
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'',innerHTML:'',addEventListener(type, callback) { this[type] = callback; }});
    return nodes.get(id);
  };
  let fetches = 0, rows = [], alerts = 0;
  const context = vm.createContext({
    URLSearchParams, location:{search:'?id=10%2F20_%E8%A9%A69999&date=2026-10-20'},
    document:{addEventListener() {},getElementById:getNode},
    sessionStorage:{getItem:() => JSON.stringify(segments)},
    TayunetDocumentAPI:{apiBase:'https://example.invalid',fileBase:'https://example.invalid'},
    TayunetPrivateData:{async fetchTimetables(options) { assert.equal(options.selectionList, 1); fetches++; return rows; }},
    alert() { alerts++; }, history:{replaceState() {}},
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, {filename:file});
  for (const prefix of ['', '#', '$', '¥', '￥']) {
    assert.deepEqual(JSON.parse(JSON.stringify(context.rawTime(prefix+'25:01:15'))), {h:25,m:1,s:15});
    const markup = staff ? context.timeCell(prefix+'10:05:15', false, false) : context.timeMarkup(prefix+'10:05:15', false);
    assert.doesNotMatch(markup, /NaN|undefined/);
    assert.match(markup, /05/);
    if (prefix) assert.match(markup, /operation-symbol/);
    else assert.doesNotMatch(markup, /operation-symbol/, 'ordinary times retain their existing markup');
  }
  for (const value of ['', '||', '↓', '…', '=', '<img>', 'bad:time']) assert.equal(context.rawTime(value), null);
  assert.match(staff ? context.timeCell('||') : context.timeMarkup('||'), /↓/);
  assert.match(staff ? context.timeCell('=') : context.timeMarkup('='), /endmark|end-mark/);
  assert.equal(context.manualDateMatches(segments[0], '2026/10/20'), true);
  assert.equal(context.manualDateMatches(segments[0], '2026-10-21'), false);
  assert.equal(context.manualDateMatches({startDate:'2026/03/14'}, '2026-10-21'), true, 'do not restrict date overrides on legacy source schedules');
  assert.equal(context.findTrain(segments).length, 2);
  const merged = context.mergeTrainSegments(segments);
  assert.deepEqual(Array.from(merged.stops, stop => stop.station), ['甲','中','乙']);
  assert.equal(merged.stops[1].departure, '#10:35');
  assert.equal(merged.stops[1].note, '境界駅の記事');
  assert.equal(segments[0].stops.length, 2, 'segment merge must not mutate the input');

  // A transferred authored snapshot must be revalidated against the published feed.
  // An empty feed represents withdrawal and must not display the stale cached copy.
  if (!staff) vm.runInContext('fitDevice=setupClock=setupControls=setupMarkerMenu=()=>{};', context);
  await (staff ? context.loadStaff() : context.init());
  assert.equal(fetches, 1);
  assert.match(getNode(staff ? 'render-target' : 'timetable-body').innerHTML, /該当する列車がありません/);

  if (staff) {
    vm.runInContext('renderedTrain = '+JSON.stringify(segments[0])+';', context);
    context.setupDateControl('2026/10/20');
    getNode('execution-date').value = '2026-10-21';
    getNode('apply-date').click();
    assert.equal(alerts, 1);
    assert.equal(getNode('execution-date').value, '2026-10-20');
    assert.equal(vm.runInContext('specifiedDate', context), '2026-10-20');
  } else {
    const markup = context.rowHtml({...segments[0].stops[1],note:'<script>駅記事</script>'},1,merged.stops);
    assert.match(markup, /&lt;script&gt;駅記事/);
    assert.doesNotMatch(markup, /<script>/);
  }
}

(async () => {
  await checkDtac('JREgyoumu/D-TAC/train_timetable.js', false);
  await checkDtac('JREgyoumu/D-TAC/train_staff.js', true);
  const extract = (file, start, end) => {
    const text = fs.readFileSync(file, 'utf8');
    const first = text.indexOf(start), last = text.indexOf(end, first);
    assert.ok(first >= 0 && last > first, file);
    return text.slice(first, last);
  };
  const station = vm.createContext({safeVal:value => String(value ?? '').trim()});
  vm.runInContext(extract('T-time/ekibetuatos.html', 'function parseTimeValue(', 'function populateLines('), station);
  for (const prefix of ['', '#', '$', '¥', '￥']) {
    assert.equal(station.parseTimeValue(prefix+'10:35:15'), 38115);
    assert.equal(station.formatDisplayTime(prefix+'10:35:15'), prefix+'10:35:15');
  }
  assert.equal(station.formatDisplayTime('='), '=');
  assert.equal(station.formatDisplayTime(''), '…');
  const atos = vm.createContext({});
  vm.runInContext(extract('JREgyoumu/ATOSsys/train_timetable.html', 'const formatTime =', 'const pairedStopTimes =')+'globalThis.format = formatTime;', atos);
  for (const prefix of ['', '#', '$', '¥', '￥']) {
    assert.equal(atos.format(prefix+'10:35:00'), prefix+'10:35');
    assert.equal(atos.format(prefix+'10:35:15'), prefix+'10:35 15');
  }
  assert.equal(atos.format('||'), '||');
  assert.equal(atos.format(''), '…');
  const gd = vm.createContext({});
  vm.runInContext(extract('JREgyoumu/ATOSsys/GD/diagram.html', 'function timeValue(', 'function requestedTime('), gd);
  assert.equal(gd.timeValue('#01:30'), gd.timeValue('01:30'));
  assert.equal(gd.timeValue('01:30'), 1530, 'preserve the existing overnight diagram boundary');
  assert.equal(gd.timeValue('$01:30'), null, 'do not turn suspended times into ordinary running paths');
  const webatos = vm.createContext({});
  vm.runInContext(extract('webatos-system/app.js', 'function timeMinutes(', 'function operationLink('), webatos);
  assert.equal(webatos.timeMinutes('#10:35'), 635);
  assert.equal(webatos.predictedTime('#10:35', 2), '10:37:00');
  assert.equal(webatos.predictedTime('$10:35', 2), '', 'do not predict departures for suspended times');
  console.log('authored timetable consumer compatibility: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
