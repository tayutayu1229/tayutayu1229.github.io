'use strict';

const assert = require('node:assert/strict');
const versions = require('../assets/js/timetable-version.js');
const operations = require('../assets/js/timetable-operations.js');

const rows = [
  {startDate:'2026/03/16', dayType:'平日', marker:'base-weekday'},
  {startDate:'2026/03/24', dayType:'土休日', marker:'base-holiday'},
  {startDate:'2026/04/07', dayType:'', marker:'dated-change'},
  {startDate:'2026/05/01', dayType:'平日', marker:'future'}
];
assert.equal(versions.selectForDate(rows, '2026-04-07', '平日').marker, 'dated-change');
assert.equal(versions.selectForDate(rows, '2026-04-30', '平日').marker, 'dated-change');
assert.equal(versions.selectForDate(rows, '2026-03-20', '平日').marker, 'base-weekday');
assert.equal(versions.selectForDate(rows, '2026-03-15', '平日'), null);
assert.equal(versions.selectForDate([
  {startDate:'2026/04/07', dayType:'', marker:'generic'},
  {startDate:'2026/04/07', dayType:'平日', marker:'weekday'}
], '2026-04-08', '平日').marker, 'weekday', '同じ施行日なら曜日専用版を優先すること');

const train = {tt1:'k', tr1:'100M', kid1:'A', tt2:'o', tr2:'200M', kid2:'B', stops:[
  {station:'甲'},
  {station:'乙', operationInfo:'分割', operationTrainNumber:'101M', operationKid:'C'},
  {station:'丙'}
]};
assert.deepEqual(operations.forStop(train, train.stops[0], 0), {type:'継走', trainNumber:'100M', kid:'A', direction:'prev'});
assert.deepEqual(operations.forStop(train, train.stops[1], 1), {type:'分割', trainNumber:'101M', kid:'C', direction:'either'});
assert.deepEqual(operations.forStop(train, train.stops[2], 2), {type:'折返', trainNumber:'200M', kid:'B', direction:'next'});
for (const value of ['分割','併合','入区','出区','引上','据付','滞泊','車交','特発']) assert.equal(operations.label(value), value);

console.log('timetable version and operation tests: ok');
