const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('incident-share/app.js', 'utf8');
const html = fs.readFileSync('incident-share/index.html', 'utf8');

assert.match(script, /function incidentFingerprint\(items\)/, '一覧の変更検知がありません');
assert.match(script, /function scheduleLiveSync\(delay = state\.liveDelay\)/, '自動更新の予約処理がありません');
assert.match(script, /document\.addEventListener\("visibilitychange"/, '画面復帰時の自動更新がありません');
assert.match(script, /state\.liveDelay = result === null \? Math\.min/, '通信失敗時の再接続間隔制御がありません');
assert.match(script, /"リアルタイム接続中"/, 'リアルタイム接続状態が表示されません');
assert.match(html, /app\.js\?v=2026\.09\.25\.1/, 'ブラウザーキャッシュ更新用の版番号が違います');

console.log('incident-share live update tests passed');
