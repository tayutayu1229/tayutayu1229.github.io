const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({URLSearchParams,URL,Intl,location:{search:''},TayunetDocumentAPI:{apiBase:'',fileBase:''},document:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null;}}});
vm.runInContext(fs.readFileSync(__dirname+'/../JREgyoumu/D-TAC/dtac-features.js','utf8')+'\n'+fs.readFileSync(__dirname+'/../JREgyoumu/D-TAC/train_timetable.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
test('midnight runtime and three digit overflow follow TRViS',()=>{
 assert.match(run("formatDuration(seconds('23:59:30'),seconds('00:01:00'))"),/>1<.*>30</);
 assert.match(run("formatDuration(0,6000)"),/>\*\*</);
});
test('time rendering keeps brackets, symbols, small seconds and next day hours',()=>{
 const html=run("timeMarkup('(25:23:45)',false)");
 assert.match(html,/^\(/); assert.match(html,/1\./); assert.match(html,/45/); assert.match(html,/\)$/);
 assert.equal(run("rawTime('12:70')"),null);
 assert.equal(run("rawTime('12:30:65')"),null);
 assert.match(run("timeMarkup('↓',true)"),/pass-arrow/);
 assert.match(run("timeMarkup('=',false)"),/end-mark/);
 assert.match(run("timeMarkup('#12:30',false)"),/operation-symbol/);
});
test('marker text uses four halfwidth / two fullwidth characters',()=>{
 assert.equal(run("limitMarkerText('AB123')"),'AB12');
 assert.equal(run("limitMarkerText('徐行確認')"),'徐行');
 assert.equal(run("limitMarkerText('A停B車')"),'A停B');
 assert.equal(run("limitMarkerText('ｱｲｳｴｵ')"),'ｱｲｳｴ');
});
test('segments join a shared station without losing the first arrival',()=>{
 const merged=JSON.parse(run(`JSON.stringify(mergeTrainSegments([{line:'A',stops:[{station:'X',departure:'23:50'},{station:'Y',arrival:'23:59'}]},{line:'B',destination:'Z',stops:[{station:'Y',departure:'00:01'},{station:'Z',arrival:'00:10'}]}]))`));
 assert.equal(merged.stops.length,3); assert.equal(merged.stops[1].arrival,'23:59'); assert.equal(merged.stops[1].departure,'00:01'); assert.equal(merged.destination,'Z');
});
test('explicit stopping flags override inferred passing state',()=>{
 assert.equal(run("isPassing({arrival:'',departure:'12:00',isPass:false},1,3)"),false);
 assert.equal(run("isPassing({arrival:'↓',departure:'12:00'},1,3)"),true);
});
test('station labels and arbitrary timetable text remain escaped',()=>{
 assert.ok(!run("stationMarkup('<img>')").includes('<img>'));
 assert.equal(run("timeMarkup('<img>',false)"),'&lt;img&gt;');
});
test('coordinate validation rejects missing and out of range positions',()=>{
 assert.equal(run("coordinates({latitude:'',longitude:''})"),null);
 assert.equal(run("coordinates({latitude:91,longitude:139})"),null);
 assert.equal(run("coordinates({lat:35,lon:139}).longitude"),139);
});
test('marker storage separates service dates and train numbers',()=>{
 run("train={trainNumber:'123M',startDate:'2026/11/04'}"); const first=run('markerStorageKey()');
 run("train={trainNumber:'123M',startDate:'2026/11/05'}"); assert.notEqual(run('markerStorageKey()'),first);
});
