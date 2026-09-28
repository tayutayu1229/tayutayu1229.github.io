const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('JREgyoumu/ATOSsys/select_timetable.html', 'utf8');

assert.match(source, /indexedDB\.open\(CACHE_DATABASE, 1\)/, '列車一覧をタブ内キャッシュへ保存すること');
assert.match(source, /const cached = forceRefresh \? null : await readTimetableCache\(\);[\s\S]*if \(cached\)[\s\S]*return;/, '通常表示はキャッシュがあれば保護APIを再取得しないこと');
assert.ok(
  source.indexOf('const cached = forceRefresh ? null : await readTimetableCache();') < source.indexOf('cachedAllData = await TayunetPrivateData.fetchTimetables();'),
  '保護APIより先にキャッシュを確認すること',
);
assert.match(source, /refreshDataButton\.addEventListener\('click',[\s\S]*?loadTimetables\(true\);[\s\S]*?\}\);/, '利用者が新規登録分を強制更新できること');
assert.match(source, /保留データの表示を維持しました/, '更新失敗時に保留データを消さないこと');
assert.match(source, /window\.addEventListener\('pagehide', saveViewState\)/, '詳細画面へ移る前の表示状態を保存すること');
assert.match(source, /restoreViewState\(\);[\s\S]*applySearchFilter\(\);[\s\S]*restoreScrollPosition\(\)/, '検索条件とスクロール位置を復元すること');
assert.match(source, /else if \(sortDir === 'asc'\)[\s\S]*sortDir = 'desc';[\s\S]*else \{[\s\S]*sortCol = null;[\s\S]*sortDir = 'asc';/, '並び替えを昇順・降順・未指定の3段階で切り替えること');
assert.match(source, /<select id="mobile-sort">[\s\S]*startDate:asc[\s\S]*trainNumber:desc[\s\S]*section:desc/, 'スマホでも各列の並び順を選択できること');
assert.match(source, /mobileSortSelect\.addEventListener\('change',[\s\S]*sortCol, sortDir[\s\S]*applySearchFilter\(\)/, 'スマホの並び順選択を一覧へ反映すること');
assert.match(source, /<input type="date" id="search-date-picker"/, '施行日をカレンダーから選択できること');
assert.match(source, /<input type="search" id="search-date"[\s\S]*YYYY\/MM\/DDを入力/, '施行日を直接入力できること');
assert.match(source, /searchDateInput\.value\.trim\(\)\.toLowerCase\(\)\.replace\(\/-\/g, '\/'\)/, '直接入力したハイフン区切りの日付でも検索できること');
assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*TimetableCache/i, '保護時刻表を永続保存しないこと');

console.log('ATOS timetable selection cache: ok');
