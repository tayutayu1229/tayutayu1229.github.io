(async function () {
  'use strict';
  const API_ORIGIN = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const query = new URLSearchParams(location.search);
  const id = query.get('id') || '';
  const serviceDate = query.get('serviceDate') || '';

  function replaceMarkup(target, markup) {
    const range = document.createRange();
    range.selectNodeContents(target);
    target.replaceChildren(range.createContextualFragment(markup));
  }

  async function fetchNotice() {
    const url = new URL(`/public/api/operation-notices/${encodeURIComponent(id)}`, API_ORIGIN);
    if (serviceDate) url.searchParams.set('serviceDate', serviceDate);
    const response = await fetch(url, {
      cache:'no-store', headers:{Accept:'application/json'},
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function render(item) {
    const changes = new Map((item.timeChanges || []).map(change => [String(change.station).replace(/[\s　]/g,''), change]));
    const rows = (item.scheduleSnapshot?.stops || []).map(stop => {
      const change = changes.get(String(stop.station || '').replace(/[\s　]/g,'')) || {};
      const cell = (original, changed) => changed && changed !== original
        ? `<span class="changed">${escapeHtml(changed)}</span><br><small>所定 ${escapeHtml(original || '―')}</small>`
        : escapeHtml(original || '―');
      return `<tr><td>${escapeHtml(stop.station || '')}</td><td>${cell(stop.arrival,change.arrival)}</td><td>${cell(stop.departure,change.departure)}</td><td>${cell(stop.trackN,change.trackN)}</td></tr>`;
    }).join('');
    const serviceDateText = item.serviceDateMode === 'range'
      ? `${item.serviceDateStart || item.serviceDate}～${item.serviceDateEnd || item.serviceDate}`
      : (item.serviceDates || [item.serviceDate]).join('・');
    document.title = `${item.noticeNumber || item.id} ${item.title}`;
    replaceMarkup(document.getElementById('paper'), `
      <div class="document-number">${escapeHtml(item.noticeNumber || '未採番')}<br>作成 ${escapeHtml(item.createdAt || '')}<br>更新 ${escapeHtml(item.updatedAt || '')}</div>
      <h1 class="document-title">運転活休通達</h1><div class="document-subtitle">${escapeHtml(item.title)}</div>
      <table class="document-meta"><tr><th>施行日</th><td>${escapeHtml(serviceDateText)}</td><th>活休区分</th><td>${escapeHtml({operate:'運転',suspend:'運転休止',changed:'時刻変更',prohibited:'運転禁止'}[item.operationState] || item.operationState)}</td></tr>
      <tr><th>列車</th><td>${escapeHtml(item.trainType || '')} ${escapeHtml(item.trainNumber)}</td><th>線区</th><td>${escapeHtml((item.lines || []).join('・'))}</td></tr>
      <tr><th>区間</th><td colspan="3">${escapeHtml(item.sectionStart || '―')} ～ ${escapeHtml(item.sectionEnd || '―')}</td></tr></table>
      <table class="document-table"><colgroup><col style="width:55mm"><col style="width:35mm"><col style="width:35mm"><col style="width:30mm"></colgroup>
      <thead><tr><th>駅名</th><th>着</th><th>発</th><th>番線</th></tr></thead><tbody>${rows || '<tr><td colspan="4">時刻表なし</td></tr>'}</tbody></table>
      ${item.restriction ? `<div class="document-note"><strong>運転上の禁止・制限事項</strong><br>${escapeHtml(item.restriction)}</div>` : ''}
      <div class="document-note"><strong>備考</strong><br>${escapeHtml(item.remarks || 'なし')}</div>
      <div class="document-footer"><span>東京圏輸送情報システム</span><span>${escapeHtml(item.id)} / 第${escapeHtml(item.version)}版</span></div>`);
  }

  document.getElementById('printButton').addEventListener('click', () => window.print());
  document.getElementById('closeButton').addEventListener('click', () => window.close());
  try {
    if (!id) throw new Error('通達IDがありません');
    render(await fetchNotice());
    if (query.get('print') === '1') setTimeout(() => window.print(), 400);
  } catch (error) {
    replaceMarkup(document.getElementById('paper'), `<h1>運転活休通達</h1><p>読込に失敗しました: ${escapeHtml(error.message)}</p>`);
  }
})();
