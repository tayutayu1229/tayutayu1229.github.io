(() => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
  }

  function safeToken(value, fallback = '') {
    const token = String(value ?? '');
    return /^[A-Za-z0-9_-]{1,128}$/.test(token) ? token : fallback;
  }

  function safeUrl(value, options = {}) {
    const raw = String(value ?? '').trim();
    if (!raw) return options.allowEmpty === false ? null : '';
    if (/^[\u0000-\u001F\u007F]/.test(raw)) return null;
    try {
      const parsed = new URL(raw, document.baseURI);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
      if (parsed.protocol === 'blob:' && options.allowBlob !== false) return parsed.href;
      if (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') return parsed.href;
      if (parsed.protocol === 'data:' && options.allowDataImage && /^data:image\/(?:avif|gif|jpeg|png|webp);/i.test(raw)) return raw;
    } catch (_) {}
    return null;
  }

  function setSafeUrl(element, attribute, value, options = {}) {
    const safe = safeUrl(value, options);
    if (safe === null) {
      element.removeAttribute(attribute);
      return false;
    }
    element.setAttribute(attribute, safe);
    return true;
  }

  window.TayunetSecurity = Object.freeze({ escapeHtml, safeToken, safeUrl, setSafeUrl });

  const ICON_PATH = '/icon-192.png';
  const HOME_PATH = '/toppage.html';
  const VERSION_PATH = '/system-version.json';
  const LEGACY_MARK_SELECTOR = [
    '.sys-badge',
    '.sys-mark',
    '.header-mark',
    '.sidebar-mark',
    '.brand-mark',
    '.brandmark',
    '.logo-mark',
    '[data-site-legacy-mark]'
  ].join(',');

  function createBrandLink(extraClass = '') {
    const link = document.createElement('a');
    link.className = `site-brand-link ${extraClass}`.trim();
    link.href = HOME_PATH;
    link.setAttribute('aria-label', '東京圏輸送情報システム トップページ');
    link.dataset.siteIconInstance = 'true';

    const image = document.createElement('img');
    image.className = 'site-brand-icon';
    image.src = ICON_PATH;
    image.alt = '';
    image.width = 42;
    image.height = 42;
    image.decoding = 'async';
    link.appendChild(image);
    return link;
  }

  function replaceLegacyMark(host) {
    host.classList.add('site-brand-host');
    host.querySelectorAll(LEGACY_MARK_SELECTOR).forEach((legacyMark) => {
      legacyMark.remove();
    });
    host.prepend(createBrandLink());
  }

  function injectBrandIcon() {
    if (document.querySelector('[data-site-icon-instance]')) return;

    const explicitHost = document.querySelector('[data-site-brand-host]');
    if (explicitHost) {
      replaceLegacyMark(explicitHost);
      return;
    }

    const headerHost = document.querySelector([
      '#header .sys-title-block',
      '#header .header-left',
      '.system-header .system-header-inner',
      'header .brand',
      '.topbar .brand',
      '.top .brand',
      'aside .brand',
      '.side .brand',
      '.sidebar .brand',
      '.sidebar .sidebar-header',
      '.page-header .header-title',
      'body > header',
      'body > .header-bar'
    ].join(','));

    if (headerHost) {
      replaceLegacyMark(headerHost);
      return;
    }

    document.body.appendChild(createBrandLink('site-brand-corner'));
  }

  async function injectVersion() {
    if (document.querySelector('[data-site-version-chip]')) return;
    let data;
    try {
      const response = await fetch(VERSION_PATH, { cache: 'no-store' });
      if (!response.ok) return;
      data = await response.json();
    } catch (_) { return; }
    const link = document.createElement('a');
    link.className = 'site-version-chip';
    link.dataset.siteVersionChip = 'true';
    link.href = '/system_admin.html';
    link.title = `${data.name || 'システム'} ${data.releaseName || ''}`.trim();
    link.setAttribute('aria-label', `システムバージョン ${data.version}`);
    link.textContent = `Ver.${data.version || '-'}`;
    document.body.appendChild(link);
  }

  function boot() { injectBrandIcon(); injectVersion(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
