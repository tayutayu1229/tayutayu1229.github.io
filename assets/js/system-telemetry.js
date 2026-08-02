(() => {
  'use strict';

  if (window.TayunetTelemetry) return;
  const STORAGE_PREFIX = 'tayunetOps:';
  const nowIso = () => new Date().toISOString();
  const clampText = (value, max = 1000) => String(value ?? '').slice(0, max);
  const safeJson = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
  };
  const sessionId = (() => {
    let id = sessionStorage.getItem(`${STORAGE_PREFIX}sessionId`);
    if (!id) {
      id = `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('-')}`;
      sessionStorage.setItem(`${STORAGE_PREFIX}sessionId`, id);
    }
    return id;
  })();

  let auth = null;
  let db = null;
  let user = null;
  let profile = null;
  let sessionRef = null;
  let heartbeatTimer = null;
  let unsubscribeSession = null;
  let originalFetch = null;

  function appendLocal(key, item, limit = 200) {
    try {
      const values = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${key}`) || '[]');
      values.push(item);
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(values.slice(-limit)));
    } catch (_) {}
  }

  function localValues(key) {
    try { return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${key}`) || '[]'); } catch (_) { return []; }
  }

  async function addDocument(collection, payload) {
    const localPayload = { ...payload, clientTime: payload.clientTime || nowIso() };
    if (!db || !user) {
      appendLocal(collection, localPayload);
      return null;
    }
    try {
      return await db.collection(collection).add({
        ...payload,
        uid: payload.uid || user.uid,
        email: clampText(payload.email || user.email || '', 254),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        clientTime: payload.clientTime || nowIso()
      });
    } catch (error) {
      appendLocal(collection, { ...localPayload, syncError: clampText(error.message) });
      return null;
    }
  }

  function event(type, detail = {}) {
    return addDocument('system_events', {
      type: clampText(type, 60),
      severity: clampText(detail.severity || 'info', 20),
      page: clampText(detail.page || location.pathname, 300),
      url: clampText(detail.url || location.href, 700),
      message: clampText(detail.message || '', 1200),
      code: clampText(detail.code || '', 120),
      meta: safeJson(detail.meta) || {}
    });
  }

  function audit(action, detail = {}) {
    return addDocument('system_audit', {
      action: clampText(action, 100),
      target: clampText(detail.target || '', 300),
      summary: clampText(detail.summary || '', 1200),
      before: safeJson(detail.before),
      after: safeJson(detail.after),
      page: clampText(location.pathname, 300)
    });
  }

  function cacheRecord(url, response, duration) {
    const entry = {
      url: clampText(url, 700),
      status: response.status,
      ok: response.ok,
      duration: Math.round(duration),
      checkedAt: nowIso(),
      contentType: clampText(response.headers.get('content-type') || '', 100),
      lastModified: clampText(response.headers.get('last-modified') || '', 100)
    };
    try {
      const cache = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}fetchCache`) || '{}');
      cache[entry.url] = entry;
      const trimmed = Object.fromEntries(Object.entries(cache).slice(-120));
      localStorage.setItem(`${STORAGE_PREFIX}fetchCache`, JSON.stringify(trimmed));
    } catch (_) {}
  }

  function instrumentFetch() {
    if (originalFetch || !window.fetch) return;
    originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const started = performance.now();
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      try {
        const response = await originalFetch(...args);
        cacheRecord(requestUrl, response, performance.now() - started);
        if (!response.ok) {
          event('fetch_error', { severity: response.status >= 500 ? 'critical' : 'warning', url: requestUrl, code: `HTTP_${response.status}`, message: `HTTP ${response.status} ${response.statusText}` });
        }
        return response;
      } catch (error) {
        event('fetch_error', { severity: 'critical', url: requestUrl, code: error.name, message: error.message });
        throw error;
      }
    };
  }

  function attachErrorCapture() {
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);
    console.error = (...args) => {
      originalError(...args);
      const message = args.map(item => item instanceof Error ? `${item.name}: ${item.message}` : typeof item === 'string' ? item : JSON.stringify(safeJson(item))).join(' ');
      setTimeout(() => event('console_error', { severity: 'error', message, meta: { stack: clampText(args.find(item => item instanceof Error)?.stack || '', 3000) } }), 0);
    };
    console.warn = (...args) => {
      originalWarn(...args);
      const message = args.map(item => item instanceof Error ? `${item.name}: ${item.message}` : typeof item === 'string' ? item : JSON.stringify(safeJson(item))).join(' ');
      setTimeout(() => event('console_warning', { severity: 'warning', message }), 0);
    };
    addEventListener('error', (e) => {
      event('javascript_error', {
        severity: 'critical',
        message: e.message,
        code: `${e.filename || location.pathname}:${e.lineno || 0}:${e.colno || 0}`,
        meta: { stack: e.error?.stack ? clampText(e.error.stack, 3000) : '' }
      });
    });
    addEventListener('unhandledrejection', (e) => {
      const reason = e.reason || {};
      event('promise_rejection', { severity: 'critical', message: reason.message || String(reason), meta: { stack: clampText(reason.stack || '', 3000) } });
    });
  }

  async function writeSession(active = true) {
    if (!sessionRef || !user) return;
    const payload = {
      uid: user.uid,
      email: user.email || '',
      sessionId,
      active,
      path: location.pathname,
      title: clampText(document.title, 160),
      userAgent: clampText(navigator.userAgent, 500),
      platform: clampText(navigator.platform || '', 80),
      language: clampText(navigator.language || '', 30),
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      lastSeenAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try { await sessionRef.set(payload, { merge: true }); } catch (_) {}
  }

  async function startSession() {
    if (!db || !user) return;
    sessionRef = db.collection('system_sessions').doc(`${user.uid}_${sessionId}`);
    try {
      await sessionRef.set({
        uid: user.uid,
        email: user.email || '',
        sessionId,
        startedAt: firebase.firestore.FieldValue.serverTimestamp(),
        revoked: false
      }, { merge: true });
      await writeSession(true);
      unsubscribeSession = sessionRef.onSnapshot(async snapshot => {
        if (snapshot.exists && snapshot.data().revoked === true) {
          event('session_revoked', { severity: 'warning', message: '管理者によりセッションが終了されました。' });
          try { await auth.signOut(); } finally { location.replace('/index.html?reason=session_revoked'); }
        }
      });
      heartbeatTimer = setInterval(() => writeSession(true), 60000);
      addEventListener('pagehide', () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (unsubscribeSession) unsubscribeSession();
        writeSession(false);
      }, { once: true });
    } catch (_) {}
  }

  async function start(context = {}) {
    if (user) return window.TayunetTelemetry;
    auth = context.auth || window.TayunetAuth?.auth || null;
    db = context.db || window.TayunetAuth?.db || null;
    user = context.user || auth?.currentUser || null;
    profile = context.profile || null;
    if (!user) return window.TayunetTelemetry;
    instrumentFetch();
    attachErrorCapture();
    await startSession();
    const pageKey = `${STORAGE_PREFIX}page:${location.pathname}`;
    const lastView = Number(sessionStorage.getItem(pageKey) || 0);
    if (Date.now() - lastView > 30000) {
      sessionStorage.setItem(pageKey, String(Date.now()));
      event('page_view', { message: document.title, meta: { referrer: clampText(document.referrer, 500) } });
    }
    return window.TayunetTelemetry;
  }

  window.TayunetTelemetry = Object.freeze({
    start, event, audit, localValues,
    get sessionId() { return sessionId; },
    get user() { return user; },
    get profile() { return profile; },
    get originalFetch() { return originalFetch || window.fetch.bind(window); }
  });
})();
