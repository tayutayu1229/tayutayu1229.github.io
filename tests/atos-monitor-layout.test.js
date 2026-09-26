const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['T-time/mobileatos.html', 'T-time/webatos.html', 'T-time/ekibetuatos.html']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /#appContainer\s*\{[^}]*width:\s*80vw;/s, `${file} は横画面で左右合計1/5の余白を持つこと`);
  assert.match(source, /@media \(orientation: portrait\), \(max-width: 700px\)[\s\S]*?#appContainer\s*\{[^}]*width:\s*100%;/s, `${file} は縦画面で余白をなくすこと`);
  assert.match(source, /table\s*\{[^}]*min-width:\s*980px;/s, `${file} は狭い画面でも表を縮小せず横スクロールさせること`);
}

const station = fs.readFileSync('T-time/ekibetuatos.html', 'utf8');
assert.match(station, /\.modal-body\s*\{[^}]*width:\s*80vw;/s, '駅別から開く列車時刻表にも横画面の余白を設けること');
assert.doesNotMatch(station, /@media \(max-width: 1050px\)[\s\S]*?font-size:\s*(?:13|14)px;/, '横幅に応じて表の文字を縮小しないこと');

console.log('ATOS monitor responsive layout: ok');
