const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('JREgyoumu/ATOSsys/select_timetable.html', 'utf8');

assert.match(source, /indexedDB\.open\(CACHE_DATABASE, 1\)/, '列車一覧をタブ内キャッシュへ保存すること');
assert.match(source, /const cached = await readTimetableCache\(\);[\s\S]*if \(cached\)[\s\S]*return;/, 'キャッシュがあれば保護APIを再取得しないこと');
assert.ok(
  source.indexOf('const cached = await readTimetableCache();') < source.indexOf('cachedAllData = await TayunetPrivateData.fetchTimetables();'),
  '保護APIより先にキャッシュを確認すること',
);
assert.match(source, /window\.addEventListener\('pagehide', saveViewState\)/, '詳細画面へ移る前の表示状態を保存すること');
assert.match(source, /restoreViewState\(\);[\s\S]*applySearchFilter\(\);[\s\S]*restoreScrollPosition\(\)/, '検索条件とスクロール位置を復元すること');
assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*TimetableCache/i, '保護時刻表を永続保存しないこと');

console.log('ATOS timetable selection cache: ok');
