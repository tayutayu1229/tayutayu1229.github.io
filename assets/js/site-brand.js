(() => {
  'use strict';

  const ICON_PATH = '/icon-192.png';
  const HOME_PATH = '/toppage.html';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBrandIcon, { once: true });
  } else {
    injectBrandIcon();
  }
})();
