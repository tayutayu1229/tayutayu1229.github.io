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

  function analyze({ users = [], logins = [], sessions = [], events = [], now = Date.now() } = {}) {
    const deviceAccounts = new Map();
    const accountDevices = new Map();
    const ipAccounts = new Map();
    const accountIps = new Map();
    const environmentAccounts = new Map();
    const accountEnvironments = new Map();
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
      const existingDevice = byDevice.get(device) || { deviceId: device, sources: new Set(), firstSeen: at || now, lastSeen: 0, active: false, registrationDevice: false };
      existingDevice.sources.add(source);
      if (at) existingDevice.firstSeen = Math.min(existingDevice.firstSeen || at, at);
      existingDevice.lastSeen = Math.max(existingDevice.lastSeen, at);
      existingDevice.active ||= active;
      existingDevice.registrationDevice ||= source === '登録';
      existingDevice.environmentSignature = record.environmentSignature || record.registrationEnvironmentSignature || existingDevice.environmentSignature || '';
      existingDevice.userAgent = record.userAgent || record.registrationUserAgent || existingDevice.userAgent || '';
      existingDevice.platform = record.platform || record.registrationPlatform || existingDevice.platform || '';
      existingDevice.language = record.language || record.registrationLanguage || existingDevice.language || '';
      existingDevice.screen = record.screen || record.registrationScreen || existingDevice.screen || '';
      existingDevice.timezone = record.timezone || record.registrationTimezone || existingDevice.timezone || '';
      byDevice.set(device, existingDevice);
    }

    function observeEnvironment(record, signature, source, timestamp) {
      const uid = accountKey(record);
      if (!uid || !signature) return;
      const key = String(signature).slice(0, 120);
      const at = toMillis(timestamp);
      if (!environmentAccounts.has(key)) environmentAccounts.set(key, new Map());
      const byAccount = environmentAccounts.get(key);
      const account = byAccount.get(uid) || { uid, email: accountLabel(record), sources: new Set(), firstSeen: at || now, lastSeen: 0 };
      account.sources.add(source);
      if (at) account.firstSeen = Math.min(account.firstSeen || at, at);
      account.lastSeen = Math.max(account.lastSeen, at);
      byAccount.set(uid, account);
      if (!accountEnvironments.has(uid)) accountEnvironments.set(uid, new Map());
      const byEnvironment = accountEnvironments.get(uid);
      const environment = byEnvironment.get(key) || { signature: key, sources: new Set(), firstSeen: at || now, lastSeen: 0 };
      environment.sources.add(source);
      if (at) environment.firstSeen = Math.min(environment.firstSeen || at, at);
      environment.lastSeen = Math.max(environment.lastSeen, at);
      byEnvironment.set(key, environment);
    }

    function observeIp(record, ipAddress, source, timestamp) {
      const uid = accountKey(record);
      if (!uid || !ipAddress) return;
      const ip = String(ipAddress).slice(0, 64);
      const at = toMillis(timestamp);
      if (!ipAccounts.has(ip)) ipAccounts.set(ip, new Map());
      const byAccount = ipAccounts.get(ip);
      const account = byAccount.get(uid) || { uid, email: accountLabel(record), sources: new Set(), firstSeen: at || now, lastSeen: 0 };
      account.sources.add(source);
      if (at) account.firstSeen = Math.min(account.firstSeen || at, at);
      account.lastSeen = Math.max(account.lastSeen, at);
      byAccount.set(uid, account);
      if (!accountIps.has(uid)) accountIps.set(uid, new Map());
      const byIp = accountIps.get(uid);
      const entry = byIp.get(ip) || { ipAddress: ip, sources: new Set(), firstSeen: at || now, lastSeen: 0 };
      entry.sources.add(source);
      if (at) entry.firstSeen = Math.min(entry.firstSeen || at, at);
      entry.lastSeen = Math.max(entry.lastSeen, at);
      byIp.set(ip, entry);
    }

    users.forEach(user => { observe(user, user.registrationDeviceId, '登録', user.registeredAt); observeIp(user, user.registrationIpAddress, '登録', user.registeredAt); observeEnvironment(user, user.registrationEnvironmentSignature, '登録', user.registeredAt); });
    logins.forEach(login => { observe(login, login.deviceId, 'ログイン', login.createdAt || login.clientTime); observeIp(login, login.ipAddress, 'ログイン', login.createdAt || login.clientTime); observeEnvironment(login, login.environmentSignature, 'ログイン', login.createdAt || login.clientTime); });
    sessions.forEach(session => {
      const lastSeen = toMillis(session.lastSeenAt);
      const active = !session.revoked && session.active !== false && lastSeen > now - 5 * 60000;
      observe(session, session.deviceId, 'セッション', session.lastSeenAt || session.startedAt, active);
      observeIp(session, session.ipAddress, 'セッション', session.lastSeenAt || session.startedAt);
      observeEnvironment(session, session.environmentSignature, 'セッション', session.lastSeenAt || session.startedAt);
    });
    events.forEach(item => { observe(item, item.deviceId, '操作', item.createdAt || item.clientTime); observeIp(item, item.ipAddress, '操作', item.createdAt || item.clientTime); observeEnvironment(item, item.environmentSignature, '操作', item.createdAt || item.clientTime); });

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
    const sharedIps = [...ipAccounts.entries()].filter(([, accounts]) => accounts.size >= 2).map(([ipAddress, accounts]) => ({
      ipAddress,
      accounts: [...accounts.values()].sort((a, b) => b.lastSeen - a.lastSeen),
      accountCount: accounts.size,
      lastSeen: Math.max(...[...accounts.values()].map(account => account.lastSeen || 0))
    })).sort((a, b) => b.accountCount - a.accountCount || b.lastSeen - a.lastSeen);
    const accountIpRisks = [...accountIps.entries()].filter(([, ips]) => ips.size >= 2).map(([uid, ips]) => {
      const values = [...ips.values()];
      const recent24Count = values.filter(item => item.lastSeen > now - DAY).length;
      const recent30Count = values.filter(item => item.lastSeen > now - 30 * DAY).length;
      const user = userById.get(uid) || logins.find(item => accountKey(item) === uid) || sessions.find(item => accountKey(item) === uid) || { uid };
      const score = Math.min(100, 15 + (recent24Count >= 3 ? 50 : 0) + (recent30Count >= 5 ? 35 : 0));
      return { uid, email: accountLabel(user), ips: values.sort((a, b) => b.lastSeen - a.lastSeen), recent24Count, recent30Count, score, severity: score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low', lastSeen: Math.max(...values.map(item => item.lastSeen || 0)) };
    }).sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen);
    const deviceProfiles = [...accountDevices.entries()].flatMap(([uid, devices]) => {
      const user = userById.get(uid) || logins.find(item => accountKey(item) === uid) || sessions.find(item => accountKey(item) === uid) || { uid };
      return [...devices.values()].map(device => ({ ...device, uid, email: accountLabel(user), sources: [...device.sources] }));
    }).sort((a, b) => b.lastSeen - a.lastSeen);
    const sharedEnvironments = [...environmentAccounts.entries()].filter(([, accounts]) => accounts.size >= 2).map(([signature, accounts]) => ({
      signature,
      accounts: [...accounts.values()].sort((a, b) => b.lastSeen - a.lastSeen),
      accountCount: accounts.size,
      lastSeen: Math.max(...[...accounts.values()].map(account => account.lastSeen || 0))
    })).sort((a, b) => b.accountCount - a.accountCount || b.lastSeen - a.lastSeen);
    const accountEnvironmentChanges = [...accountEnvironments.entries()].filter(([, environments]) => environments.size >= 2).map(([uid, environments]) => {
      const user = userById.get(uid) || logins.find(item => accountKey(item) === uid) || sessions.find(item => accountKey(item) === uid) || { uid };
      const values = [...environments.values()];
      return { uid, email: accountLabel(user), environments: values.sort((a, b) => b.lastSeen - a.lastSeen), recent30Count: values.filter(item => item.lastSeen > now - 30 * DAY).length, lastSeen: Math.max(...values.map(item => item.lastSeen || 0)) };
    }).sort((a, b) => b.recent30Count - a.recent30Count || b.lastSeen - a.lastSeen);
    return {
      multipleAccounts,
      sharedAccounts,
      sharedIps,
      accountIpRisks,
      deviceProfiles,
      sharedEnvironments,
      accountEnvironmentChanges,
      highRiskCount: multipleAccounts.filter(item => item.severity === 'high').length + sharedAccounts.filter(item => item.severity === 'high').length,
      observedDeviceCount: deviceAccounts.size,
      observedIpCount: ipAccounts.size,
      legacyRecordCount: users.filter(user => !user.registrationDeviceId).length + logins.filter(login => !login.deviceId).length + sessions.filter(session => !session.deviceId).length
    };
  }

  return { analyze, toMillis };
});
