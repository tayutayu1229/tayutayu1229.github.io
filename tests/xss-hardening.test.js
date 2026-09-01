const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/js/site-brand.js', 'utf8');

assert.doesNotMatch(
  source,
  /MutationObserver|installDynamicMarkupGuard|hardenNode/,
  '共通ブランド処理から画面機能を一律削除してはいけません',
);
assert.match(source, /window\.TayunetSecurity\s*=\s*Object\.freeze/);

const window = {};
const context = vm.createContext({
  URL,
  window,
  document: {
    baseURI: 'https://tayunet-traininfo.com/tools/page.html',
    readyState: 'loading',
    addEventListener() {},
  },
});
vm.runInContext(source, context, {filename: 'assets/js/site-brand.js'});

const security = window.TayunetSecurity;
assert.ok(security, '共通の安全化ヘルパーが公開されること');
assert.equal(security.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(security.safeToken('station_01-A'), 'station_01-A');
assert.equal(security.safeToken('" onclick="alert(1)'), '');
assert.equal(security.safeUrl('javascript:alert(1)'), null);
assert.equal(security.safeUrl('data:text/html,<script>alert(1)</script>'), null);
assert.equal(security.safeUrl('/toppage.html'), 'https://tayunet-traininfo.com/toppage.html');
assert.equal(
  security.safeUrl('data:image/png;base64,AA==', {allowDataImage: true}),
  'data:image/png;base64,AA==',
);

console.log('xss hardening regression: ok');
