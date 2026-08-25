const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('system_diagnostics.html', 'utf8');

assert.match(html, /data-diagnostic-action="show-error-detail"/);
assert.match(html, /data-event-id="\$\{Ops\.escapeHtml\(e\.id\)\}"/);
assert.match(html, /data-diagnostic-action="delete-cache-entry"/);
assert.match(html, /data-cache-hash="\$\{Ops\.hash\(url\)\}"/);
assert.match(html, /data-diagnostic-action="close-error-modal"/);
assert.match(html, /closest\('\[data-diagnostic-action\]'\)/);
assert.match(html, /写真詳細を閉じた後の遅延描画を無効化済み/);
assert.doesNotMatch(html, /onclick="showErrorDetail\(/);
assert.doesNotMatch(html, /onclick="deleteCacheEntry\(/);

console.log('system diagnostics controls audit: ok');
