(function () {
  'use strict';

  const API_ORIGIN = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  const $ = id => document.getElementById(id);
  const categoryLabels = {planned_extra: '予定臨', extra: '臨時', regular: '定期等'};
  const stateLabels = {operate: '運転', suspend: '運休', changed: '時刻変更', prohibited: '運転禁止'};
  const statusLabels = {draft: '下書き', published: '公開中', withdrawn: '取下げ'};
  let catalog = [];
  let notices = [];
  let selectedSchedule = null;
  let currentNotice = null;
  let dirty = false;
  let loadingDate = false;
  const selectedCatalogKeys = new Set();

  function tokyoToday() {
    return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  }

  function normalizedDate(value) {
    const match = String(value || '').trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
    if (!match) return '';
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    return Number.isNaN(new Date(`${iso}T12:00:00+09:00`).getTime()) ? '' : iso;
  }

  function displayDate(value) { return String(value || '').replace(/-/g, '/'); }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  }

  function replaceMarkup(target, markup) {
    const range = document.createRange();
    range.selectNodeContents(target);
    target.replaceChildren(range.createContextualFragment(markup));
  }

  function normalized(value) { return String(value || '').toLowerCase().replace(/[\s　]/g, ''); }

  function setMessage(text, kind) {
    $('message').textContent = text || '';
    $('message').className = `message${kind ? ` ${kind}` : ''}${text ? '' : ' hidden'}`;
  }

  function markDirty(value = true) {
    dirty = value;
    $('dirtyState').textContent = dirty ? '● 未保存の変更あり' : '未変更';
    $('dirtyState').style.color = dirty ? '#9c0000' : '';
  }

  async function api(path, options) {
    const url = new URL(path, API_ORIGIN);
    const request = Object.assign({cache: 'no-store', credentials: 'include'}, options || {});
    request.headers = Object.assign({Accept: 'application/json'}, request.headers || {});
    const token = await window.TayunetFirebaseDataAuth.getIdToken();
    request.headers.Authorization = `Bearer ${token}`;
    let response = await fetch(url, request);
    if (response.status === 401) {
      request.headers.Authorization = `Bearer ${await window.TayunetFirebaseDataAuth.getIdToken(true)}`;
      response = await fetch(url, request);
    }
    const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.error;
      throw error;
    }
    return payload;
  }

  function filteredCatalog() {
    const query = normalized($('trainQuery').value);
    const category = $('trainCategory').value;
    const items = catalog.filter(train => {
      if (category && train.category !== category) return false;
      if (!query) return true;
      return normalized([train.trainNumber, ...(train.trainNumbers || []), train.trainType,
        ...(train.lines || []), train.origin, train.destination,
        ...(train.stops || []).map(stop => stop.station)].join('|')).includes(query);
    });
    const sort = $('catalogSort').value;
    if (sort === 'line') items.sort((left, right) => normalized(left.lines?.[0]).localeCompare(normalized(right.lines?.[0]), 'ja') || String(left.trainNumber).localeCompare(String(right.trainNumber), 'ja', {numeric: true}));
    if (sort === 'number') items.sort((left, right) => String(left.trainNumber).localeCompare(String(right.trainNumber), 'ja', {numeric: true}));
    return items;
  }

  function renderCatalog() {
    const items = filteredCatalog();
    $('catalogMeta').textContent = `${items.length}/${catalog.length}列車`;
    if (!items.length) {
      replaceMarkup($('catalogRows'), '<tr><td colspan="7" class="empty-cell">条件に一致する列車はありません。</td></tr>');
      updateBulkSelection();
      return;
    }
    replaceMarkup($('catalogRows'), items.map(train => `
      <tr data-key="${escapeHtml(train.scheduleKey)}" class="${train.scheduleKey === selectedSchedule?.scheduleKey ? 'selected' : ''}" tabindex="0">
        <td><input type="checkbox" class="catalog-check" aria-label="${escapeHtml(train.trainNumber)}を一括対象に選択" ${selectedCatalogKeys.has(train.scheduleKey) ? 'checked' : ''}></td>
        <td class="category-${escapeHtml(train.category)}">${escapeHtml(categoryLabels[train.category] || train.category)}</td>
        <td><strong>${escapeHtml((train.trainNumbers || [train.trainNumber]).join('→'))}</strong></td>
        <td>${escapeHtml(train.trainType || '―')}</td><td>${escapeHtml((train.lines || []).join('・'))}</td>
        <td>${escapeHtml(train.origin)}</td><td>${escapeHtml(train.destination)}</td>
      </tr>`).join(''));
    $('catalogRows').querySelectorAll('tr[data-key]').forEach(row => {
      const select = () => selectTrain(catalog.find(item => item.scheduleKey === row.dataset.key));
      row.addEventListener('click', select);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
      row.querySelector('.catalog-check').addEventListener('click', event => event.stopPropagation());
      row.querySelector('.catalog-check').addEventListener('change', event => {
        if (event.target.checked) selectedCatalogKeys.add(row.dataset.key); else selectedCatalogKeys.delete(row.dataset.key);
        updateBulkSelection();
      });
    });
    updateBulkSelection();
  }

  function updateBulkSelection() {
    $('bulkSuspend').disabled = selectedCatalogKeys.size === 0;
    $('bulkSuspend').textContent = selectedCatalogKeys.size ? `選択${selectedCatalogKeys.size}列車を一括運休` : '選択列車を一括運休';
  }

  async function bulkSuspend() {
    const trains = catalog.filter(train => selectedCatalogKeys.has(train.scheduleKey));
    const dateSpec = collectServiceDates();
    if (!trains.length) return;
    if (!dateSpec) {
      setMessage('運転日の指定が正しくありません。', 'error');
      return;
    }
    if (trains.length > 100) {
      setMessage('一度に一括登録できるのは100列車までです。', 'error');
      return;
    }
    if (!confirm(`${trains.length}列車を全区間運休として公開します。よろしいですか？`)) return;
    $('bulkSuspend').disabled = true;
    let succeeded = 0;
    const failed = [];
    for (const train of trains) {
      $('statusText').textContent = `一括運休を登録中 ${succeeded + failed.length + 1}/${trains.length}　${train.trainNumber}`;
      try {
        await api('/api/operation-service/notices', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({
            status: 'published', title: '列車運転休止', operationKind: 'suspension', operationState: 'suspend',
            diagramPeriodId: $('diagramPeriod').value || train.diagramPeriod?.id || '', trainNumber: train.trainNumber,
            trainType: train.trainType || '', scheduleKey: train.scheduleKey, sectionStart: train.origin,
            sectionEnd: train.destination, restriction: '', remarks: '管理画面の一括運休で登録', lines: train.lines || [],
            timeChanges: [], scheduleSnapshot: train, noticeNumber: '',
          }, dateSpec)),
        });
        succeeded += 1;
      } catch (error) {
        failed.push(`${train.trainNumber}: ${error.message}`);
      }
    }
    selectedCatalogKeys.clear();
    markDirty(false);
    await loadDate();
    if (failed.length) setMessage(`一括運休 ${succeeded}件を公開、${failed.length}件は失敗しました。${failed.slice(0, 5).join(' / ')}`, 'error');
    else setMessage(`一括運休 ${succeeded}件を公開しました。`, 'success');
    updateBulkSelection();
  }

  function renderNotices() {
    $('noticeMeta').textContent = `${notices.length}件`;
    if (!notices.length) {
      replaceMarkup($('noticeRows'), '<tr><td colspan="5" class="empty-cell">この施行日の登録はありません。</td></tr>');
      return;
    }
    replaceMarkup($('noticeRows'), notices.map(item => `
      <tr data-id="${escapeHtml(item.id)}" class="${item.id === currentNotice?.id ? 'selected' : ''}" tabindex="0">
        <td><span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span></td>
        <td><span class="badge badge-${escapeHtml(item.operationState)}">${escapeHtml(stateLabels[item.operationState] || item.operationState)}</span></td>
        <td>${escapeHtml(item.trainNumber)}</td><td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.sectionStart || '―')}～${escapeHtml(item.sectionEnd || '―')}</td>
      </tr>`).join(''));
    $('noticeRows').querySelectorAll('tr[data-id]').forEach(row => {
      const select = () => editNotice(notices.find(item => item.id === row.dataset.id));
      row.addEventListener('click', select);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
  }

  function populatePeriodChoices(payload) {
    const choices = payload.availableDiagramPeriods || [];
    const previous = $('diagramPeriod').value;
    replaceMarkup($('diagramPeriod'), '<option value="">日付から自動選択</option>' + choices.map(period =>
      `<option value="${escapeHtml(period.id)}">${escapeHtml(period.name)}${period.active ? '（適用中）' : '（切替期間）'}</option>`).join(''));
    if (previous && choices.some(period => period.id === previous)) $('diagramPeriod').value = previous;
    const selected = payload.diagramPeriod;
    $('periodText').textContent = selected ? `${selected.name} ${selected.startDate}～${selected.endDate}` : '該当する改正期間なし';
  }

  async function loadDate() {
    if (loadingDate) return;
    if (dirty && !confirm('未保存の入力があります。破棄して施行日を切り替えますか？')) return;
    const serviceDate = normalizedDate($('serviceDate').value);
    if (!serviceDate) {
      setMessage('施行日はYYYY/MM/DD形式で入力してください。', 'error');
      return;
    }
    $('serviceDate').value = displayDate(serviceDate);
    loadingDate = true;
    $('loadDate').disabled = true;
    setMessage('');
    $('statusText').textContent = 'ダイヤ原簿と活休情報を読み込んでいます…';
    const params = new URLSearchParams({serviceDate});
    if ($('dayType').value) params.set('dayType', $('dayType').value);
    if ($('diagramPeriod').value) params.set('diagramPeriodId', $('diagramPeriod').value);
    try {
      const [catalogPayload, noticePayload] = await Promise.all([
        api(`/api/operation-service/catalog?${params}`),
        api(`/api/operation-service/notices?serviceDate=${encodeURIComponent(serviceDate)}`),
      ]);
      catalog = catalogPayload.items || [];
      notices = noticePayload.items || [];
      selectedCatalogKeys.clear();
      selectedSchedule = null;
      currentNotice = null;
      populatePeriodChoices(catalogPayload);
      renderCatalog();
      renderNotices();
      resetForm();
      $('statusText').textContent = `${displayDate(catalogPayload.selectionDate || serviceDate)}基準の統合ダイヤ ${catalog.length}列車を読み込みました。`;
    } catch (error) {
      setMessage(error.code === 'admin_required' ? '管理者権限がありません。' : `読込に失敗しました: ${error.message}`, 'error');
      $('statusText').textContent = '読込失敗';
    } finally {
      loadingDate = false;
      $('loadDate').disabled = false;
    }
  }

  function setSectionOptions(stops, startValue, endValue) {
    const options = '<option value="">―</option>' + (stops || []).map(stop =>
      `<option value="${escapeHtml(stop.station)}">${escapeHtml(stop.station)}</option>`).join('');
    replaceMarkup($('sectionStart'), options);
    replaceMarkup($('sectionEnd'), options);
    $('sectionStart').value = startValue || '';
    $('sectionEnd').value = endValue || '';
  }

  function setOperationDates(item) {
    const baseDate = normalizedDate(item?.serviceDate) || normalizedDate($('serviceDate').value) || tokyoToday();
    const mode = item?.serviceDateMode || 'single';
    const dates = Array.isArray(item?.serviceDates) && item.serviceDates.length ? item.serviceDates : [baseDate];
    $('serviceDateMode').value = mode;
    $('operationDates').value = dates.map(displayDate).join(', ');
    $('serviceDateStart').value = displayDate(item?.serviceDateStart || dates[0]);
    $('serviceDateEnd').value = displayDate(item?.serviceDateEnd || dates[dates.length - 1]);
    document.querySelectorAll('.date-mode-multiple').forEach(element => element.classList.toggle('hidden', mode !== 'multiple'));
    document.querySelectorAll('.date-mode-range').forEach(element => element.classList.toggle('hidden', mode !== 'range'));
  }

  function collectServiceDates() {
    const mode = $('serviceDateMode').value;
    const baseDate = normalizedDate($('serviceDate').value);
    if (mode === 'multiple') {
      const serviceDates = $('operationDates').value.split(/[,\s、]+/).filter(Boolean).map(normalizedDate);
      return serviceDates.length && serviceDates.every(Boolean) ? {serviceDateMode: mode, serviceDate: serviceDates[0], serviceDates} : null;
    }
    if (mode === 'range') {
      const serviceDateStart = normalizedDate($('serviceDateStart').value);
      const serviceDateEnd = normalizedDate($('serviceDateEnd').value);
      return serviceDateStart && serviceDateEnd && serviceDateStart <= serviceDateEnd
        ? {serviceDateMode: mode, serviceDate: serviceDateStart, serviceDateStart, serviceDateEnd} : null;
    }
    return baseDate ? {serviceDateMode: 'single', serviceDate: baseDate, serviceDates: [baseDate]} : null;
  }

  function renderTimeRows(schedule, changes) {
    const stops = schedule?.stops || [];
    const changeMap = new Map((changes || []).map(change => [normalized(change.station), change]));
    if (!stops.length) {
      replaceMarkup($('timeRows'), '<tr><td colspan="5" class="empty-cell">列車時刻表はありません。</td></tr>');
      return;
    }
    replaceMarkup($('timeRows'), stops.map(stop => {
      const change = changeMap.get(normalized(stop.station)) || {};
      return `<tr data-station="${escapeHtml(stop.station)}"><td>${escapeHtml(stop.station)}</td>
        <td><input data-field="arrival" value="${escapeHtml(change.arrival || stop.arrival || '')}" data-original="${escapeHtml(stop.arrival || '')}"></td>
        <td><input data-field="departure" value="${escapeHtml(change.departure || stop.departure || '')}" data-original="${escapeHtml(stop.departure || '')}"></td>
        <td><input data-field="trackN" value="${escapeHtml(change.trackN || stop.trackN || '')}" data-original="${escapeHtml(stop.trackN || '')}"></td>
        <td><input data-field="note" value="${escapeHtml(change.note || '')}" data-original=""></td></tr>`;
    }).join(''));
    $('timeRows').querySelectorAll('input').forEach(input => input.addEventListener('input', () => markDirty()));
  }

  function selectTrain(train) {
    if (!train) return;
    if (dirty && !confirm('未保存の入力を破棄して、選択列車で新規作成しますか？')) return;
    selectedSchedule = train;
    currentNotice = null;
    $('title').value = train.defaultTitle || '列車運転';
    $('operationKind').value = '';
    $('operationState').value = '';
    $('trainNumber').value = train.trainNumber || '';
    $('trainType').value = train.trainType || '';
    $('restriction').value = '';
    $('remarks').value = '';
    setOperationDates();
    setSectionOptions(train.stops, train.origin, train.destination);
    renderTimeRows(train, []);
    $('recordIdentity').textContent = `新規 / ${train.scheduleKey}`;
    $('noticeNumberDisplay').textContent = '未採番（初回公開時に自動採番）';
    $('createdAtDisplay').textContent = '―';
    $('updatedAtDisplay').textContent = '―';
    $('withdraw').disabled = true;
    $('pdfPreview').disabled = true;
    markDirty(false);
    renderCatalog();
    renderNotices();
    $('statusText').textContent = `${train.trainNumber} ${train.origin}～${train.destination}を選択しました。`;
  }

  function editNotice(item) {
    if (!item) return;
    if (dirty && !confirm('未保存の入力を破棄して、登録済み情報を開きますか？')) return;
    currentNotice = item;
    selectedSchedule = item.scheduleSnapshot || catalog.find(train => train.scheduleKey === item.scheduleKey) || null;
    $('title').value = item.title || '';
    $('operationKind').value = item.operationKind || '';
    $('operationState').value = item.operationState || '';
    $('trainNumber').value = item.trainNumber || '';
    $('trainType').value = item.trainType || '';
    $('restriction').value = item.restriction || '';
    $('remarks').value = item.remarks || '';
    setOperationDates(item);
    setSectionOptions(selectedSchedule?.stops, item.sectionStart, item.sectionEnd);
    renderTimeRows(selectedSchedule, item.timeChanges);
    $('recordIdentity').textContent = `${item.noticeNumber || item.id} / 第${item.version}版`;
    $('noticeNumberDisplay').textContent = item.noticeNumber || '未採番（初回公開時に自動採番）';
    $('createdAtDisplay').textContent = item.createdAt || '―';
    $('updatedAtDisplay').textContent = item.updatedAt || '―';
    $('withdraw').disabled = item.status !== 'published';
    $('pdfPreview').disabled = item.status !== 'published';
    markDirty(false);
    renderCatalog();
    renderNotices();
  }

  function resetForm(keepSchedule = false) {
    currentNotice = null;
    if (!keepSchedule) selectedSchedule = null;
    ['title', 'trainNumber', 'trainType', 'restriction', 'remarks'].forEach(id => { $(id).value = ''; });
    $('operationKind').value = '';
    $('operationState').value = '';
    setOperationDates();
    setSectionOptions(selectedSchedule?.stops || [], '', '');
    renderTimeRows(selectedSchedule, []);
    $('recordIdentity').textContent = '新規';
    $('noticeNumberDisplay').textContent = '未採番（初回公開時に自動採番）';
    $('createdAtDisplay').textContent = '―';
    $('updatedAtDisplay').textContent = '―';
    $('withdraw').disabled = true;
    $('pdfPreview').disabled = true;
    markDirty(false);
    renderCatalog();
    renderNotices();
  }

  function collectTimeChanges() {
    return Array.from($('timeRows').querySelectorAll('tr[data-station]')).map(row => {
      const values = {};
      let changed = false;
      row.querySelectorAll('input[data-field]').forEach(input => {
        values[input.dataset.field] = input.value.trim();
        if (input.value.trim() !== String(input.dataset.original || '').trim()) changed = true;
      });
      return changed ? Object.assign({station: row.dataset.station}, values) : null;
    }).filter(Boolean);
  }

  function formPayload(status) {
    return Object.assign({
      version: currentNotice?.version,
      status,
      diagramPeriodId: $('diagramPeriod').value || selectedSchedule?.diagramPeriod?.id || '',
      title: $('title').value.trim(),
      operationKind: $('operationKind').value,
      operationState: $('operationState').value,
      trainNumber: $('trainNumber').value.trim(),
      trainType: $('trainType').value.trim(),
      category: selectedSchedule?.category || currentNotice?.category,
      scheduleKey: selectedSchedule?.scheduleKey || currentNotice?.scheduleKey || '',
      sectionStart: $('sectionStart').value,
      sectionEnd: $('sectionEnd').value,
      restriction: $('restriction').value.trim(),
      remarks: $('remarks').value.trim(),
      lines: selectedSchedule?.lines || currentNotice?.lines || [],
      timeChanges: collectTimeChanges(),
      scheduleSnapshot: selectedSchedule || currentNotice?.scheduleSnapshot || {},
      noticeNumber: currentNotice?.noticeNumber || '',
    }, collectServiceDates() || {});
  }

  async function save(status) {
    const payload = formPayload(status);
    if (!collectServiceDates()) {
      setMessage('運転日の指定が正しくありません。複数日はカンマ区切り、期間は開始日から終了日の順で入力してください。', 'error');
      return;
    }
    if (!payload.title || !payload.trainNumber || !payload.serviceDate || !payload.operationKind || !payload.operationState) {
      setMessage('表題・列車番号・施行日・手配区分・活休区分は必須です。', 'error');
      return;
    }
    if (!payload.scheduleSnapshot?.stops?.length && !confirm('時刻表が選択されていません。このまま保存しますか？')) return;
    setMessage('');
    $('statusText').textContent = status === 'published' ? '公開処理中…' : '保存中…';
    try {
      const item = currentNotice
        ? await api(`/api/operation-service/notices/${encodeURIComponent(currentNotice.id)}`, {
          method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
        })
        : await api('/api/operation-service/notices', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
        });
      currentNotice = item;
      const index = notices.findIndex(value => value.id === item.id);
      if (index >= 0) notices[index] = item; else notices.push(item);
      editNotice(item);
      setMessage(`${item.noticeNumber || item.id}を${status === 'published' ? '公開' : status === 'withdrawn' ? '取下げ' : '保存'}しました。`, 'success');
      $('statusText').textContent = `更新日時 ${item.updatedAt}`;
    } catch (error) {
      if (error.status === 409) setMessage('別の画面で更新されています。施行日を再読込してからやり直してください。', 'error');
      else if (error.code === 'admin_required') setMessage('管理者権限がないため保存できません。', 'error');
      else setMessage(`保存に失敗しました: ${error.message}`, 'error');
      $('statusText').textContent = '保存失敗';
    }
  }

  function syncKindAndState() {
    const map = {operation: 'operate', suspension: 'suspend', time_change: 'changed', prohibition: 'prohibited'};
    if (map[$('operationKind').value]) $('operationState').value = map[$('operationKind').value];
    markDirty();
  }

  async function initialize() {
    $('serviceDate').value = displayDate(tokyoToday());
    const ready = await window.TayunetAuthReady;
    if (!ready.ok) return;
    $('operatorName').textContent = `${ready.user.email || '利用者'} / ${ready.profile.isAdmin ? '管理者' : '閲覧権限'}`;
    if (!ready.profile.isAdmin) setMessage('閲覧はできますが、保存・公開には管理者権限が必要です。', 'error');
    await loadDate();
  }

  $('loadDate').addEventListener('click', loadDate);
  $('diagramPeriod').addEventListener('change', loadDate);
  $('trainQuery').addEventListener('input', renderCatalog);
  $('trainCategory').addEventListener('change', renderCatalog);
  $('catalogSort').addEventListener('change', renderCatalog);
  $('selectVisible').addEventListener('click', () => { filteredCatalog().forEach(train => selectedCatalogKeys.add(train.scheduleKey)); renderCatalog(); });
  $('clearSelection').addEventListener('click', () => { selectedCatalogKeys.clear(); renderCatalog(); });
  $('bulkSuspend').addEventListener('click', bulkSuspend);
  $('newNotice').addEventListener('click', () => resetForm());
  $('newNoticeMenu').addEventListener('click', event => { event.preventDefault(); resetForm(); });
  $('saveDraft').addEventListener('click', () => save('draft'));
  $('publish').addEventListener('click', () => save('published'));
  $('withdraw').addEventListener('click', () => { if (confirm('公開情報を取下げますか？通達番号と変更履歴は残ります。')) save('withdrawn'); });
  $('duplicate').addEventListener('click', () => {
    currentNotice = null;
    $('recordIdentity').textContent = '複製 / 新規';
    $('noticeNumberDisplay').textContent = '未採番（初回公開時に自動採番）';
    $('createdAtDisplay').textContent = '―';
    $('updatedAtDisplay').textContent = '―';
    $('withdraw').disabled = true;
    $('pdfPreview').disabled = true;
    markDirty();
  });
  $('pdfPreview').addEventListener('click', () => { if (currentNotice) window.open(`notice.html?id=${encodeURIComponent(currentNotice.id)}&print=1`, '_blank', 'noopener'); });
  $('operationKind').addEventListener('change', syncKindAndState);
  $('serviceDateMode').addEventListener('change', () => { setOperationDates({
    serviceDateMode: $('serviceDateMode').value,
    serviceDates: $('operationDates').value.split(/[,\s、]+/).filter(Boolean),
    serviceDateStart: $('serviceDateStart').value,
    serviceDateEnd: $('serviceDateEnd').value,
    serviceDate: normalizedDate($('serviceDate').value),
  }); markDirty(); });
  document.querySelectorAll('.editor-scroll input, .editor-scroll select, .editor-scroll textarea').forEach(control => {
    if (control.id !== 'operationKind') control.addEventListener('input', () => markDirty());
  });
  setInterval(() => { $('clock').textContent = new Date().toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}); }, 1000);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  initialize();
})();
