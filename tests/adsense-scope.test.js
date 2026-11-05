const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const prohibited = /adsbygoogle|googlesyndication|ca-pub-2192861187044284|google-adsense-account/i;
function inspect(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (['.git','node_modules','tests','vendor'].includes(entry.name)) continue;
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) inspect(file);
    else if(/\.(html|js|py|css)$/.test(entry.name)) {
      assert(!prohibited.test(fs.readFileSync(file,'utf8')), `広告コードが残っています: ${path.relative(root,file)}`);
    }
  }
}
inspect(root);
assert(!fs.existsSync(path.join(root,'ads.txt')), '広告販売者ファイルが残っています');
console.log('広告配信コードなし。生成処理からの再混入も確認しました。');
