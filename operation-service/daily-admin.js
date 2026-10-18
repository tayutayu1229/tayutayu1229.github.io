(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const U = window.OperationDailyUtils;
  const D = window.OperationServiceAdminUtils;
  const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  let day = null, loadedDate = '', source = [], sourceType = '', sourcePeriod = '', dirty = false, editorDirty = false, editing = -1, busy = false, admin = false, pendingRow = null;
  const selected = new Set();
  const writeControls = ['saveDay', 'saveRow', 'publishDay', 'withdrawDay', 'applyState', 'addTrain', 'commitRow', 'applyDates', 'newRow', 'duplicateRow', 'clearRow'];
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
    $('updatedAt').textContent = `最終更新 ${day?.updatedAt || '―'}`;
    $('rowEditState').textContent = editorDirty ? '未反映の編集あり' : dirty ? '一覧に未保存の変更あり' : '未変更';
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
    day.items.sort((left, right) => U.compare(left, right, $('dailySort').value));
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
      check.addEventListener('change', () => { check.checked ? selected.add(index) : selected.delete(index); filterRows(); });
    });
    populateLines('dailyLine', day.items);
    filterRows(); renderCatalog(); markEditingRow(); identity();
  }
  function markEditingRow() {
    $('dailyRows').querySelectorAll('tr[data-index]').forEach(row => { row.setAttribute('aria-selected', String(Number(row.dataset.index) === editing)); });
  }
  function populateLines(id, items) {
    const previous = $(id).value;
    const lines = [...new Set(items.flatMap(item => item.lines || []))].sort((a, b) => a.localeCompare(b, 'ja'));
    markup($(id), '<option value="">すべて</option>' + lines.map(line => `<option value="${U.escapeHtml(line)}">${U.escapeHtml(line)}</option>`).join(''));
    $(id).value = lines.includes(previous) ? previous : '';
  }
  function filters(prefix) {
    return {query:$(prefix === 'catalog' ? 'catalogQuery' : 'dailyQuery').value,
      category:$(prefix + 'Category').value, line:$(prefix + 'Line').value,
      state:prefix === 'daily' ? $('dailyState').value : ''};
  }
  function filterRows() {
    if (!day) return;
    let visible = 0;
    $('dailyRows').querySelectorAll('tr[data-index]').forEach(row => {
      row.hidden = !U.matches(day.items[Number(row.dataset.index)], filters('daily'));
      if (!row.hidden) visible++;
    });
    $('dailyMeta').textContent = `表示 ${visible}／全 ${day.items.length}件　選択 ${selected.size}件`;
  }
  function openEditor(index) {
    if (busy || (editorDirty && !confirm('一覧へ反映していない行編集を破棄しますか？'))) return;
    editing = index; editorDirty = false; pendingRow = null;
    fillEditor(day.items[index]);
  }
  function fillEditor(item) {
    $('rowEditor').hidden = false;
    $('editTrain').textContent = `${item.trainNumber}　${item.timetableDayType ? `${item.timetableDayType}原簿を指定` : '施行日の原簿'}`;
    $('editState').value = item.operationState || 'unknown';
    $('editTitle').value = item.title || '日別活休';
    $('editNumber').value = item.trainNumber || '';
    $('editType').value = item.trainType || '';
    $('editKind').value = item.operationKind || 'unconfirmed';
    $('editOrigin').value = item.scheduleSnapshot?.origin || item.sectionStart || '';
    $('editDestination').value = item.scheduleSnapshot?.destination || item.sectionEnd || '';
    $('editLines').value = (item.lines || []).join('、');
    $('rowDates').textContent = `作成日時 ${item.createdAt || '―'}　更新日時 ${item.updatedAt || '―'}`;
    $('editStart').value = item.sectionStart || '';
    $('editEnd').value = item.sectionEnd || '';
    $('editRemarks').value = item.remarks || '';
    $('editRestriction').value = item.restriction || '';
    const stops = item.scheduleSnapshot?.stops || [];
    markup($('stationChoices'), stops.map(stop => `<option value="${U.escapeHtml(stop.station)}"></option>`).join(''));
    markup($('dailyTimeRows'), U.timeRowsMarkup(stops, item.timeChanges || []));
    $('dailyTimeWrap').scrollTop = 0;
    markEditingRow(); identity();
  }
  function commitEditor() {
    if (editing < 0 && !pendingRow) return;
    const item = pendingRow || day.items[editing];
    const number = $('editNumber').value.trim();
    if (!number) throw new Error('列車番号を入力してください。');
    if (day.items.some((other, index) => index !== editing && U.key(other) === U.key({trainNumber:number}))) throw new Error('同じ列車番号は既に一覧にあります。既存行を編集してください。');
    const start = $('editStart').value.trim(), end = $('editEnd').value.trim();
    if (!start || !end) throw new Error('適用区間の始点・終点を入力してください。');
    item.operationState = $('editState').value;
    item.operationKind = $('editKind').value;
    item.title = $('editTitle').value.trim() || '日別活休';
    item.trainType = $('editType').value.trim();
    if (U.key(item) !== U.key({trainNumber:number})) {
      item.scheduleKey = ''; item.diagramPeriodId = ''; delete item.source; delete item.id; delete item.timetableWarning;
    }
    item.trainNumber = number; item.category = U.categoryFor(number);
    item.lines = $('editLines').value.split(/[、,]/).map(line => line.trim()).filter(Boolean);
    item.scheduleSnapshot = {...item.scheduleSnapshot, trainNumber:number, trainType:item.trainType,
      origin:$('editOrigin').value.trim(), destination:$('editDestination').value.trim(), lines:item.lines};
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
    if (pendingRow) day.items.push(item);
    pendingRow = null; dirty = true; editorDirty = false; editing = day.items.indexOf(item);
    $('editTrain').textContent = `${item.trainNumber}　${item.timetableDayType ? `${item.timetableDayType}原簿を指定` : '施行日の原簿'}`;
    render();
  }
  async function loadCatalog() {
    requireDay();
    const requestedType = $('sourceDayType').value;
    const params = new URLSearchParams({serviceDate:loadedDate});
    if (requestedType) params.set('dayType', requestedType);
    const requestedPeriod = $('sourcePeriod').value;
    if (requestedPeriod) params.set('diagramPeriodId', requestedPeriod);
    const result = await api(`/api/operation-service/catalog?${params}`);
    source = result.items || []; sourceType = requestedType; sourcePeriod = requestedPeriod;
    const periods = result.availableDiagramPeriods || [];
    markup($('sourcePeriod'), '<option value="">日付から自動選択</option>' + periods.map(period => `<option value="${U.escapeHtml(period.id)}">${U.escapeHtml(period.name)}${period.active ? '（適用中）' : '（切替期間）'}</option>`).join(''));
    $('sourcePeriod').value = periods.some(period => period.id === requestedPeriod) ? requestedPeriod : '';
    sourcePeriod = $('sourcePeriod').value;
    populateLines('catalogLine', source);
    $('periodText').textContent = result.diagramPeriod?.name || result.diagramPeriod?.id || '';
    renderCatalog();
  }
  function renderCatalog() {
    const candidates = source.map((train, index) => ({train, index})).filter(({train}) => U.matches(train, filters('catalog')))
      .sort((a, b) => U.compare(a.train, b.train, $('catalogSort').value));
    const existing = new Map((day?.items || []).map(item => [U.key(item), item.operationState]));
    markup($('catalogTrain'), candidates.map(({train, index}) => `<option value="${index}">${U.escapeHtml(train.trainNumber)}　${U.escapeHtml(U.categories[train.category] || '')}　${U.escapeHtml(train.trainType)}　${U.escapeHtml(train.origin)}～${U.escapeHtml(train.destination)}　${U.escapeHtml((train.lines || []).join('・'))}　${U.states[existing.get(U.key(train))] || '未登録'}</option>`).join(''));
    $('catalogMeta').textContent = `候補 ${candidates.length}／原簿 ${source.length}列車`;
  }
  async function loadDay(discard = true) {
    if (discard && (dirty || editorDirty) && !confirm('未保存の変更を破棄して、日付を開き直しますか？')) return;
    const date = D.normalizeDate($('dayDate').value);
    if (!date) throw new Error('施行日を正しいYYYY/MM/DD形式で入力してください。');
    const result = await api(`/api/operation-service/daily?serviceDate=${date}`);
    day = result; loadedDate = date; dirty = false; editorDirty = false; editing = -1; pendingRow = null; selected.clear();
    source = []; sourceType = ''; sourcePeriod = '';
    $('rowEditor').hidden = true; $('commonRemarks').value = day.commonRemarks;
    $('applyDateStart').value = date; $('applyDateEnd').value = date;
    $('applyDateList').replaceChildren();
    render(); await loadCatalog();
    message(day.legacy ? '旧列車別データを読み取りました。保存・日別発表をするまでは、旧公開情報を変更しません。' : '日別下書きを読み込みました。公開側は最後に発表した版です。');
  }
  async function saveDay() {
    requireDay();
    if (editorDirty) commitEditor();
    const result = await api('/api/operation-service/daily/save', {serviceDate:loadedDate, version:day.version,
      commonRemarks:$('commonRemarks').value, items:day.items});
    day.version = result.version; day.commonRemarks = $('commonRemarks').value; dirty = false;
    await refreshTimestamp();
    message('日別下書きを保存しました。公開側はまだ変更していません。');
  }
  async function refreshTimestamp() {
    day.updatedAt = '';
    try {
      const audit = await api(`/api/operation-service/daily/audit?serviceDate=${loadedDate}`);
      day.updatedAt = audit.items.find(item => item.version === day.version)?.occurredAt || '';
    }
    catch (_) { /* The write already succeeded; a failed metadata read must not suggest otherwise. */ }
  }
  $('loadDay').addEventListener('click', () => run(() => loadDay()));
  $('loadCatalog').addEventListener('click', () => run(loadCatalog));
  $('catalogQuery').addEventListener('input', renderCatalog);
  for (const id of ['catalogCategory', 'catalogLine', 'catalogSort']) $(id).addEventListener('change', renderCatalog);
  for (const id of ['dailyQuery', 'dailyCategory', 'dailyState', 'dailyLine']) $(id).addEventListener(id === 'dailyQuery' ? 'input' : 'change', filterRows);
  $('dailySort').addEventListener('change', () => { if (day) render(); });
  $('editState').addEventListener('change', () => { $('editKind').value = U.kinds[$('editState').value]; });
  function newEditor(copy) {
    requireDay();
    if (editorDirty && !confirm('行の未反映の編集を破棄しますか？')) return;
    pendingRow = copy ? JSON.parse(JSON.stringify(copy)) : U.fromTrain({trainNumber:'', trainType:'', origin:'', destination:'', stops:[]});
    if (copy) { pendingRow.trainNumber = ''; pendingRow.scheduleKey = ''; pendingRow.diagramPeriodId = ''; delete pendingRow.source; delete pendingRow.id; delete pendingRow.createdAt; delete pendingRow.updatedAt; }
    editing = -1; editorDirty = true; fillEditor(pendingRow); $('editNumber').focus();
    message(copy ? '複製元の保存済み内容をコピーしました。別の列車番号を入力してください。時刻表もコピーされるため、確認・修正してください。' : '原簿にない列車も入力できます。列車番号と区間を入力してください。');
  }
  $('newRow').addEventListener('click', () => run(async () => newEditor()));
  $('duplicateRow').addEventListener('click', () => run(async () => newEditor(pendingRow || day.items[editing])));
  $('clearRow').addEventListener('click', () => { if (!admin || busy) return; $('editState').value = 'unknown'; $('editKind').value = 'unconfirmed'; editorDirty = true; identity(); });
  $('selectCatalogAll').addEventListener('click', () => [...$('catalogTrain').options].forEach(option => { option.selected = true; }));
  $('clearCatalogSelection').addEventListener('click', () => [...$('catalogTrain').options].forEach(option => { option.selected = false; }));
  $('saveDay').addEventListener('click', () => run(saveDay));
  $('saveRow').addEventListener('click', () => run(saveDay));
  $('commonRemarks').addEventListener('input', () => { dirty = true; identity(); });
  $('rowEditor').addEventListener('input', () => { editorDirty = true; identity(); });
  $('dailyTimeRows').addEventListener('input', event => {
    if (event.target.matches('input[data-field]')) event.target.classList.toggle('time-modified', event.target.value.trim() !== event.target.dataset.original);
  });
  $('dailyTimeRows').addEventListener('focusin', event => { if (event.target.matches('input[data-field]')) event.target.select(); });
  $('commitRow').addEventListener('click', () => run(async () => { requireDay(); commitEditor(); message('編集を一覧へ反映しました。下書き保存はまだ行っていません。'); }));
  $('cancelRow').addEventListener('click', () => {
    if (!editorDirty || confirm('行の未反映の編集を破棄しますか？')) { editing = -1; pendingRow = null; editorDirty = false; $('rowEditor').hidden = true; markEditingRow(); identity(); }
  });
  $('selectAll').addEventListener('click', () => { if (!day) return; day.items.forEach((item, index) => { if (U.matches(item, filters('daily'))) selected.add(index); }); render(); });
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
    if ($('sourceDayType').value !== sourceType || $('sourcePeriod').value !== sourcePeriod) throw new Error('原簿種類・改正を変更した場合は、追加用原簿を読み込み直してください。');
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
      day.noticeNumber = result.noticeNumber; day.publishedStatus = result.status; day.updatedAt = result.publishedAt;
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
    if (current) { day.version = current.version; await refreshTimestamp(); }
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
