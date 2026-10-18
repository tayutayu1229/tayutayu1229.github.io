(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OperationDailyUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const states = {operate: '運転', suspend: '運休', changed: '時刻変更', prohibited: '運転禁止', unknown: '未入力'};
  const categories = {planned_extra: '予定臨', extra: '臨時列車', regular: '定期等'};
  const kinds = {operate: 'operation', suspend: 'suspension', changed: 'time_change', prohibited: 'prohibition', unknown: 'unconfirmed'};
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const key = item => String(item.trainNumber || '').toLowerCase().replace(/[\s　]/g, '').replace('列車', '');
  function rowsMarkup(items, selectable = false) {
    return items.map((item, index) => {
      const state = Object.hasOwn(states, item.operationState) ? item.operationState : 'unknown';
      const snapshot = item.scheduleSnapshot || {};
      const source = item.timetableDayType ? `原簿：${item.timetableDayType}指定` : '';
      const changes = (item.timeChanges || []).map(change => [change.station,
        change.arrival ? `着 ${change.arrival}` : '', change.departure ? `発 ${change.departure}` : '',
        change.trackN ? `番線 ${change.trackN}` : '', change.note || ''].filter(Boolean).join(' '));
      const notes = [item.restriction, item.remarks, ...changes, source, item.timetableWarning].filter(Boolean).join('\n');
      return `<tr class="state-${state}" data-index="${index}"><td class="check">${selectable
        ? `<input type="checkbox" aria-label="${escapeHtml(item.trainNumber)}を選択" data-select="${index}">` : '□'}</td>
        <td>${index + 1}</td><td>${escapeHtml(categories[item.category] || '定期等')}</td>
        <td>${escapeHtml(item.trainNumber)}</td><td>${escapeHtml(item.trainType || '―')}</td>
        <td>${escapeHtml(snapshot.origin || item.sectionStart || '―')}</td><td>${escapeHtml(snapshot.destination || item.sectionEnd || '―')}</td>
        <td>${states[state]}</td><td>${escapeHtml([item.sectionStart || '―', item.sectionEnd || '―'].join('～'))}</td>
        <td class="daily-remarks">${escapeHtml(notes)}</td></tr>`;
    }).join('');
  }
  function fromTrain(train, sourceType = '') {
    return {trainNumber: train.trainNumber, trainType: train.trainType, category: train.category,
      title: train.defaultTitle || '日別活休', operationState: 'unknown', operationKind: 'unconfirmed',
      sectionStart: train.origin, sectionEnd: train.destination, lines: train.lines || [],
      timeChanges: [], remarks: '', restriction: '', scheduleKey: train.scheduleKey,
      diagramPeriodId: train.diagramPeriod?.id || '', scheduleSnapshot: train, timetableDayType: sourceType};
  }
  return {states, categories, kinds, escapeHtml, key, rowsMarkup, fromTrain};
}));
