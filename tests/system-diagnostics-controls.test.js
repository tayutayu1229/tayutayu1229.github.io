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
assert.match(html, /diagnosticFixDeployedAt=Date\.parse\('2026-08-25T03:39:21Z'\)/);
assert.match(html, /写真APIの稼働復旧を確認し、参照処理へ自動再試行を追加済み/);
assert.match(html, /公開画面でデータ取得・自動更新の正常動作を確認済み/);
assert.match(html, /\['console_error','fetch_error'\]\.includes\(e\.type\)/);
assert.match(html, /同時実行中の再起動操作を監視APIが安全に拒否した記録/);
assert.doesNotMatch(html, /onclick="showErrorDetail\(/);
assert.doesNotMatch(html, /onclick="deleteCacheEntry\(/);

console.log('system diagnostics controls audit: ok');
