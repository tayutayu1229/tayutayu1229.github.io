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
  function cleanRemarks(text) {
    const value = String(text || '');
    const cleaned = value.replace(/ダイヤ原簿設定あり[（(]活休未判定[）)]|管理画面の一括(?:運転|運休)で登録/g, '');
    return cleaned === value ? value : cleaned.split(/\r?\n/).filter(line => line.trim()).join('\n').trim();
  }
  function layers(item) {
    const state = item.operationState || 'unknown';
    return {base:['operate','suspend','unknown'].includes(item.baseActivity) ? item.baseActivity : ['changed','prohibited'].includes(state) ? 'operate' : state,
      timeChanged:item.timeChanged ?? (state === 'changed'),
      prohibited:item.prohibited ?? state === 'prohibited', sections:item.sectionOverrides || []};
  }
  function withBase(item, base) {
    const value = layers(item);
    return {...item, baseActivity:base, timeChanged:value.timeChanged, prohibited:value.prohibited,
      operationState:value.prohibited ? 'prohibited' : base === 'suspend' ? 'suspend' : base === 'operate' && value.timeChanged ? 'changed' : base};
  }
  function resolvedSections(item) {
    const value = layers(item), normalize = text => String(text || '').replace(/[\s　]/g, '');
    const stops = item.scheduleSnapshot?.stops || [];
    const names = stops.map(stop => normalize(stop.station));
    if (!value.sections.length || stops.length < 2 || new Set(names).size !== names.length) return null;
    const first = names.indexOf(normalize(item.sectionStart || item.scheduleSnapshot?.origin || stops[0].station));
    const last = names.indexOf(normalize(item.sectionEnd || item.scheduleSnapshot?.destination || stops[stops.length - 1].station));
    if (first < 0 || last <= first) return null;
    const legs = Array(stops.length - 1).fill('unknown');
    for (let i = first; i < last; i++) legs[i] = value.prohibited ? 'prohibited' : value.base;
    for (const section of value.sections) {
      const start = names.indexOf(normalize(section.start)), end = names.indexOf(normalize(section.end));
      if (start < 0 || end <= start) return null;
      for (let i = start; i < end; i++) legs[i] = section.state;
    }
    const result = [];
    legs.forEach((state, i) => {
      if (result.length && result[result.length - 1].state === state) result[result.length - 1].end = stops[i + 1].station;
      else result.push({start:stops[i].station, end:stops[i + 1].station, state});
    });
    return result;
  }
  function activityMatches(item, state) {
    const value = layers(item), resolved = resolvedSections(item);
    if (state === 'changed') return value.timeChanged;
    if (state === 'prohibited') return value.prohibited || (resolved || value.sections).some(section => section.state === state);
    if (state === 'unknown') return value.base === 'unknown';
    return resolved ? resolved.some(section => section.state === state) : value.base === state || value.sections.some(section => section.state === state);
  }
  function statusText(item) {
    const value = layers(item);
    return value.prohibited ? '運転禁止' : states[value.base] || '未入力';
  }
  function sectionNotes(item) {
    const sections = layers(item).sections;
    if (!sections.length) return '';
    return sections.map(s => `${s.start}～${s.end} ${states[s.state]}${s.remarks ? `：${s.remarks}` : ''}`).join('\n');
  }
  function parseNumbers(text) {
    return [...new Set(String(text || '').normalize('NFKC').split(/[\s,、;；]+/).map(value => value.trim()).filter(Boolean))];
  }
  function arrangementNotes(item) {
    const value = layers(item);
    return [value.timeChanged ? '時刻変更あり' : '', value.prohibited ? '運転禁止' : '', sectionNotes(item)].filter(Boolean).join('\n');
  }
  function sectionRowMarkup(section = {}) {
    return `<td><input data-section-field="start" list="stationChoices" maxlength="80" aria-label="区間の始点" value="${escapeHtml(section.start)}"></td>
      <td><input data-section-field="end" list="stationChoices" maxlength="80" aria-label="区間の終点" value="${escapeHtml(section.end)}"></td>
      <td><select data-section-field="state" aria-label="区間の活休">${['suspend','operate','prohibited'].map(state => `<option value="${state}"${state === (section.state || 'suspend') ? ' selected' : ''}>${states[state]}</option>`).join('')}</select></td>
      <td><input data-section-field="remarks" maxlength="1000" aria-label="区間の記事" value="${escapeHtml(section.remarks)}"></td><td><button type="button">削除</button></td>`;
  }
  function rowsMarkup(items, selectable = false) {
    return items.map((item, index) => {
      let state = withBase(item, layers(item).base).operationState;
      if (!Object.hasOwn(states, state)) state = 'unknown';
      if (layers(item).sections.length) {
        const result = resolvedSections(item);
        state = result?.every(section => section.state === 'prohibited') ? 'prohibited' : result?.every(section => section.state === 'suspend') ? 'suspend' : 'operate';
      }
      const snapshot = item.scheduleSnapshot || {};
      const source = item.timetableDayType ? `原簿：${item.timetableDayType}指定` : '';
      const timeSource = new Map((snapshot.stops || []).map(stop => [String(stop.station).replace(/[\s　]/g, ''), stop]));
      const changes = (item.timeChanges || []).map(change => {
        const original = timeSource.get(String(change.station).replace(/[\s　]/g, '')) || {};
        const values = [...Object.entries({arrival:'着', departure:'発', trackN:'番線'}).map(([field, label]) =>
          Object.hasOwn(change, field) && change[field] && String(change[field]) !== String(original[field] ?? '') ? `${label} ${change[field]}` : ''), change.note || ''].filter(Boolean);
        return values.length ? [change.station, ...values].join(' ') : '';
      });
      const manualNotes = snapshot.manualEntry ? (snapshot.stops || []).filter(stop => stop.note && !(item.timeChanges || []).some(change => String(change.station).replace(/[\s　]/g, '') === String(stop.station).replace(/[\s　]/g, '') && Object.hasOwn(change, 'note'))).map(stop => `${stop.station} ${stop.note}`) : [];
      const notes = [arrangementNotes(item), item.restriction, cleanRemarks(item.remarks), ...manualNotes, ...changes, source].filter(Boolean).join('\n');
      return `<tr class="state-${state}" data-index="${index}"><td class="check">${selectable
        ? `<input type="checkbox" aria-label="${escapeHtml(item.trainNumber)}を選択" data-select="${index}">` : '□'}</td>
        <td>${index + 1}</td><td>${escapeHtml(categories[item.category] || '定期等')}</td>
        <td>${escapeHtml(item.trainNumber)}</td><td>${escapeHtml(item.trainType || '―')}</td>
        <td>${escapeHtml(snapshot.origin || item.sectionStart || '―')}</td><td>${escapeHtml(snapshot.destination || item.sectionEnd || '―')}</td>
        <td>${escapeHtml(statusText(item))}</td><td>${escapeHtml(item.sectionStart || item.sectionEnd ? [item.sectionStart || '―', item.sectionEnd || '―'].join('～') : '―')}</td>
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
    if (filters.state && !activityMatches(item, filters.state)) return false;
    if (filters.line && !(item.lines || []).includes(filters.line)) return false;
    const snapshot = item.scheduleSnapshot || item;
    const text = [item.trainNumber, ...(item.trainNumbers || []), item.trainType, item.title,
      item.sectionStart, item.sectionEnd, snapshot.origin, snapshot.destination, ...(item.lines || []),
      ...(snapshot.stops || []).map(stop => stop.station), item.remarks, item.restriction, arrangementNotes(item)].join('');
    const normalized = value => String(value || '').toLowerCase().replace(/[\s　]/g, '');
    return normalized(text).includes(normalized(filters.query));
  }
  function compare(left, right, order) {
    const number = () => String(left.trainNumber).localeCompare(String(right.trainNumber), 'ja', {numeric:true});
    if (order === 'line') return String(left.lines?.[0] || '').localeCompare(String(right.lines?.[0] || ''), 'ja') || number();
    if (order === 'category') {
      const rank = item => ({planned_extra:0, extra:1, regular:2}[item.category] ?? 2);
      return rank(left) - rank(right) || number();
    }
    if (order === 'activity') {
      const rank = item => layers(item).prohibited ? 2 : {operate:0, suspend:1, unknown:3}[layers(item).base] ?? 3;
      return rank(left) - rank(right) || number();
    }
    if (order === 'time') {
      const time = item => {
        const stops = (item.scheduleSnapshot || item).stops || [];
        const first = stops[0];
        const change = (item.timeChanges || []).find(value => String(value.station).replace(/[\s　]/g, '') === String(first?.station).replace(/[\s　]/g, '')) || {};
        return (change.departure ?? first?.departure) || (change.arrival ?? first?.arrival) || '99:99';
      };
      return time(left).localeCompare(time(right)) || number();
    }
    return number();
  }
  function categoryFor(number) {
    const value = Number(String(number).match(/\d+/)?.[0] || -1);
    return value >= 6000 && value <= 8999 ? 'planned_extra' : value >= 9000 && value <= 9999 ? 'extra' : 'regular';
  }
  function timeRowsMarkup(stops, changes = [], manual = false) {
    if (!stops.length) return `<tr><td colspan="${manual ? 6 : 5}" class="empty-cell">列車時刻表はありません。手入力する場合は「駅を追加」を押してください。</td></tr>`;
    const normalized = station => String(station).replace(/[\s　]/g, '');
    const byStation = new Map(changes.map(change => [normalized(change.station), change]));
    const labels = {arrival:'着', departure:'発', trackN:'番線', note:'変更記事'};
    return stops.map((stop, index) => {
      const change = byStation.get(normalized(stop.station)) || {};
      return `<tr data-stop="${index}" data-station="${escapeHtml(stop.station)}"><td>${manual ? `<input data-field="station" value="${escapeHtml(stop.station)}" data-original="${escapeHtml(stop.station)}" maxlength="80" aria-label="駅名">` : escapeHtml(stop.station)}</td>${Object.keys(labels).map(field => {
        const original = String(field === 'note' && !manual ? '' : stop[field] ?? '');
        const value = String(change[field] ?? original);
        return `<td><input data-field="${field}" value="${escapeHtml(value)}" data-original="${escapeHtml(original)}" class="${value.trim() !== original ? 'time-modified' : ''}" aria-label="${escapeHtml(stop.station)} ${labels[field]}" title="${original ? `原簿：${escapeHtml(original)}` : ''}" maxlength="${field === 'note' ? 200 : field === 'trackN' ? 40 : 12}"></td>`;
      }).join('')}${manual ? '<td class="manual-stop-actions"><button type="button" data-stop-action="up" aria-label="駅を上へ">↑</button><button type="button" data-stop-action="down" aria-label="駅を下へ">↓</button><button type="button" data-stop-action="remove" aria-label="駅を削除">削除</button></td>' : ''}</tr>`;
    }).join('');
  }
  function configureTimeTable(table, manual) {
    table.querySelectorAll('[data-manual-column]').forEach(node => node.remove());
    table.classList.toggle('manual-time-table', manual);
    if (!manual) return;
    const doc = table.ownerDocument, col = doc.createElement('col'), th = doc.createElement('th');
    col.dataset.manualColumn = ''; col.style.width = '90px';
    th.dataset.manualColumn = ''; th.textContent = '行操作';
    table.querySelector('colgroup').append(col); table.querySelector('thead tr').append(th);
  }
  function inputTimeRows(tbody) {
    return [...tbody.querySelectorAll('tr[data-stop]')].map(row => ({index:Number(row.dataset.stop),
      values:Object.fromEntries([...row.querySelectorAll('input[data-field]')].map(input => [input.dataset.field, input.value.trim()]))}));
  }
  function renderLineRanges(container, ranges = []) {
    container.replaceChildren();
    const body = document.createElement('tbody');
    const add = (value = {}) => {
      const row = document.createElement('tr');
      row.innerHTML = ['line','start','end'].map((field, index) => `<td><input data-line-field="${field}" maxlength="80" aria-label="${['線区','自駅','至駅'][index]}" value="${escapeHtml(value[field] || '')}"></td>`).join('') + '<td><button type="button">削除</button></td>';
      row.querySelector('button').addEventListener('click', () => { row.remove(); container.dispatchEvent(new Event('input', {bubbles:true})); });
      body.append(row);
    };
    const table = document.createElement('table');
    table.className = 'daily-section-table';
    table.innerHTML = '<thead><tr><th>線区</th><th>自駅</th><th>至駅</th><th>操作</th></tr></thead>';
    table.append(body); container.append(table);
    ranges.forEach(add);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '線区を追加';
    button.addEventListener('click', () => { add(); container.dispatchEvent(new Event('input', {bubbles:true})); });
    container.append(button);
  }
  function collectLineRanges(container, stops) {
    const ranges = [...container.querySelectorAll('tbody tr')].map(row => Object.fromEntries([...row.querySelectorAll('[data-line-field]')].map(input => [input.dataset.lineField, input.value.trim()])));
    const normalize = value => String(value).replace(/[\s　]/g, '');
    const names = stops.map(stop => normalize(stop.station));
    if (ranges.length > 100) throw new Error('線区は100区間以内にしてください。');
    if (ranges.some(range => !range.line || !names.includes(normalize(range.start)) || !names.includes(normalize(range.end)))) throw new Error('線区名と、時刻表に存在する自駅・至駅を入力してください。');
    ranges.sort((a,b) => names.indexOf(normalize(a.start)) - names.indexOf(normalize(b.start)));
    let next = 0;
    for (const range of ranges) {
      const start = names.indexOf(normalize(range.start)), end = names.indexOf(normalize(range.end));
      if (start !== next || end <= start) throw new Error('線区は始発から終着まで、抜け・重複なく指定してください。');
      range.start = stops[start].station; range.end = stops[end].station; next = end;
    }
    if (ranges.length && next !== stops.length - 1) throw new Error('線区は終着駅まで指定してください。');
    return ranges;
  }
  function collectTimetable(snapshot, rows, manual) {
    const original = snapshot.stops || [], stops = [], timeChanges = [], seen = new Set();
    if (manual && rows.length > 300) throw new Error('手入力の時刻表は300駅以内にしてください。');
    for (const row of rows) {
      const old = original[row.index];
      const station = manual ? String(row.values.station || '').trim() : old?.station;
      if (!station) throw new Error('時刻表の駅名を入力してください。');
      const stationKey = String(station).replace(/[\s　]/g, '');
      if (manual && seen.has(stationKey)) throw new Error('同じ駅名を重複して入力できません。');
      seen.add(stationKey);
      const isNew = manual && (!old || stationKey !== String(old.station).replace(/[\s　]/g, ''));
      const base = isNew ? {station, ...Object.fromEntries(['arrival','departure','trackN','note'].map(field => [field,row.values[field] || '']))} : {...old, station};
      if (manual) for (const field of ['arrival','departure','trackN','note']) base[field] = String(base[field] ?? '');
      const change = {station}; let changed = false;
      for (const field of ['arrival','departure','trackN','note']) {
        change[field] = row.values[field] || '';
        if (change[field] !== String(field === 'note' && !manual ? '' : base[field] ?? '')) changed = true;
      }
      stops.push(base);
      if (changed) timeChanges.push(change);
    }
    return {stops:manual ? stops : original, timeChanges};
  }
  return {states, categories, kinds, escapeHtml, key, rowsMarkup, fromTrain, matches, compare, categoryFor, timeRowsMarkup,
    layers, withBase, activityMatches, statusText, sectionNotes, arrangementNotes, resolvedSections, parseNumbers, sectionRowMarkup, cleanRemarks,
    configureTimeTable, inputTimeRows, collectTimetable, renderLineRanges, collectLineRanges};
}));
