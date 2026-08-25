const test = require('node:test');
const assert = require('node:assert/strict');

const { analyze } = require('../assets/js/account-abuse-detection.js');

const NOW = Date.parse('2026-08-25T12:00:00+09:00');

test('同じ端末で複数アカウントを登録した候補を検出する', () => {
  const result = analyze({
    now: NOW,
    users: [
      { id: 'u1', email: 'one@example.com', registrationDeviceId: 'device-shared-0001', registeredAt: '2026-08-24T10:00:00+09:00' },
      { id: 'u2', email: 'two@example.com', registrationDeviceId: 'device-shared-0001', registeredAt: '2026-08-25T10:00:00+09:00' }
    ]
  });

  assert.equal(result.multipleAccounts.length, 1);
  assert.equal(result.multipleAccounts[0].registrationCount, 2);
  assert.equal(result.multipleAccounts[0].severity, 'high');
});

test('複数端末が同時稼働する1アカウントを高リスク候補にする', () => {
  const result = analyze({
    now: NOW,
    sessions: [
      { uid: 'u1', email: 'one@example.com', deviceId: 'device-a-00000001', lastSeenAt: new Date(NOW - 60000).toISOString(), active: true },
      { uid: 'u1', email: 'one@example.com', deviceId: 'device-b-00000002', lastSeenAt: new Date(NOW - 120000).toISOString(), active: true }
    ]
  });

  assert.equal(result.sharedAccounts.length, 1);
  assert.equal(result.sharedAccounts[0].activeCount, 2);
  assert.equal(result.sharedAccounts[0].severity, 'high');
});

test('端末IDがない旧記録は誤検知せず対象外件数へ含める', () => {
  const result = analyze({
    now: NOW,
    users: [{ id: 'u1', email: 'one@example.com' }],
    logins: [{ uid: 'u1', email: 'one@example.com' }],
    sessions: [{ uid: 'u1', email: 'one@example.com' }]
  });

  assert.equal(result.multipleAccounts.length, 0);
  assert.equal(result.sharedAccounts.length, 0);
  assert.equal(result.legacyRecordCount, 3);
});
