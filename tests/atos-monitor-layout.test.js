const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['T-time/mobileatos.html', 'T-time/webatos.html', 'T-time/ekibetuatos.html']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /#appContainer\s*\{[^}]*width:\s*max\(80vw, min\(940px, calc\(100vw - 32px\)\)\);/s, `${file} はPCで余白を保ちiPad横では表幅を確保すること`);
  assert.match(source, /@media \(orientation: portrait\), \(max-width: 700px\)[\s\S]*?#appContainer\s*\{[^}]*width:\s*100%;/s, `${file} は縦画面で余白をなくすこと`);
  assert.match(source, /table\s*\{[^}]*min-width:\s*940px;/s, `${file} は通常のiPad横で収まり狭い画面では横スクロールさせること`);
}

const station = fs.readFileSync('T-time/ekibetuatos.html', 'utf8');
assert.match(station, /\.modal-body\s*\{[^}]*width:\s*max\(80vw, min\(940px, calc\(100vw - 32px\)\)\);/s, '駅別から開く列車時刻表もiPad横でスクロールなしにすること');
assert.doesNotMatch(station, /@media \(max-width: 1050px\)[\s\S]*?font-size:\s*(?:13|14)px;/, '横幅に応じて表の文字を縮小しないこと');

console.log('ATOS monitor responsive layout: ok');
