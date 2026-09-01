const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const alias = fs.readFileSync('ATOSlocation.html', 'utf8');
const top = fs.readFileSync('toppage.html', 'utf8');
const redirectScript = alias.match(/<script>([\s\S]*?)<\/script>/)?.[1];

assert.match(alias, /query\.set\(['"]view['"], ['"]realtime['"]\)/,
  'legacy ATOS URL must select the realtime monitor');
assert.match(alias, /location\.replace\(target\)/,
  'legacy ATOS URL must replace itself with the unified monitor');
assert.match(alias, /\['line', 'direction', 'station', 'train', 'calendar'\]/,
  'shared realtime monitor state must be preserved');
assert.match(top, /data-name="ATOS在線モニタ"[^>]+atosweb\.html\?view=realtime#view=realtime/,
  'the top-page ATOS monitor tile must open the unified realtime monitor directly');

let redirectedTo = '';
const location = {
  search: '?direction=up',
  hash: '#line=odpt.Railway%3AJR-East.Yamanote&view=grasp',
  replace(target) { redirectedTo = target; },
};
vm.runInNewContext(redirectScript, {location, URLSearchParams});
assert.equal(
  redirectedTo,
  'atosweb.html?direction=up&line=odpt.Railway%3AJR-East.Yamanote&view=realtime#view=realtime',
  'legacy query/hash state must redirect to the unified realtime monitor',
);

console.log('ATOS location alias tests: ok');
