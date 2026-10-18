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
  function matches(item, filters = {}) {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.state && (item.operationState || 'unknown') !== filters.state) return false;
    if (filters.line && !(item.lines || []).includes(filters.line)) return false;
    const snapshot = item.scheduleSnapshot || item;
    const text = [item.trainNumber, ...(item.trainNumbers || []), item.trainType, item.title,
      item.sectionStart, item.sectionEnd, snapshot.origin, snapshot.destination, ...(item.lines || []),
      ...(snapshot.stops || []).map(stop => stop.station), item.remarks, item.restriction].join('');
    const normalized = value => String(value || '').toLowerCase().replace(/[\s　]/g, '');
    return normalized(text).includes(normalized(filters.query));
  }
  function compare(left, right, order) {
    const number = () => String(left.trainNumber).localeCompare(String(right.trainNumber), 'ja', {numeric:true});
    if (order === 'line') return String(left.lines?.[0] || '').localeCompare(String(right.lines?.[0] || ''), 'ja') || number();
    if (order === 'time') {
      const time = item => {
        const stops = (item.scheduleSnapshot || item).stops || [];
        return stops[0]?.departure || stops[0]?.arrival || '99:99';
      };
      return time(left).localeCompare(time(right)) || number();
    }
    return number();
  }
  function categoryFor(number) {
    const value = Number(String(number).match(/\d+/)?.[0] || -1);
    return value >= 6000 && value <= 8999 ? 'planned_extra' : value >= 9000 && value <= 9999 ? 'extra' : 'regular';
  }
  function timeRowsMarkup(stops, changes = []) {
    if (!stops.length) return '<tr><td colspan="5" class="empty-cell">列車時刻表はありません。</td></tr>';
    const normalized = station => String(station).replace(/[\s　]/g, '');
    const byStation = new Map(changes.map(change => [normalized(change.station), change]));
    const labels = {arrival:'着', departure:'発', trackN:'番線', note:'変更記事'};
    return stops.map((stop, index) => {
      const change = byStation.get(normalized(stop.station)) || {};
      return `<tr data-stop="${index}"><td>${escapeHtml(stop.station)}</td>${Object.keys(labels).map(field => {
        const original = String(field === 'note' ? '' : stop[field] ?? '');
        const value = String(change[field] ?? original);
        return `<td><input data-field="${field}" value="${escapeHtml(value)}" data-original="${escapeHtml(original)}" class="${value.trim() !== original ? 'time-modified' : ''}" aria-label="${escapeHtml(stop.station)} ${labels[field]}" title="原簿：${escapeHtml(original || '空欄')}" maxlength="${field === 'note' ? 200 : field === 'trackN' ? 40 : 12}"></td>`;
      }).join('')}</tr>`;
    }).join('');
  }
  return {states, categories, kinds, escapeHtml, key, rowsMarkup, fromTrain, matches, compare, categoryFor, timeRowsMarkup};
}));
