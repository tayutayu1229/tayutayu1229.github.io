(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  const fmtDate = (value, fallback = '-') => {
    if (!value) return fallback;
    const date = value.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('ja-JP');
  };
  const relativeAge = (value) => {
    if (!value) return '不明';
    const date = value.toDate ? value.toDate() : new Date(value);
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return '1分未満';
    if (minutes < 60) return `${minutes}分前`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}時間前`;
    return `${Math.floor(minutes / 1440)}日前`;
  };
  const hash = (value) => {
    let result = 2166136261;
    for (const char of String(value)) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
    return (result >>> 0).toString(36);
  };
  const download = (name, text, type = 'application/json') => {
    const blob = new Blob([text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const toast = (message, type = '') => {
    let stack = document.querySelector('.ops-toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'ops-toast-stack'; document.body.appendChild(stack); }
    const item = document.createElement('div'); item.className = `ops-toast ${type}`; item.textContent = message; stack.appendChild(item);
    setTimeout(() => item.remove(), 3600);
  };
  const storageGet = (key, fallback) => {
    try { const value = localStorage.getItem(`tayunetOps:${key}`); return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; }
  };
  const storageSet = (key, value) => { try { localStorage.setItem(`tayunetOps:${key}`, JSON.stringify(value)); return true; } catch (_) { return false; } };

  let authContext = null;
  let version = { version: '読込中', changes: [] };

  function renderChrome() {
    const page = document.body.dataset.opsPage || 'home';
    document.querySelectorAll('.ops-nav a').forEach(link => link.classList.toggle('active', link.dataset.page === page));
    document.querySelectorAll('[data-version]').forEach(node => { node.textContent = version.version || '-'; });
    document.querySelectorAll('[data-published-at]').forEach(node => { node.textContent = fmtDate(version.publishedAt); });
  }

  async function loadVersion() {
    try {
      const response = await fetch(`/system-version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      version = await response.json();
    } catch (error) {
      version = { version: '取得失敗', changes: [], error: error.message };
    }
    renderChrome();
    return version;
  }

  async function requireAdmin() {
    let ready;
    try { ready = await window.TayunetAuthReady; } catch (_) {}
    if (!ready?.ok) return null;
    if (ready.profile?.isAdmin !== true) {
      document.body.innerHTML = '<main class="ops-main"><div class="ops-alert critical"><div><b>管理者権限が必要です</b><p>この画面はシステム管理者だけが利用できます。</p></div></div><a class="ops-btn" href="/toppage.html">トップページへ戻る</a></main>';
      return null;
    }
    authContext = ready;
    document.body.classList.add('ops-auth-authorized');
    if (window.TayunetTelemetry) await window.TayunetTelemetry.start({ ...ready, ...window.TayunetAuth });
    const userLabel = $('[data-admin-user]');
    if (userLabel) userLabel.textContent = ready.user.email || '管理者';
    return ready;
  }

  function collection(name) { return window.TayunetAuth?.db?.collection(name); }
  function serverTimestamp() { return firebase.firestore.FieldValue.serverTimestamp(); }
  async function getCollection(name, options = {}) {
    let ref = collection(name);
    if (!ref) return [];
    if (options.orderBy) ref = ref.orderBy(options.orderBy, options.direction || 'desc');
    if (options.limit) ref = ref.limit(options.limit);
    const snapshot = await ref.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  async function audit(action, detail) { return window.TayunetTelemetry?.audit(action, detail); }

  async function init() {
    renderChrome();
    await Promise.all([loadVersion(), requireAdmin()]);
  }

  window.Ops = Object.freeze({
    $, escapeHtml, fmtDate, relativeAge, hash, download, toast, storageGet, storageSet,
    loadVersion, requireAdmin, getCollection, collection, serverTimestamp, audit,
    get auth() { return authContext; }, get version() { return version; }, init
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
