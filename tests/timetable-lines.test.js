const assert = require('node:assert/strict');
const test = require('node:test');
const lines = require('../assets/js/timetable-lines.js');

const resolver = lines.create({version: 1, lines: [
  {canonical: '横須賀・総武快速', aliases: ['横須賀線', '総武快速線'], odpt: [
    'odpt.Railway:JR-East.Yokosuka', 'odpt.Railway:JR-East.SobuRapid'
  ]},
  {canonical: '中央', aliases: ['中央線', '中央本線'], odpt: ['odpt.Railway:JR-East.Chuo']}
]});

test('aliases and ODPT identifiers resolve to timetable JSON names', () => {
  assert.equal(resolver.canonical('横須賀線'), '横須賀・総武快速');
  assert.equal(resolver.canonical('odpt.Railway:JR-East.SobuRapid'), '横須賀・総武快速');
  assert.equal(resolver.canonical(' 中央本線 '), '中央');
});

test('one timetable line can search multiple ODPT railways', () => {
  assert.deepEqual(resolver.odptIds('総武快速線'), [
    'odpt.Railway:JR-East.Yokosuka', 'odpt.Railway:JR-East.SobuRapid'
  ]);
  assert.equal(resolver.matches('横須賀線', '横須賀・総武快速'), true);
});

test('line choices come only from timetable records and use canonical labels', () => {
  assert.deepEqual(resolver.canonicalOptions([
    {line: '横須賀線'}, {line: '中央'}, {line: '中央本線'}
  ]), ['横須賀・総武快速', '中央'].sort((a, b) => a.localeCompare(b, 'ja')));
});

test('unknown names remain usable when the private mapping is unavailable', () => {
  assert.equal(resolver.canonical('独自線区'), '独自線区');
  assert.deepEqual(lines.create().canonicalOptions([{line: '独自線区'}]), ['独自線区']);
});
