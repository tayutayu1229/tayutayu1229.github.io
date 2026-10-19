(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const U = window.OperationDailyUtils;
  const D = window.OperationServiceAdminUtils;
  const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  let day = null, loadedDate = '', source = [], sourceType = '', sourcePeriod = '', dirty = false, editorDirty = false, editing = -1, busy = false, admin = false, pendingRow = null, manualTimetable = false;
  const selected = new Set();
  const writeControls = ['saveDay', 'saveRow', 'withdrawDay', 'applyState', 'addTrain', 'commitRow', 'applyDates', 'newRow', 'duplicateRow', 'clearRow', 'addSection', 'bulkOperate', 'bulkSuspend', 'numberOperate', 'numberSuspend', 'createTimetable', 'addStop'];
  function markup(element, html) {
    const range = document.createRange(); range.selectNodeContents(element);
    element.replaceChildren(range.createContextualFragment(html));
  }
  function message(text, error = false) {
    $('dayMessage').textContent = text;
    $('dayMessage').className = `message${error ? ' error' : ''}`;
  }
  function identity() {
    $('dayIdentity').textContent = day ? `${day.noticeNumber || '未採番'}／公開第${day.edition}版／v${day.version}${dirty || editorDirty ? '（未保存）' : day.version !== day.publishedVersion ? '（未公開の旧下書きあり・保存で公開）' : ''}` : '未読込';
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
    if (!response.ok) throw new Error(response.status === 409 ? '別の画面で更新されています。未保存の内容を控え、日付を開き直してください。' : payload.error === 'daily_workflow_update_required' ? '新しい保存方式に切り替わっています。入力内容を控え、画面を再読み込みしてください。' : payload.error || `HTTP ${response.status}`);
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
    if (dirty || editorDirty || !day.version) throw new Error('先に「保存（公開も自動更新）」を押してください。');
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
    manualTimetable = item.scheduleSnapshot?.manualEntry === true;
    $('editTrain').textContent = `${item.trainNumber}　${manualTimetable ? '手入力の時刻表' : item.timetableDayType ? `${item.timetableDayType}原簿を指定` : '施行日の原簿'}`;
    const layers = U.layers(item);
    $('editState').value = layers.base;
    $('editTimeChanged').checked = layers.timeChanged;
    $('editProhibited').checked = layers.prohibited;
    markup($('sectionRows'), '');
    layers.sections.forEach(addSectionRow);
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
    renderTimeTable(stops, item.timeChanges || []);
    U.renderLineRanges($('manualLineRanges'), item.scheduleSnapshot?.lineRanges || []);
    $('dailyTimeWrap').scrollTop = 0;
    markEditingRow(); identity();
  }
  function renderTimeTable(stops, changes) {
    U.configureTimeTable($('dailyTimeTable'), manualTimetable);
    markup($('dailyTimeRows'), U.timeRowsMarkup(stops, changes, manualTimetable));
    $('timeEntryMode').textContent = manualTimetable ? '手入力：駅名・所定時刻を入力できます。元原簿は変更しません。' : '原簿基準：変更する時刻だけ上書き';
  }
  function enableManualTimetable(clear = false) {
    const item = pendingRow || day?.items[editing];
    if (!item) throw new Error('編集する列車を開いてください。');
    if (clear) {
      if ($('dailyTimeRows').querySelector('tr[data-stop]') && !confirm('表示中の時刻表を空にして新規作成します。元原簿は変更しません。よろしいですか？')) return false;
      manualTimetable = true; renderTimeTable([], []);
      U.renderLineRanges($('manualLineRanges'), []);
    } else if (!manualTimetable) {
      const current = U.collectTimetable(item.scheduleSnapshot || {}, U.inputTimeRows($('dailyTimeRows')), false);
      manualTimetable = true; renderTimeTable(current.stops, current.timeChanges);
    }
    return true;
  }
  function appendStop() {
    if ($('dailyTimeRows').querySelectorAll('tr[data-stop]').length >= 300) throw new Error('手入力の時刻表は300駅以内にしてください。');
    if (!enableManualTimetable()) return;
    $('dailyTimeRows').querySelectorAll('tr:not([data-stop])').forEach(row => row.remove());
    const holder = document.createElement('tbody'); markup(holder, U.timeRowsMarkup([{station:''}], [], true));
    const row = holder.firstElementChild; row.dataset.stop = '-1'; $('dailyTimeRows').append(row);
    editorDirty = true; identity(); row.querySelector('input').focus();
  }
  $('createTimetable').addEventListener('click', () => { if (!admin || busy) return; try { if (enableManualTimetable(true)) appendStop(); } catch (error) { message(error.message, true); } });
  $('addStop').addEventListener('click', () => { if (!admin || busy) return; try { appendStop(); } catch (error) { message(error.message, true); } });
  $('dailyTimeRows').addEventListener('click', event => {
    const button = event.target.closest('button[data-stop-action]');
    if (!button || !admin || busy) return;
    const row = button.closest('tr'), tbody = $('dailyTimeRows');
    if (button.dataset.stopAction === 'remove') row.remove();
    if (button.dataset.stopAction === 'up' && row.previousElementSibling) tbody.insertBefore(row, row.previousElementSibling);
    if (button.dataset.stopAction === 'down' && row.nextElementSibling) tbody.insertBefore(row.nextElementSibling, row);
    editorDirty = true; identity();
  });
  function commitEditor() {
    if (editing < 0 && !pendingRow) return;
    const item = {...(pendingRow || day.items[editing])};
    const number = $('editNumber').value.trim();
    if (!number) throw new Error('列車番号を入力してください。');
    if (day.items.some((other, index) => index !== editing && U.key(other) === U.key({trainNumber:number}))) throw new Error('同じ列車番号は既に一覧にあります。既存行を編集してください。');
    const start = $('editStart').value.trim(), end = $('editEnd').value.trim();
    item.baseActivity = $('editState').value;
    item.timeChanged = $('editTimeChanged').checked;
    item.prohibited = $('editProhibited').checked;
    const overrides = [...$('sectionRows').querySelectorAll('tr')].map(row => Object.fromEntries(
      [...row.querySelectorAll('[data-section-field]')].map(input => [input.dataset.sectionField, input.value.trim()])));
    if (overrides.some(section => !section.start || !section.end || section.start === section.end)) throw new Error('区間指定の自・至に異なる駅を入力してください。');
    item.sectionOverrides = overrides;
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
    const timetable = U.collectTimetable(item.scheduleSnapshot, U.inputTimeRows($('dailyTimeRows')), manualTimetable);
    item.timeChanges = timetable.timeChanges;
    if (manualTimetable) {
      const lineRanges = U.collectLineRanges($('manualLineRanges'), timetable.stops);
      item.scheduleSnapshot = {...item.scheduleSnapshot, manualEntry:true, stops:timetable.stops,
        lineRanges,
        origin:item.scheduleSnapshot.origin || timetable.stops[0]?.station || '', destination:item.scheduleSnapshot.destination || timetable.stops[timetable.stops.length - 1]?.station || ''};
      item.scheduleKey = ''; item.timetableDayType = '';
      delete item.source;
      $('editOrigin').value = item.scheduleSnapshot.origin; $('editDestination').value = item.scheduleSnapshot.destination;
      if (lineRanges.length) { item.lines = [...new Set(lineRanges.map(range => range.line))]; $('editLines').value = item.lines.join('、'); }
    }
    item.operationState = U.withBase(item, item.baseActivity).operationState;
    if (item.operationKind !== 'other') item.operationKind = item.prohibited ? 'prohibition' : item.sectionOverrides.length ? 'partial' : item.timeChanged ? 'time_change' : U.kinds[item.baseActivity];
    if (pendingRow) day.items.push(item); else day.items[editing] = item;
    pendingRow = null; dirty = true; editorDirty = false; editing = day.items.indexOf(item);
    $('editTrain').textContent = `${item.trainNumber}　${manualTimetable ? '手入力の時刻表' : item.timetableDayType ? `${item.timetableDayType}原簿を指定` : '施行日の原簿'}`;
    if (manualTimetable) { const scroll = $('dailyTimeWrap').scrollTop; renderTimeTable(timetable.stops, item.timeChanges); $('dailyTimeWrap').scrollTop = scroll; }
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
    message(day.legacy ? '旧情報を読み取りました。保存すると、この日全体を日別通達として公開更新します。開くだけでは変更しません。' : '保存すると、この日全体の公開一覧・PDFも更新します。未公開の旧下書きがある場合、その内容も保存時に公開されます。');
  }
  async function saveDay() {
    requireDay();
    if (editorDirty) commitEditor();
    const result = await api('/api/operation-service/daily/commit', {serviceDate:loadedDate, version:day.version,
      commonRemarks:$('commonRemarks').value, items:day.items});
    day.version = result.version; day.publishedVersion = result.version; day.edition = result.edition;
    day.noticeNumber = result.noticeNumber; day.publishedStatus = result.status; day.updatedAt = result.publishedAt;
    day.commonRemarks = $('commonRemarks').value; day.legacy = false; dirty = false;
    selected.clear(); render();
    message(`保存し、公開一覧・PDFを更新しました。${result.noticeNumber} 第${result.edition}版`);
  }
  function addSectionRow(section = {}) {
    const row = document.createElement('tr');
    markup(row, U.sectionRowMarkup(section));
    row.querySelector('select').value = section.state || 'suspend';
    row.querySelector('button').addEventListener('click', () => { if (!admin || busy) return; row.remove(); editorDirty = true; identity(); });
    $('sectionRows').append(row);
  }
  $('addSection').addEventListener('click', () => {
    if (!admin || busy) return;
    if ($('sectionRows').children.length >= 100) { message('区間指定は100件以内にしてください。', true); return; }
    addSectionRow(); editorDirty = true; identity();
  });
  $('loadDay').addEventListener('click', () => run(() => loadDay()));
  $('loadCatalog').addEventListener('click', () => run(loadCatalog));
  $('catalogQuery').addEventListener('input', renderCatalog);
  for (const id of ['catalogCategory', 'catalogLine', 'catalogSort']) $(id).addEventListener('change', renderCatalog);
  for (const id of ['dailyQuery', 'dailyCategory', 'dailyState', 'dailyLine']) $(id).addEventListener(id === 'dailyQuery' ? 'input' : 'change', filterRows);
  $('dailySort').addEventListener('change', () => { if (day) render(); });
  $('editState').addEventListener('change', () => { $('editKind').value = U.kinds[$('editState').value]; });
  $('editKind').addEventListener('change', () => {
    const kind = $('editKind').value;
    if (kind === 'operation' || kind === 'suspension' || kind === 'unconfirmed') $('editState').value = {operation:'operate', suspension:'suspend', unconfirmed:'unknown'}[kind];
    if (kind === 'time_change') $('editTimeChanged').checked = true;
    if (kind === 'prohibition') $('editProhibited').checked = true;
    editorDirty = true; identity();
  });
  function newEditor(copy) {
    requireDay();
    if (editorDirty && !confirm('行の未反映の編集を破棄しますか？')) return;
    pendingRow = copy ? JSON.parse(JSON.stringify(copy)) : U.fromTrain({trainNumber:'', trainType:'', origin:'', destination:'', stops:[]});
    pendingRow.scheduleSnapshot = {...pendingRow.scheduleSnapshot, manualEntry:true};
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
  $('commitRow').addEventListener('click', () => run(async () => { requireDay(); commitEditor(); selected.clear(); render(); message('編集を一覧へ反映しました。まだ保存・公開更新していません。'); }));
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
      day.items[index] = U.withBase(day.items[index], $('bulkState').value);
    });
    selected.clear(); editing = -1; $('rowEditor').hidden = true; dirty = true; render();
    message('選択行の基本活休へ反映しました。時刻変更・区間指定は維持します。「保存」で公開も更新します。');
  }));
  async function bulkSave(state, byNumbers) {
    requireDay();
    if (editorDirty) commitEditor();
    let targets;
    if (byNumbers) {
      if ($('sourceDayType').value !== sourceType || $('sourcePeriod').value !== sourcePeriod) throw new Error('追加用原簿を読み込み直してください。');
      const numbers = U.parseNumbers($('bulkNumbers').value);
      if (!numbers.length || numbers.length > 5000) throw new Error('列車番号を1～5000件入力してください。');
      const existing = new Map(day.items.map(item => [U.key(item), item]));
      const catalog = new Map(source.map(train => [U.key(train), train]));
      const missing = numbers.filter(number => !existing.has(U.key({trainNumber:number})) && !catalog.has(U.key({trainNumber:number})));
      if (missing.length) throw new Error(`該当しない列車番号（処理は行っていません）：${missing.join('、')}`);
      targets = [...new Set(numbers.map(number => U.key({trainNumber:number})))].map(number => existing.get(number) || U.fromTrain(catalog.get(number), sourceType));
    } else {
      targets = [...selected].map(index => day.items[index]);
      if (!targets.length) throw new Error('対象の列車を選択してください。');
    }
    if (!confirm(`${targets.length}列車を一括${U.states[state]}にして保存・公開更新します。この日の他の未保存内容も公開します。時刻変更・区間指定・運転禁止は維持します。よろしいですか？`)) return;
    const changes = new Map(targets.map(item => [U.key(item), U.withBase(item, state)]));
    day.items = day.items.map(item => { const replacement = changes.get(U.key(item)); changes.delete(U.key(item)); return replacement || item; });
    day.items.push(...changes.values());
    editing = -1; pendingRow = null; $('rowEditor').hidden = true; dirty = true; render();
    await saveDay();
  }
  for (const [id, state, numbers] of [['bulkOperate','operate',false], ['bulkSuspend','suspend',false], ['numberOperate','operate',true], ['numberSuspend','suspend',true]]) {
    $(id).addEventListener('click', () => run(() => bulkSave(state, numbers)));
  }
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
    selected.clear();
    render();
    message(`${added}列車を追加、既存${trains.length - added}列車は変更せずスキップしました。別曜日の原簿を指定した場合、その出典を備考に表示します。`);
  }));
  $('previewDay').addEventListener('click', () => {
    try {
      requireSaved();
      window.open(`daily-notice.html?serviceDate=${loadedDate}&sort=${encodeURIComponent($('dailySort').value)}${day.version !== day.publishedVersion ? '&draft=1' : ''}`, '_blank', 'noopener');
    } catch (error) { message(error.message, true); }
  });
  for (const [id, action] of [['withdrawDay', 'withdraw']]) {
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
    requireDay();
    if (editorDirty) commitEditor();
    if (dirty) throw new Error('先にこの日の変更を保存してください。');
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
    const versions = {};
    const unpublished = [];
    for (let index = 0; index < dates.length; index += 4) {
      $('dailyStatus').textContent = `対象日の競合確認 ${index}/${dates.length}`;
      await Promise.all(dates.slice(index, index + 4).map(async date => {
        const target = await api(`/api/operation-service/daily?serviceDate=${date}`);
        versions[date] = target.version;
        if (target.version && target.version !== target.publishedVersion) unpublished.push(date);
      }));
    }
    if (versions[loadedDate] !== undefined && versions[loadedDate] !== day.version) throw new Error('この日が別の画面で更新されています。開き直してください。');
    if (!confirm(`${selected.size}列車を${dates.length}日分に保存し、各日全体を公開更新します。${$('applyMode').value === 'activity' ? '対象日の時刻変更・区間指定は維持します。' : '時刻変更・区間指定・記事も上書きします。'}${unpublished.length ? `未公開の旧下書きがある日（${unpublished.sort().join('、')}）は、その内容も公開されます。` : ''}よろしいですか？`)) return;
    $('dailyStatus').textContent = `保存中：${selected.size}列車 × ${dates.length}日。全対象をまとめて確定しています…`;
    const result = await api('/api/operation-service/daily/apply-publish', {...spec, versions, applyMode:$('applyMode').value, items:[...selected].map(index => day.items[index])});
    const current = result.items.find(item => item.serviceDate === loadedDate);
    if (current) { day.version = current.version; day.publishedVersion = current.version; day.noticeNumber = current.noticeNumber; day.edition = current.edition; day.publishedStatus = current.status; day.updatedAt = current.publishedAt; }
    selected.clear(); render();
    message(`${result.items.length}日分を保存し、公開一覧・PDFを更新しました。`);
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
