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

  function tokyoToday() {
    return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
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
    return catalog.filter(train => {
      if (category && train.category !== category) return false;
      if (!query) return true;
      return normalized([train.trainNumber, ...(train.trainNumbers || []), train.trainType,
        ...(train.lines || []), train.origin, train.destination,
        ...(train.stops || []).map(stop => stop.station)].join('|')).includes(query);
    });
  }

  function renderCatalog() {
    const items = filteredCatalog();
    $('catalogMeta').textContent = `${items.length}/${catalog.length}列車`;
    if (!items.length) {
      $('catalogRows').innerHTML = '<tr><td colspan="6" class="empty-cell">条件に一致する列車はありません。</td></tr>';
      return;
    }
    $('catalogRows').innerHTML = items.map(train => `
      <tr data-key="${escapeHtml(train.scheduleKey)}" class="${train.scheduleKey === selectedSchedule?.scheduleKey ? 'selected' : ''}" tabindex="0">
        <td class="category-${escapeHtml(train.category)}">${escapeHtml(categoryLabels[train.category] || train.category)}</td>
        <td><strong>${escapeHtml((train.trainNumbers || [train.trainNumber]).join('→'))}</strong></td>
        <td>${escapeHtml(train.trainType || '―')}</td><td>${escapeHtml((train.lines || []).join('・'))}</td>
        <td>${escapeHtml(train.origin)}</td><td>${escapeHtml(train.destination)}</td>
      </tr>`).join('');
    $('catalogRows').querySelectorAll('tr[data-key]').forEach(row => {
      const select = () => selectTrain(catalog.find(item => item.scheduleKey === row.dataset.key));
      row.addEventListener('click', select);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
  }

  function renderNotices() {
    $('noticeMeta').textContent = `${notices.length}件`;
    if (!notices.length) {
      $('noticeRows').innerHTML = '<tr><td colspan="5" class="empty-cell">この施行日の登録はありません。</td></tr>';
      return;
    }
    $('noticeRows').innerHTML = notices.map(item => `
      <tr data-id="${escapeHtml(item.id)}" class="${item.id === currentNotice?.id ? 'selected' : ''}" tabindex="0">
        <td><span class="badge badge-${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span></td>
        <td><span class="badge badge-${escapeHtml(item.operationState)}">${escapeHtml(stateLabels[item.operationState] || item.operationState)}</span></td>
        <td>${escapeHtml(item.trainNumber)}</td><td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.sectionStart || '―')}～${escapeHtml(item.sectionEnd || '―')}</td>
      </tr>`).join('');
    $('noticeRows').querySelectorAll('tr[data-id]').forEach(row => {
      const select = () => editNotice(notices.find(item => item.id === row.dataset.id));
      row.addEventListener('click', select);
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
  }

  function populatePeriodChoices(payload) {
    const choices = payload.availableDiagramPeriods || [];
    const previous = $('diagramPeriod').value;
    $('diagramPeriod').innerHTML = '<option value="">日付から自動選択</option>' + choices.map(period =>
      `<option value="${escapeHtml(period.id)}">${escapeHtml(period.name)}${period.active ? '（適用中）' : '（切替期間）'}</option>`).join('');
    if (previous && choices.some(period => period.id === previous)) $('diagramPeriod').value = previous;
    const selected = payload.diagramPeriod;
    $('periodText').textContent = selected ? `${selected.name} ${selected.startDate}～${selected.endDate}` : '該当する改正期間なし';
  }

  async function loadDate() {
    if (dirty && !confirm('未保存の入力があります。破棄して施行日を切り替えますか？')) return;
    setMessage('');
    $('statusText').textContent = 'ダイヤ原簿と活休情報を読み込んでいます…';
    const params = new URLSearchParams({serviceDate: $('serviceDate').value});
    if ($('dayType').value) params.set('dayType', $('dayType').value);
    if ($('diagramPeriod').value) params.set('diagramPeriodId', $('diagramPeriod').value);
    try {
      const [catalogPayload, noticePayload] = await Promise.all([
        api(`/api/operation-service/catalog?${params}`),
        api(`/api/operation-service/notices?serviceDate=${encodeURIComponent($('serviceDate').value)}`),
      ]);
      catalog = catalogPayload.items || [];
      notices = noticePayload.items || [];
      selectedSchedule = null;
      currentNotice = null;
      populatePeriodChoices(catalogPayload);
      renderCatalog();
      renderNotices();
      resetForm();
      $('statusText').textContent = `${catalogPayload.selectionDate || $('serviceDate').value}基準の統合ダイヤ ${catalog.length}列車を読み込みました。`;
    } catch (error) {
      setMessage(error.code === 'admin_required' ? '管理者権限がありません。' : `読込に失敗しました: ${error.message}`, 'error');
      $('statusText').textContent = '読込失敗';
    }
  }

  function setSectionOptions(stops, startValue, endValue) {
    const options = '<option value="">―</option>' + (stops || []).map(stop =>
      `<option value="${escapeHtml(stop.station)}">${escapeHtml(stop.station)}</option>`).join('');
    $('sectionStart').innerHTML = options;
    $('sectionEnd').innerHTML = options;
    $('sectionStart').value = startValue || '';
    $('sectionEnd').value = endValue || '';
  }

  function renderTimeRows(schedule, changes) {
    const stops = schedule?.stops || [];
    const changeMap = new Map((changes || []).map(change => [normalized(change.station), change]));
    if (!stops.length) {
      $('timeRows').innerHTML = '<tr><td colspan="7" class="empty-cell">列車時刻表はありません。</td></tr>';
      return;
    }
    $('timeRows').innerHTML = stops.map((stop, index) => {
      const change = changeMap.get(normalized(stop.station)) || {};
      return `<tr data-station="${escapeHtml(stop.station)}"><td>${index + 1}</td><td>${escapeHtml(stop.line || '')}</td><td>${escapeHtml(stop.station)}</td>
        <td><input data-field="arrival" value="${escapeHtml(change.arrival || stop.arrival || '')}" data-original="${escapeHtml(stop.arrival || '')}"></td>
        <td><input data-field="departure" value="${escapeHtml(change.departure || stop.departure || '')}" data-original="${escapeHtml(stop.departure || '')}"></td>
        <td><input data-field="trackN" value="${escapeHtml(change.trackN || stop.trackN || '')}" data-original="${escapeHtml(stop.trackN || '')}"></td>
        <td><input data-field="note" value="${escapeHtml(change.note || '')}" data-original=""></td></tr>`;
    }).join('');
    $('timeRows').querySelectorAll('input').forEach(input => input.addEventListener('input', () => markDirty()));
  }

  function selectTrain(train) {
    if (!train) return;
    if (dirty && !confirm('未保存の入力を破棄して、選択列車で新規作成しますか？')) return;
    selectedSchedule = train;
    currentNotice = null;
    $('title').value = train.defaultTitle || '列車運転';
    $('operationKind').value = 'operation';
    $('operationState').value = 'operate';
    $('trainNumber').value = train.trainNumber || '';
    $('trainType').value = train.trainType || '';
    $('restriction').value = '';
    $('remarks').value = '';
    setSectionOptions(train.stops, train.origin, train.destination);
    renderTimeRows(train, []);
    $('recordIdentity').textContent = `新規 / ${train.scheduleKey}`;
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
    $('operationKind').value = item.operationKind || 'operation';
    $('operationState').value = item.operationState || 'operate';
    $('trainNumber').value = item.trainNumber || '';
    $('trainType').value = item.trainType || '';
    $('restriction').value = item.restriction || '';
    $('remarks').value = item.remarks || '';
    setSectionOptions(selectedSchedule?.stops, item.sectionStart, item.sectionEnd);
    renderTimeRows(selectedSchedule, item.timeChanges);
    $('recordIdentity').textContent = `${item.noticeNumber || item.id} / 第${item.version}版`;
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
    $('operationKind').value = 'operation';
    $('operationState').value = 'operate';
    setSectionOptions(selectedSchedule?.stops || [], '', '');
    renderTimeRows(selectedSchedule, []);
    $('recordIdentity').textContent = '新規';
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
    return {
      version: currentNotice?.version,
      status,
      serviceDate: $('serviceDate').value,
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
    };
  }

  async function save(status) {
    const payload = formPayload(status);
    if (!payload.title || !payload.trainNumber || !payload.serviceDate) {
      setMessage('表題・列車番号・施行日は必須です。', 'error');
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
    $('serviceDate').value = tokyoToday();
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
  $('newNotice').addEventListener('click', () => resetForm());
  $('newNoticeMenu').addEventListener('click', event => { event.preventDefault(); resetForm(); });
  $('saveDraft').addEventListener('click', () => save('draft'));
  $('publish').addEventListener('click', () => save('published'));
  $('withdraw').addEventListener('click', () => { if (confirm('公開情報を取下げますか？通達番号と変更履歴は残ります。')) save('withdrawn'); });
  $('duplicate').addEventListener('click', () => { currentNotice = null; $('recordIdentity').textContent = '複製 / 新規'; $('withdraw').disabled = true; $('pdfPreview').disabled = true; markDirty(); });
  $('pdfPreview').addEventListener('click', () => { if (currentNotice) window.open(`notice.html?id=${encodeURIComponent(currentNotice.id)}&print=1`, '_blank', 'noopener'); });
  $('operationKind').addEventListener('change', syncKindAndState);
  document.querySelectorAll('.editor-scroll input, .editor-scroll select, .editor-scroll textarea').forEach(control => {
    if (control.id !== 'operationKind') control.addEventListener('input', () => markDirty());
  });
  setInterval(() => { $('clock').textContent = new Date().toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}); }, 1000);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  initialize();
})();
