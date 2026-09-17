const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const loader = '/assets/js/back-navigation.js';

function htmlFiles(directory, base = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const relative = path.join(base, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(absolute, relative);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.html') ? [relative] : [];
  });
}

const files = htmlFiles(root).filter((file) => /<(?:html|body)\b/i.test(fs.readFileSync(path.join(root, file), 'utf8')));
for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert(html.includes(loader), `${file} に共通の戻る導線が読み込まれていません`);
  assert.strictEqual((html.match(/\/assets\/js\/back-navigation\.js/g) || []).length, 1, `${file} で戻る導線が重複しています`);
}

const script = fs.readFileSync(path.join(root, 'assets/js/back-navigation.js'), 'utf8');
assert(script.includes("window.history.back()"), '同一サイト内の前画面へ戻る処理がありません');
assert(script.includes("'/toppage.html'"), '直接アクセス時のトップページ退避がありません');
assert(script.includes('hasExistingReturn'), '既存の戻るボタンとの重複防止がありません');
assert(script.includes('@media print'), '印刷時に戻るボタンを隠す指定がありません');

console.log(`back navigation audit: ok (${files.length} pages)`);
