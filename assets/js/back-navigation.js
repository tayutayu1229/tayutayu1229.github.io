(() => {
  'use strict';

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const rootPages = new Set(['/', '/index.html', '/toppage.html']);
  if (rootPages.has(currentPath) || document.querySelector('[data-site-back-navigation]')) return;

  const returnWords = /戻る|トップ(?:ページ|メニュー)?へ|メインメニュー|管理ホーム|ポータル(?:トップ)?へ|ゲームメニューへ/i;
  const hasExistingReturn = [...document.querySelectorAll('a, button, [role="button"]')].some((control) => {
    const label = `${control.textContent || ''} ${control.getAttribute('aria-label') || ''} ${control.getAttribute('title') || ''}`;
    const destination = `${control.getAttribute('href') || ''} ${control.getAttribute('onclick') || ''}`;
    return returnWords.test(label) || /(?:^|\/)toppage\.html(?:[?#]|$)|history\.back\s*\(/i.test(destination);
  });
  if (hasExistingReturn) return;

  const style = document.createElement('style');
  style.textContent = `
    .site-auto-back {
      position: fixed;
      left: max(12px, env(safe-area-inset-left));
      bottom: max(12px, env(safe-area-inset-bottom));
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 42px;
      padding: 0 14px;
      border: 1px solid rgba(18, 72, 48, .38);
      border-radius: 4px;
      background: rgba(255, 255, 255, .96);
      color: #174b34;
      box-shadow: 0 4px 16px rgba(0, 0, 0, .16);
      font: 700 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
      letter-spacing: .02em;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      backdrop-filter: blur(8px);
    }
    .site-auto-back:hover { background: #f0f7f3; border-color: #176d49; }
    .site-auto-back:focus-visible { outline: 3px solid rgba(23, 109, 73, .3); outline-offset: 2px; }
    .site-auto-back__arrow { font-size: 18px; line-height: 1; }
    @media (max-width: 560px) {
      .site-auto-back { width: 42px; padding: 0; border-radius: 50%; }
      .site-auto-back__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    }
    @media print { .site-auto-back { display: none !important; } }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-auto-back';
  button.dataset.siteBackNavigation = 'true';
  button.setAttribute('aria-label', '前の画面へ戻る');
  button.title = '前の画面へ戻る';

  const arrow = document.createElement('span');
  arrow.className = 'site-auto-back__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '←';
  const label = document.createElement('span');
  label.className = 'site-auto-back__label';
  label.textContent = '戻る';
  button.append(arrow, label);

  button.addEventListener('click', () => {
    let canReturn = false;
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      canReturn = Boolean(referrer && referrer.origin === window.location.origin && referrer.href !== window.location.href && window.history.length > 1);
    } catch (_) {
      canReturn = false;
    }
    if (canReturn) window.history.back();
    else window.location.href = '/toppage.html';
  });

  document.body.appendChild(button);
})();
