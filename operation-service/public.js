(function () {
  'use strict';

  const API_ORIGIN = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  const categoryLabels = {planned_extra: '予定臨', extra: '臨時列車', regular: '定期・その他'};
  const stateLabels = {operate: '運転', suspend: '運休', changed: '時刻変更', prohibited: '運転禁止'};
  const $ = id => document.getElementById(id);
  let notices = [];
  let latestChange = null;
  let selectedId = '';

  function tokyoToday() {
    return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  }

  function replaceMarkup(target, markup) {
    const range = document.createRange();
    range.selectNodeContents(target);
    target.replaceChildren(range.createContextualFragment(markup));
  }

  function setMessage(text, kind) {
    $('message').textContent = text || '';
    $('message').className = `message${kind ? ` ${kind}` : ''}${text ? '' : ' hidden'}`;
  }

  function shiftDate(days) {
    const date = new Date(`${$('serviceDate').value || tokyoToday()}T12:00:00+09:00`);
    date.setUTCDate(date.getUTCDate() + days);
    $('serviceDate').value = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo'}).format(date);
    loadNotices();
  }

  function filteredNotices() {
    const category = $('categoryFilter').value;
    const state = $('stateFilter').value;
    const query = $('query').value.trim().toLowerCase().replace(/[\s　]/g, '');
    const mode = $('viewMode').value;
    const result = notices.filter(item => {
      if (mode === 'operate' && item.operationState !== 'operate') return false;
      if (mode === 'suspend' && item.operationState !== 'suspend') return false;
      if (category && item.category !== category) return false;
      if (state && item.operationState !== state) return false;
      if (!query) return true;
      const haystack = [item.trainNumber, item.trainType, item.title, item.sectionStart, item.sectionEnd,
        ...(item.lines || []), item.remarks, item.restriction].join('|').toLowerCase().replace(/[\s　]/g, '');
      return haystack.includes(query);
    });
    if (mode === 'line') result.sort((left, right) => String(left.lines?.[0] || '').localeCompare(String(right.lines?.[0] || ''), 'ja') || String(left.trainNumber).localeCompare(String(right.trainNumber), 'ja', {numeric:true}));
    return result;
  }

  function renderList() {
    const rows = filteredNotices();
    $('listCount').textContent = `${rows.length}件`;
    $('totalCount').textContent = notices.length;
    ['operate', 'suspend', 'changed', 'prohibited'].forEach(state => {
      $(`${state}Count`).textContent = notices.filter(item => item.operationState === state).length;
    });
    if (!rows.length) {
      replaceMarkup($('noticeRows'), '<tr><td colspan="7" class="empty-cell">該当する公表情報はありません。</td></tr>');
      selectedId = '';
      renderDetail(null);
      return;
    }
    replaceMarkup($('noticeRows'), rows.map(item => `
      <tr data-id="${escapeHtml(item.id)}" class="${item.id === selectedId ? 'selected' : ''}" tabindex="0">
        <td><span class="badge badge-${escapeHtml(item.operationState)}">${escapeHtml(stateLabels[item.operationState] || item.operationState)}</span></td>
        <td class="category-${escapeHtml(item.category)}">${escapeHtml(categoryLabels[item.category] || item.category)}</td>
        <td><strong>${escapeHtml(item.trainNumber)}</strong></td><td>${escapeHtml(item.trainType || '―')}</td>
        <td>${escapeHtml(item.sectionStart || item.scheduleSnapshot?.origin || '―')}</td><td title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.sectionEnd || item.scheduleSnapshot?.destination || '―')}</td>
      </tr>`).join(''));
    $('noticeRows').querySelectorAll('tr[data-id]').forEach(row => {
      const select = () => { selectedId = row.dataset.id; renderList(); renderDetail(notices.find(item => item.id === selectedId)); };
      row.addEventListener('click', select);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
    if (!selectedId || !rows.some(item => item.id === selectedId)) selectedId = rows[0].id;
    renderDetail(notices.find(item => item.id === selectedId));
  }

  function timeCell(original, changed) {
    if (!changed || changed === original) return escapeHtml(original || '―');
    return `<span class="changed-time">${escapeHtml(changed)}</span>${original ? `<br><span class="original-time">${escapeHtml(original)}</span>` : ''}`;
  }

  function renderDetail(item) {
    if (!item) {
      $('detailId').textContent = '未選択';
      $('detail').className = 'detail-placeholder';
      $('detail').textContent = '一覧から列車を選択してください。';
      return;
    }
    $('detailId').textContent = item.id;
    $('detail').className = '';
    const changes = new Map((item.timeChanges || []).map(change => [String(change.station).replace(/[\s　]/g, ''), change]));
    const stops = item.scheduleSnapshot?.stops || [];
    const stopRows = stops.map((stop, index) => {
      const change = changes.get(String(stop.station || '').replace(/[\s　]/g, '')) || {};
      return `<tr><td>${index + 1}</td><td>${escapeHtml(stop.line || '')}</td><td>${escapeHtml(stop.station || '')}</td>
        <td>${timeCell(stop.arrival, change.arrival)}</td><td>${timeCell(stop.departure, change.departure)}</td>
        <td>${timeCell(stop.trackN, change.trackN)}</td></tr>`;
    }).join('');
    replaceMarkup($('detail'), `
      <div class="detail-header"><div><span class="badge badge-${escapeHtml(item.operationState)}">${escapeHtml(stateLabels[item.operationState] || item.operationState)}</span> ${escapeHtml(categoryLabels[item.category] || '')}</div><h2>${escapeHtml(item.title)}</h2></div>
      <dl class="detail-meta">
        <dt>通達番号</dt><dd>${escapeHtml(item.noticeNumber || '―')} <a class="button" target="_blank" rel="noopener" href="notice.html?id=${encodeURIComponent(item.id)}">PDF出力</a></dd><dt>運転日</dt><dd>${escapeHtml(item.serviceDate)}</dd><dt>列車</dt><dd>${escapeHtml(item.trainType || '')} ${escapeHtml(item.trainNumber)}</dd>
        <dt>区間</dt><dd>${escapeHtml(item.sectionStart || '―')} ～ ${escapeHtml(item.sectionEnd || '―')}</dd>
        <dt>線区</dt><dd>${escapeHtml((item.lines || []).join('・') || '―')}</dd><dt>公表日時</dt><dd>${escapeHtml(item.publishedAt || '―')}</dd>
      </dl>
      ${item.restriction ? `<div class="notice-text"><strong>運転上の制限・禁止事項</strong>\n${escapeHtml(item.restriction)}</div>` : ''}
      ${item.remarks ? `<div class="notice-text"><strong>記事</strong>\n${escapeHtml(item.remarks)}</div>` : ''}
      <div class="panel-title"><span>列車時刻表</span><span>${stops.length}駅</span></div>
      <div class="data-wrap inset"><table class="data-grid"><colgroup><col style="width:35px"><col style="width:90px"><col style="width:95px"><col style="width:80px"><col style="width:80px"><col style="width:70px"></colgroup>
        <thead><tr><th>No.</th><th>線区</th><th>駅名</th><th>着</th><th>発</th><th>番線</th></tr></thead>
        <tbody>${stopRows || '<tr><td colspan="6" class="empty-cell">時刻表はありません。</td></tr>'}</tbody></table></div>
      ${item.category === 'planned_extra' ? '<div class="panel-title"><span>この列車の活休履歴</span></div><div id="plannedHistory" class="panel-content">履歴を照会中です。</div>' : ''}`);
    if (item.category === 'planned_extra') loadPlannedHistory(item);
  }

  async function loadPlannedHistory(item) {
    const target = $('plannedHistory');
    if (!target) return;
    try {
      const url = new URL('/public/api/operation-notices', API_ORIGIN);
      url.searchParams.set('trainNumber', item.trainNumber);
      const response = await fetch(url, {headers:{Accept:'application/json'}, cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!$('plannedHistory') || selectedId !== item.id) return;
      const history = (payload.items || []).sort((a,b) => String(b.serviceDate).localeCompare(String(a.serviceDate)));
      replaceMarkup($('plannedHistory'), history.length ? `<table class="data-grid"><thead><tr><th>運転日</th><th>活休</th><th>区間</th><th>備考</th></tr></thead><tbody>${history.map(entry => `<tr><td>${escapeHtml(entry.serviceDate)}</td><td>${escapeHtml(stateLabels[entry.operationState] || entry.operationState)}</td><td>${escapeHtml(entry.sectionStart || '―')}～${escapeHtml(entry.sectionEnd || '―')}</td><td>${escapeHtml(entry.remarks || '')}</td></tr>`).join('')}</tbody></table>` : '履歴はありません。');
    } catch (error) { if ($('plannedHistory')) $('plannedHistory').textContent = `履歴を取得できませんでした: ${error.message}`; }
  }

  async function loadNotices() {
    setMessage('');
    $('statusText').textContent = '公開情報を読み込んでいます…';
    try {
      const url = new URL('/public/api/operation-notices', API_ORIGIN);
      url.searchParams.set('serviceDate', $('serviceDate').value);
      const response = await fetch(url, {headers: {Accept: 'application/json'}, cache: 'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      notices = Array.isArray(payload.items) ? payload.items : [];
      latestChange = payload.latestChange || null;
      if (latestChange) {
        $('changeSummary').className = 'message';
        $('changeSummary').textContent = `最新更新 ${latestChange.occurredAt}　追加 ${latestChange.addedCount}件／削除 ${latestChange.removedCount}件／変更 ${latestChange.changedCount}件`;
      } else {
        $('changeSummary').className = 'message hidden';
      }
      selectedId = notices.some(item => item.id === selectedId) ? selectedId : '';
      renderList();
      const now = new Date();
      $('updatedText').textContent = now.toLocaleTimeString('ja-JP', {hour: '2-digit', minute: '2-digit'});
      $('statusText').textContent = `${$('serviceDate').value}の公表情報 ${notices.length}件を表示しました。`;
      history.replaceState(null, '', `?date=${encodeURIComponent($('serviceDate').value)}`);
    } catch (error) {
      notices = [];
      renderList();
      setMessage('公開情報を取得できませんでした。時間をおいて再度お試しください。', 'error');
      $('statusText').textContent = `読込失敗: ${error.message}`;
    }
  }

  const requestedDate = new URLSearchParams(location.search).get('date');
  $('serviceDate').value = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '') ? requestedDate : tokyoToday();
  $('previousDate').addEventListener('click', () => shiftDate(-1));
  $('nextDate').addEventListener('click', () => shiftDate(1));
  $('today').addEventListener('click', () => { $('serviceDate').value = tokyoToday(); loadNotices(); });
  $('serviceDate').addEventListener('change', loadNotices);
  $('reload').addEventListener('click', loadNotices);
  ['viewMode', 'categoryFilter', 'stateFilter', 'query'].forEach(id => $(id).addEventListener(id === 'query' ? 'input' : 'change', renderList));
  loadNotices();
})();
