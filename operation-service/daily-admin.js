(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const U = window.OperationDailyUtils;
  const D = window.OperationServiceAdminUtils;
  const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  let day = null, loadedDate = '', source = [], sourceType = '', dirty = false, editorDirty = false, editing = -1, busy = false, admin = false;
  const selected = new Set();
  const writeControls = ['saveDay', 'publishDay', 'withdrawDay', 'applyState', 'addTrain', 'commitRow', 'applyDates'];
  function markup(element, html) {
    const range = document.createRange(); range.selectNodeContents(element);
    element.replaceChildren(range.createContextualFragment(html));
  }
  function message(text, error = false) {
    $('dayMessage').textContent = text;
    $('dayMessage').className = `message${error ? ' error' : ''}`;
  }
  function identity() {
    $('dayIdentity').textContent = day ? `${day.noticeNumber || '未採番'}／発表第${day.edition}版／下書き v${day.version}${dirty || editorDirty ? '（未保存）' : day.version !== day.publishedVersion ? '（未発表の下書き）' : ''}` : '未読込';
  }
  async function api(path, body) {
    const options = {cache:'no-store', credentials:'include', headers:{Accept:'application/json'}};
    if (body !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    options.headers.Authorization = `Bearer ${await window.TayunetFirebaseDataAuth.getIdToken()}`;
    let response = await fetch(origin + path, options);
    if (response.status === 401) {
      options.headers.Authorization = `Bearer ${await window.TayunetFirebaseDataAuth.getIdToken(true)}`;
      response = await fetch(origin + path, options);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? '別の画面で更新されています。未保存の内容を控え、日付を開き直してください。' : payload.error || `HTTP ${response.status}`);
    return payload;
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('#main-content button, #main-content input, #main-content select, #main-content textarea').forEach(el => { el.disabled = true; });
    $('dailyStatus').textContent = '処理中…';
    try { await action(); $('dailyStatus').textContent = day ? `${loadedDate}　${day.items.length}列車` : '未読込'; }
    catch (error) { message(error.message, true); $('dailyStatus').textContent = '処理失敗（入力内容は画面に保持しています）'; }
    finally {
      busy = false;
      document.querySelectorAll('#main-content button, #main-content input, #main-content select, #main-content textarea').forEach(el => { el.disabled = false; });
      writeControls.forEach(id => { $(id).disabled = !admin; });
      identity();
    }
  }
  function requireDay() {
    if (!day || D.normalizeDate($('dayDate').value) !== loadedDate) throw new Error('施行日を変更した場合は、先に「日付を開く」を押してください。');
  }
  function requireSaved() {
    requireDay();
    if (dirty || editorDirty || !day.version) throw new Error('先に行の編集を一覧へ反映し、「日別下書き保存」を押してください。');
  }
  function render() {
    const selectedNumbers = new Set([...selected].map(index => U.key(day.items[index])));
    const editedNumber = editing >= 0 ? U.key(day.items[editing]) : null;
    day.items.sort((left, right) => U.key(left) < U.key(right) ? -1 : U.key(left) > U.key(right) ? 1 : 0);
    selected.clear();
    day.items.forEach((item, index) => { if (selectedNumbers.has(U.key(item))) selected.add(index); });
    if (editedNumber) editing = day.items.findIndex(item => U.key(item) === editedNumber);
    markup($('dailyRows'), U.rowsMarkup(day.items, true) || '<tr><td colspan="10">対象列車がありません。原簿から追加してください。</td></tr>');
    $('dailyRows').querySelectorAll('tr[data-index]').forEach(row => {
      const index = Number(row.dataset.index);
      row.tabIndex = 0;
      row.addEventListener('click', event => { if (!event.target.matches('input')) openEditor(index); });
      row.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target === row) openEditor(index); });
      const check = row.querySelector('input');
      check.checked = selected.has(index);
      check.addEventListener('change', () => { check.checked ? selected.add(index) : selected.delete(index); });
    });
    identity();
  }
  function openEditor(index) {
    if (busy || (editorDirty && !confirm('一覧へ反映していない行編集を破棄しますか？'))) return;
    editing = index; editorDirty = false;
    const item = day.items[index];
    $('rowEditor').hidden = false;
    $('editTrain').textContent = `${item.trainNumber}　${item.timetableDayType ? `${item.timetableDayType}原簿を指定` : '施行日の原簿'}`;
    $('editState').value = item.operationState || 'unknown';
    $('editStart').value = item.sectionStart || '';
    $('editEnd').value = item.sectionEnd || '';
    $('editRemarks').value = item.remarks || '';
    $('editRestriction').value = item.restriction || '';
    const stops = item.scheduleSnapshot?.stops || [];
    markup($('stationChoices'), stops.map(stop => `<option value="${U.escapeHtml(stop.station)}"></option>`).join(''));
    const changes = new Map((item.timeChanges || []).map(change => [String(change.station).replace(/[\s　]/g, ''), change]));
    markup($('dailyTimeRows'), stops.map((stop, i) => {
      const change = changes.get(String(stop.station).replace(/[\s　]/g, '')) || {};
      return `<tr data-stop="${i}"><td>${U.escapeHtml(stop.station)}</td>${['arrival', 'departure', 'trackN', 'note'].map(field => `<td><input data-field="${field}" value="${U.escapeHtml(change[field] ?? (field === 'note' ? '' : stop[field]) ?? '')}" data-original="${U.escapeHtml(field === 'note' ? '' : stop[field] || '')}"></td>`).join('')}</tr>`;
    }).join(''));
    identity();
  }
  function commitEditor() {
    if (editing < 0) return;
    const item = day.items[editing];
    const start = $('editStart').value.trim(), end = $('editEnd').value.trim();
    if (!start || !end) throw new Error('適用区間の始点・終点を入力してください。');
    item.operationState = $('editState').value;
    item.operationKind = U.kinds[item.operationState];
    item.sectionStart = start; item.sectionEnd = end;
    item.remarks = $('editRemarks').value; item.restriction = $('editRestriction').value;
    item.timeChanges = [...$('dailyTimeRows').querySelectorAll('tr[data-stop]')].map(row => {
      const values = {station:item.scheduleSnapshot.stops[Number(row.dataset.stop)].station};
      let changed = false;
      row.querySelectorAll('input').forEach(input => {
        values[input.dataset.field] = input.value.trim();
        if (values[input.dataset.field] !== input.dataset.original) changed = true;
      });
      return changed ? values : null;
    }).filter(Boolean);
    dirty = true; editorDirty = false; editing = -1; $('rowEditor').hidden = true; render();
  }
  async function loadCatalog() {
    requireDay();
    const requestedType = $('sourceDayType').value;
    const params = new URLSearchParams({serviceDate:loadedDate});
    if (requestedType) params.set('dayType', requestedType);
    const result = await api(`/api/operation-service/catalog?${params}`);
    source = result.items || []; sourceType = requestedType;
    renderCatalog();
  }
  function renderCatalog() {
    const query = $('catalogQuery').value.toLowerCase().replace(/[\s　]/g, '');
    markup($('catalogTrain'), source.map((train, index) => ({train, index})).filter(({train}) => !query ||
      [train.trainNumber, train.origin, train.destination, ...(train.lines || [])].join(' ').toLowerCase().replace(/[\s　]/g, '').includes(query)
    ).map(({train, index}) => `<option value="${index}">${U.escapeHtml(train.trainNumber)}　${U.escapeHtml(train.origin)}～${U.escapeHtml(train.destination)}</option>`).join(''));
  }
  async function loadDay(discard = true) {
    if (discard && (dirty || editorDirty) && !confirm('未保存の変更を破棄して、日付を開き直しますか？')) return;
    const date = D.normalizeDate($('dayDate').value);
    if (!date) throw new Error('施行日を正しいYYYY/MM/DD形式で入力してください。');
    const result = await api(`/api/operation-service/daily?serviceDate=${date}`);
    day = result; loadedDate = date; dirty = false; editorDirty = false; editing = -1; selected.clear();
    $('rowEditor').hidden = true; $('commonRemarks').value = day.commonRemarks;
    $('applyDateStart').value = date; $('applyDateEnd').value = date;
    $('applyDateList').replaceChildren();
    render(); await loadCatalog();
    message(day.legacy ? '旧列車別データを読み取りました。保存・日別発表をするまでは、旧公開情報を変更しません。' : '日別下書きを読み込みました。公開側は最後に発表した版です。');
  }
  async function saveDay() {
    requireDay();
    if (editorDirty) throw new Error('先に「編集を一覧へ反映」を押してください。');
    const result = await api('/api/operation-service/daily/save', {serviceDate:loadedDate, version:day.version,
      commonRemarks:$('commonRemarks').value, items:day.items});
    day.version = result.version; day.commonRemarks = $('commonRemarks').value; dirty = false;
    message('日別下書きを保存しました。公開側はまだ変更していません。');
  }
  $('loadDay').addEventListener('click', () => run(() => loadDay()));
  $('loadCatalog').addEventListener('click', () => run(loadCatalog));
  $('catalogQuery').addEventListener('input', renderCatalog);
  $('selectCatalogAll').addEventListener('click', () => [...$('catalogTrain').options].forEach(option => { option.selected = true; }));
  $('saveDay').addEventListener('click', () => run(saveDay));
  $('commonRemarks').addEventListener('input', () => { dirty = true; identity(); });
  $('rowEditor').addEventListener('input', () => { editorDirty = true; identity(); });
  $('commitRow').addEventListener('click', () => run(async () => { requireDay(); commitEditor(); }));
  $('cancelRow').addEventListener('click', () => {
    if (!editorDirty || confirm('行の未反映の編集を破棄しますか？')) { editing = -1; editorDirty = false; $('rowEditor').hidden = true; identity(); }
  });
  $('selectAll').addEventListener('click', () => { if (!day) return; day.items.forEach((_, index) => selected.add(index)); render(); });
  $('selectNone').addEventListener('click', () => { selected.clear(); if (day) render(); });
  $('applyState').addEventListener('click', () => run(async () => {
    requireDay();
    if (editorDirty) throw new Error('先に行の編集を一覧へ反映してください。');
    if (!selected.size) throw new Error('対象行を選択してください。');
    selected.forEach(index => {
      day.items[index].operationState = $('bulkState').value;
      day.items[index].operationKind = U.kinds[$('bulkState').value];
    });
    editing = -1; $('rowEditor').hidden = true; dirty = true; render();
    message('選択行へ反映しました。未入力への変更も、日全体を再発表するまでは公開されません。');
  }));
  $('addTrain').addEventListener('click', () => run(async () => {
    requireDay();
    if ($('sourceDayType').value !== sourceType) throw new Error('原簿種類を変更した場合は、追加用原簿を読み込み直してください。');
    const trains = [...$('catalogTrain').selectedOptions].map(option => source[Number(option.value)]).filter(Boolean);
    if (!trains.length) throw new Error('追加する列車を選んでください。');
    const existing = new Set(day.items.map(U.key));
    let added = 0;
    for (const train of trains) {
      if (existing.has(U.key(train))) continue;
      day.items.push(U.fromTrain(train, sourceType)); existing.add(U.key(train)); added++;
    }
    if (added) dirty = true;
    render();
    message(`${added}列車を追加、既存${trains.length - added}列車は変更せずスキップしました。別曜日の原簿を指定した場合、その出典を備考に表示します。`);
  }));
  $('previewDay').addEventListener('click', () => {
    try {
      requireSaved();
      window.open(`daily-notice.html?serviceDate=${loadedDate}&draft=1`, '_blank', 'noopener');
    } catch (error) { message(error.message, true); }
  });
  for (const [id, action] of [['publishDay', 'publish'], ['withdrawDay', 'withdraw']]) {
    $(id).addEventListener('click', () => run(async () => {
      requireSaved();
      if (!confirm(`${loadedDate}の一覧全体を${action === 'publish' ? '発表' : '取下げ'}します。よろしいですか？`)) return;
      const result = await api('/api/operation-service/daily/publish', {serviceDate:loadedDate, version:day.version, action});
      day.version = result.version; day.publishedVersion = result.version; day.edition = result.edition;
      day.noticeNumber = result.noticeNumber; day.publishedStatus = result.status;
      message(`${result.noticeNumber} 第${result.edition}版を${action === 'publish' ? '発表' : '取下げ'}しました。`);
    }));
  }
  $('applyDateMode').addEventListener('change', () => {
    const mode = $('applyDateMode').value;
    $('rangeEndLabel').hidden = mode !== 'range';
    for (const id of ['addApplyDate', 'applyDateList', 'removeApplyDate']) $(id).hidden = mode !== 'multiple';
  });
  $('addApplyDate').addEventListener('click', () => {
    const date = D.normalizeDate($('applyDateStart').value);
    if (!date) { message('追加する日付を選んでください。', true); return; }
    if (![...$('applyDateList').options].some(option => option.value === date)) $('applyDateList').add(new Option(date, date));
  });
  $('removeApplyDate').addEventListener('click', () => [...$('applyDateList').selectedOptions].forEach(option => option.remove()));
  $('applyDates').addEventListener('click', () => run(async () => {
    requireSaved();
    if (!selected.size) throw new Error('反映する列車の行を選択してください。');
    const selection = D.dateSelectionResult({mode:$('applyDateMode').value, single:$('applyDateStart').value,
      start:$('applyDateStart').value, end:$('applyDateEnd').value, dates:[...$('applyDateList').options].map(option => option.value)});
    if (!selection.ok) throw new Error(selection.message);
    const spec = selection.spec;
    const dates = spec.serviceDates || [];
    if (spec.serviceDateMode === 'range') {
      const first = new Date(spec.serviceDateStart + 'T00:00:00Z'), last = new Date(spec.serviceDateEnd + 'T00:00:00Z');
      if ((last - first) / 86400000 > 365) throw new Error('期間は366日以内にしてください。');
      for (let stamp = +first; stamp <= +last; stamp += 86400000) dates.push(new Date(stamp).toISOString().slice(0, 10));
    }
    if (!dates.length || dates.length > 366) throw new Error('対象日は1～366日で指定してください。');
    if (!confirm(`${selected.size}列車を${dates.length}日分の下書きへ反映します。発表は行いません。よろしいですか？`)) return;
    const versions = {};
    for (let index = 0; index < dates.length; index += 4) {
      $('dailyStatus').textContent = `対象日の競合確認 ${index}/${dates.length}`;
      await Promise.all(dates.slice(index, index + 4).map(async date => { versions[date] = (await api(`/api/operation-service/daily?serviceDate=${date}`)).version; }));
    }
    $('dailyStatus').textContent = `保存中：${selected.size}列車 × ${dates.length}日。全対象をまとめて確定しています…`;
    const result = await api('/api/operation-service/daily/apply', {...spec, versions, items:[...selected].map(index => day.items[index])});
    const current = result.items.find(item => item.serviceDate === loadedDate);
    if (current) day.version = current.version;
    message(`${result.items.length}日分の下書きへ保存しました。各日を開いて確認し、日別に発表してください。`);
  }));
  window.addEventListener('beforeunload', event => { if (dirty || editorDirty) { event.preventDefault(); event.returnValue = ''; } });
  (async () => {
    $('dayDate').value = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo'}).format(new Date());
    const ready = await window.TayunetAuthReady;
    if (!ready.ok) return;
    admin = ready.profile.isAdmin === true;
    $('operatorName').textContent = admin ? '管理者' : '閲覧権限';
    await run(() => loadDay(false));
  })().catch(error => message(error.message, true));
}());
