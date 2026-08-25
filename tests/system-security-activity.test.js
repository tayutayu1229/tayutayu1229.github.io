const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('管理画面に操作・IP履歴の絞り込みと出力を備える', () => {
  const html = fs.readFileSync(path.join(root, 'system_security.html'), 'utf8');
  for (const id of ['tab-activity', 'activity-user', 'activity-type', 'activity-period', 'activity-search', 'export-activity', 'activity-body']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /同じIPの複数アカウント/);
  assert.match(html, /短期間のIP変化/);
});

test('IP以外の端末確認と信頼済み管理を備える', () => {
  const html = fs.readFileSync(path.join(root, 'system_security.html'), 'utf8');
  for (const id of ['tab-devices', 'device-user', 'device-status', 'device-search', 'device-body', 'shared-environment-body', 'environment-change-body']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /信頼済みにする/);
  assert.match(html, /security_trusted_devices/);
});

test('怪しい利用者だけを対象にしたおまかせ保護を備える', () => {
  const html = fs.readFileSync(path.join(root, 'system_security.html'), 'utf8');
  const guard = fs.readFileSync(path.join(root, 'auth_guard.js'), 'utf8');
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  for (const id of ['automatic-protection-summary', 'automatic-protection-body']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /おまかせ保護を有効化/);
  assert.match(html, /securityProtection:'automatic'/);
  assert.match(guard, /enforceAutomaticProtection/);
  assert.match(guard, /profile\.isAdmin === true/);
  assert.match(guard, /showProtectedDeviceScreen/);
  assert.match(rules, /match \/security_device_requests/);
});

test('保護対象の利用者は自分以外の端末記録を一覧取得できない', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/security_trusted_devices[\s\S]*allow list: if isAdministrator\(\)/);
  assert.match(rules, /match \/security_device_requests[\s\S]*allow list: if isAdministrator\(\)/);
});

test('操作記録は入力欄の値を送信しない', () => {
  const telemetry = fs.readFileSync(path.join(root, 'assets/js/system-telemetry.js'), 'utf8');
  assert.match(telemetry, /attachInteractionCapture/);
  assert.match(telemetry, /form_submit/);
  assert.doesNotMatch(telemetry, /password.*\.value|FormData\(/i);
});

test('登録・ログイン画面にIP記録の案内がある', () => {
  for (const file of ['index.html', 'register.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /IPアドレス/);
    assert.match(html, /パスワードは履歴へ保存しません/);
  }
});
