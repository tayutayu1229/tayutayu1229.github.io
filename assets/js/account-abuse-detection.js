(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TayunetAccountAbuse = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DAY = 86400000;
  const toMillis = value => {
    if (!value) return 0;
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? millis : 0;
  };
  const accountKey = record => record.uid || record.id || record.email || '';
  const accountLabel = record => record.email || record.uid || record.id || '不明';

  function analyze({ users = [], logins = [], sessions = [], now = Date.now() } = {}) {
    const deviceAccounts = new Map();
    const accountDevices = new Map();
    const userById = new Map(users.map(user => [accountKey(user), user]));

    function observe(record, deviceId, source, timestamp, active = false) {
      const uid = accountKey(record);
      if (!uid || !deviceId) return;
      const device = String(deviceId).slice(0, 120);
      const at = toMillis(timestamp);
      if (!deviceAccounts.has(device)) deviceAccounts.set(device, new Map());
      const byAccount = deviceAccounts.get(device);
      const existingAccount = byAccount.get(uid) || { uid, email: accountLabel(record), sources: new Set(), firstSeen: at || now, lastSeen: 0, active: false };
      existingAccount.sources.add(source);
      if (at) existingAccount.firstSeen = Math.min(existingAccount.firstSeen || at, at);
      existingAccount.lastSeen = Math.max(existingAccount.lastSeen, at);
      existingAccount.active ||= active;
      byAccount.set(uid, existingAccount);

      if (!accountDevices.has(uid)) accountDevices.set(uid, new Map());
      const byDevice = accountDevices.get(uid);
      const existingDevice = byDevice.get(device) || { deviceId: device, sources: new Set(), firstSeen: at || now, lastSeen: 0, active: false };
      existingDevice.sources.add(source);
      if (at) existingDevice.firstSeen = Math.min(existingDevice.firstSeen || at, at);
      existingDevice.lastSeen = Math.max(existingDevice.lastSeen, at);
      existingDevice.active ||= active;
      byDevice.set(device, existingDevice);
    }

    users.forEach(user => observe(user, user.registrationDeviceId, '登録', user.registeredAt));
    logins.forEach(login => observe(login, login.deviceId, 'ログイン', login.createdAt || login.clientTime));
    sessions.forEach(session => {
      const lastSeen = toMillis(session.lastSeenAt);
      const active = !session.revoked && session.active !== false && lastSeen > now - 5 * 60000;
      observe(session, session.deviceId, 'セッション', session.lastSeenAt || session.startedAt, active);
    });

    const multipleAccounts = [];
    for (const [deviceId, accountsMap] of deviceAccounts) {
      const accounts = [...accountsMap.values()];
      if (accounts.length < 2) continue;
      const registrationCount = accounts.filter(account => account.sources.has('登録')).length;
      const activeCount = accounts.filter(account => account.active).length;
      const score = Math.min(100, 65 + Math.min(20, (accounts.length - 2) * 10) + (registrationCount >= 2 ? 15 : 0) + (activeCount >= 2 ? 10 : 0));
      multipleAccounts.push({
        type: 'multiple_accounts', deviceId, score,
        severity: score >= 80 ? 'high' : 'medium',
        accounts: accounts.sort((a, b) => b.lastSeen - a.lastSeen),
        registrationCount, activeCount,
        lastSeen: Math.max(...accounts.map(account => account.lastSeen || 0))
      });
    }

    const sharedAccounts = [];
    for (const [uid, devicesMap] of accountDevices) {
      const devices = [...devicesMap.values()];
      if (devices.length < 2) continue;
      const recent30 = devices.filter(device => device.lastSeen > now - 30 * DAY);
      const recent24 = devices.filter(device => device.lastSeen > now - DAY);
      const active = devices.filter(device => device.active);
      let score = 20;
      if (recent30.length >= 3) score += 25;
      if (recent24.length >= 3) score += 30;
      if (active.length >= 2) score += 50;
      score = Math.min(100, score);
      const user = userById.get(uid) || logins.find(item => accountKey(item) === uid) || sessions.find(item => accountKey(item) === uid) || { uid };
      const reasons = [];
      if (active.length >= 2) reasons.push(`同時に${active.length}端末が稼働`);
      if (recent24.length >= 3) reasons.push(`24時間で${recent24.length}端末を使用`);
      else if (recent30.length >= 3) reasons.push(`30日間で${recent30.length}端末を使用`);
      if (!reasons.length) reasons.push('複数端末から利用');
      sharedAccounts.push({
        type: 'shared_account', uid, email: accountLabel(user), score,
        severity: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
        devices: devices.sort((a, b) => b.lastSeen - a.lastSeen),
        activeCount: active.length, recent24Count: recent24.length, recent30Count: recent30.length,
        reasons, lastSeen: Math.max(...devices.map(device => device.lastSeen || 0))
      });
    }

    multipleAccounts.sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen);
    sharedAccounts.sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen);
    return {
      multipleAccounts,
      sharedAccounts,
      highRiskCount: multipleAccounts.filter(item => item.severity === 'high').length + sharedAccounts.filter(item => item.severity === 'high').length,
      observedDeviceCount: deviceAccounts.size,
      legacyRecordCount: users.filter(user => !user.registrationDeviceId).length + logins.filter(login => !login.deviceId).length + sessions.filter(session => !session.deviceId).length
    };
  }

  return { analyze, toMillis };
});
