const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const clientId = 'ca-pub-2192861187044284';
const loader = 'pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const allowedPages = [
  'index.html',
  'toppage.html',
  'JRF_status/index.html',
  'timeedit.html',
  'photo-archive.html',
  'JREgyoumu/TWRsys/index.html',
  'JREgyoumu/METROsys/metro.html',
  'JREgyoumu/tobusys/tobu.html',
  'JREgyoumu/keikyusys/keikyu.html',
  'tobu-zai.html',
  'keisei-zai.html',
  'flight/DAsystem.html',
  'T-time/T-time.html',
  'outside.html',
];

function walkHtml(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const relative = path.join(base, entry.name);
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkHtml(absolute, relative);
    return entry.isFile() && entry.name.endsWith('.html') ? [relative.split(path.sep).join('/')] : [];
  });
}

for (const page of allowedPages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert(html.includes(loader), `${page} にAdSenseローダーがありません`);
  assert(html.includes(clientId), `${page} のAdSenseクライアントIDが違います`);
  assert.strictEqual((html.match(/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/g) || []).length, 1,
    `${page} にAdSenseローダーが重複しています`);
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  assert(head && head[1].includes(loader), `${page} のAdSenseローダーがhead内にありません`);
}

const actualPages = walkHtml(root).filter((page) => {
  return fs.readFileSync(path.join(root, page), 'utf8').includes(loader);
}).sort();
assert.deepStrictEqual(actualPages, [...allowedPages].sort(), 'AdSenseの設置ページが許可リストと一致しません');

for (const generator of ['JRF_status/scraper.py', 'fetch_jr_freight_data.py']) {
  const source = fs.readFileSync(path.join(root, generator), 'utf8');
  assert(source.includes(loader) && source.includes(clientId), `${generator} にAdSense設定がありません`);
}

console.log(`adsense-scope: ${allowedPages.length}ページだけに限定されています`);
