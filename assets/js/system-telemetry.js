(() => {
  'use strict';

  if (window.TayunetTelemetry) return;
  const STORAGE_PREFIX = 'tayunetOps:';
  const nowIso = () => new Date().toISOString();
  const clampText = (value, max = 1000) => String(value ?? '').slice(0, max);
  const deviceId = (() => {
    const key = `${STORAGE_PREFIX}deviceId`;
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
      localStorage.setItem(key, id);
    }
    return id;
  })();
  const environmentSignature = (() => {
    const text = [navigator.userAgent, navigator.platform, navigator.language, `${screen.width}x${screen.height}`, Intl.DateTimeFormat().resolvedOptions().timeZone || ''].join('|');
    let hash = 2166136261;
    for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  })();
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
  let networkContext = { ipAddress: '', countryCode: '', networkEdge: '' };
  const recentEventKeys = new Map();

  function isDuplicateEvent(type, detail) {
    if (type === 'page_view') return false;
    const eventKey = `${type}|${detail.code || ''}|${detail.url || location.href}|${detail.message || ''}`;
    const now = Date.now();
    const previous = recentEventKeys.get(eventKey) || 0;
    recentEventKeys.set(eventKey, now);
    if (recentEventKeys.size > 250) {
      for (const [key, timestamp] of recentEventKeys) if (now - timestamp > 300000) recentEventKeys.delete(key);
    }
    return now - previous < (type === 'user_action' || type === 'form_submit' ? 1500 : 60000);
  }

  async function loadNetworkContext() {
    const cacheKey = `${STORAGE_PREFIX}networkContext`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached?.ipAddress && Date.now() - Number(cached.savedAt || 0) < 6 * 3600000) {
        networkContext = cached;
        return networkContext;
      }
    } catch (_) {}
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch('https://1.1.1.1/cdn-cgi/trace', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return networkContext;
      const values = Object.fromEntries((await response.text()).trim().split('\n').map(line => line.split('=')));
      networkContext = {
        ipAddress: clampText(values.ip || '', 64),
        countryCode: clampText(values.loc || '', 8),
        networkEdge: clampText(values.colo || '', 12),
        savedAt: Date.now()
      };
      sessionStorage.setItem(cacheKey, JSON.stringify(networkContext));
    } catch (_) {
      // IP情報を取得できなくても認証や画面利用は止めない。
    } finally {
      clearTimeout(timer);
    }
    return networkContext;
  }

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
        sessionId: payload.sessionId || sessionId,
        deviceId: payload.deviceId || deviceId,
        environmentSignature: payload.environmentSignature || environmentSignature,
        ipAddress: payload.ipAddress || networkContext.ipAddress || '',
        countryCode: payload.countryCode || networkContext.countryCode || '',
        networkEdge: payload.networkEdge || networkContext.networkEdge || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        clientTime: payload.clientTime || nowIso()
      });
    } catch (error) {
      appendLocal(collection, { ...localPayload, syncError: clampText(error.message) });
      return null;
    }
  }

  function event(type, detail = {}) {
    if (isDuplicateEvent(type, detail)) return Promise.resolve(null);
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
        // 画面遷移や明示的なタイムアウトによる中断は障害ではないため記録しない。
        if (error?.name !== 'AbortError') {
          // 単発の通信断はアプリ破損ではないため「重大」にはしない。連続記録も event() 側で抑止する。
          event('fetch_error', { severity: navigator.onLine ? 'error' : 'warning', url: requestUrl, code: error.name, message: error.message });
        }
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
      const opaqueScriptError = e.message === 'Script error.' && !e.error;
      event('javascript_error', {
        severity: opaqueScriptError ? 'warning' : 'critical',
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

  function safeActionLabel(element) {
    if (!element) return '';
    const aria = element.getAttribute?.('aria-label') || element.getAttribute?.('title') || '';
    const text = aria || element.innerText || element.textContent || element.value || '';
    return clampText(String(text).replace(/\s+/g, ' ').trim(), 160);
  }

  function safeActionTarget(element) {
    const href = element?.getAttribute?.('href') || '';
    if (!href) return '';
    try {
      const target = new URL(href, location.href);
      return target.origin === location.origin ? target.pathname : target.origin;
    } catch (_) {
      return '';
    }
  }

  function attachInteractionCapture() {
    document.addEventListener('click', clickEvent => {
      const element = clickEvent.target?.closest?.('button,a,[role="button"],input[type="button"],input[type="submit"],summary');
      if (!element || element.closest('[data-telemetry-ignore]')) return;
      const target = safeActionTarget(element);
      const download = element.hasAttribute?.('download');
      event('user_action', {
        code: download ? 'download' : element.tagName === 'A' ? 'link' : 'click',
        message: safeActionLabel(element) || element.id || element.tagName,
        meta: { elementId: clampText(element.id || '', 100), target, download }
      });
    }, true);
    document.addEventListener('submit', submitEvent => {
      const form = submitEvent.target;
      event('form_submit', {
        code: clampText(form?.id || form?.getAttribute?.('name') || 'form', 100),
        message: safeActionLabel(form?.querySelector?.('button[type="submit"],input[type="submit"]')) || 'フォーム送信',
        meta: { formId: clampText(form?.id || '', 100) }
      });
    }, true);
    document.addEventListener('change', changeEvent => {
      const control = changeEvent.target;
      if (!control?.matches?.('select,input[type="checkbox"],input[type="radio"],input[type="date"],input[type="time"]') || control.closest('[data-telemetry-ignore]')) return;
      const label = control.labels?.[0]?.innerText || control.getAttribute('aria-label') || control.id || control.name || control.tagName;
      event('user_action', {
        code: 'control_change',
        message: clampText(String(label).replace(/\s+/g, ' ').trim(), 160),
        meta: { elementId: clampText(control.id || '', 100), controlType: clampText(control.type || control.tagName, 30) }
      });
    }, true);
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
      deviceId,
      environmentSignature,
      ipAddress: networkContext.ipAddress || '',
      countryCode: networkContext.countryCode || '',
      networkEdge: networkContext.networkEdge || '',
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
        deviceId,
        environmentSignature,
        ipAddress: networkContext.ipAddress || '',
        countryCode: networkContext.countryCode || '',
        networkEdge: networkContext.networkEdge || '',
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
    await loadNetworkContext();
    instrumentFetch();
    attachErrorCapture();
    attachInteractionCapture();
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
    start, event, audit, localValues, loadNetworkContext,
    get sessionId() { return sessionId; },
    get user() { return user; },
    get profile() { return profile; },
    get networkContext() { return { ...networkContext }; },
    get originalFetch() { return originalFetch || window.fetch.bind(window); }
  });
})();
