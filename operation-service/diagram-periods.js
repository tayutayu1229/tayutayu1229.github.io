(async function () {
  'use strict';
  const API_ORIGIN = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const displayDate = value => String(value || '').replace(/-/g, '/');

  function replaceMarkup(target, markup) {
    const range = document.createRange();
    range.selectNodeContents(target);
    target.replaceChildren(range.createContextualFragment(markup));
  }

  async function loadPeriods() {
    $('statusText').textContent = 'ダイヤ改正マスタを読み込んでいます…';
    try {
      const token = await window.TayunetFirebaseDataAuth.getIdToken();
      const response = await fetch(new URL('/api/operation-service/diagram-periods', API_ORIGIN), {
        cache:'no-store', credentials:'include', headers:{Accept:'application/json', Authorization:`Bearer ${token}`},
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      const items = payload.items || [];
      $('periodCount').textContent = `${items.length}件`;
      replaceMarkup($('periodRows'), items.length ? items.map(item => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(displayDate(item.startDate))}</td><td>${escapeHtml(displayDate(item.endDate))}</td><td>${escapeHtml(displayDate(item.holidayBaseDate))}</td><td>${escapeHtml(displayDate(item.weekdayBaseDate))}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-cell">登録はありません。</td></tr>');
      $('statusText').textContent = `${items.length}件の改正期間を表示しました。`;
    } catch (error) {
      $('message').className = 'message error';
      $('message').textContent = `読込に失敗しました: ${error.message}`;
      $('statusText').textContent = '読込失敗';
    }
  }

  const ready = await window.TayunetAuthReady;
  if (!ready.ok) return;
  $('operatorName').textContent = `${ready.user.email || '利用者'} / ${ready.profile.isAdmin ? '管理者' : '閲覧権限'}`;
  $('reload').addEventListener('click', loadPeriods);
  loadPeriods();
})();
