const assert = require('node:assert/strict');
const test = require('node:test');
const lines = require('../assets/js/timetable-lines.js');

for (const file of ['T-time/mobileatos.html', 'T-time/webatos.html', 'atosweb.html']) {
  const source = require('node:fs').readFileSync(file, 'utf8');
  assert.match(source, /timetable-lines\.js\?v=20260925-2/, `${file} must cache-bust the shared line resolver`);
}

const resolver = lines.create({version: 1, displayOrder: ['武蔵野', '京葉', '中央'], lines: [
  {canonical: '横須賀・総武快速', aliases: ['横須賀線', '総武快速線'], odpt: [
    'odpt.Railway:JR-East.Yokosuka', 'odpt.Railway:JR-East.SobuRapid'
  ]},
  {canonical: '中央', aliases: ['中央線', '中央本線'], odpt: ['odpt.Railway:JR-East.Chuo']},
  {canonical: '京葉', aliases: ['京葉線'], odpt: ['odpt.Railway:JR-East.Keiyo'], related: ['武蔵野']},
  {canonical: '武蔵野', aliases: ['武蔵野線'], odpt: ['odpt.Railway:JR-East.Musashino'], related: ['京葉']}
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

test('related lines expand search without collapsing their displayed names', () => {
  assert.equal(resolver.canonical('武蔵野線'), '武蔵野');
  assert.equal(resolver.matches('京葉', '武蔵野'), false);
  assert.equal(resolver.matchesForSearch('武蔵野', '京葉'), true);
  assert.deepEqual(resolver.searchCanonicals('京葉'), ['京葉', '武蔵野']);
  assert.deepEqual(resolver.odptIds('京葉'), [
    'odpt.Railway:JR-East.Keiyo', 'odpt.Railway:JR-East.Musashino'
  ]);
});

test('line choices follow configured order and keep additional timetable labels', () => {
  assert.deepEqual(resolver.canonicalOptions([
    {line: '横須賀線'}, {line: '中央'}, {line: '独自線区'}
  ]), ['武蔵野', '京葉', '中央', '横須賀・総武快速', '独自線区']);
});

test('unknown names remain usable when the private mapping is unavailable', () => {
  assert.equal(resolver.canonical('独自線区'), '独自線区');
  assert.deepEqual(lines.create().canonicalOptions([{line: '独自線区'}]), ['独自線区']);
});
