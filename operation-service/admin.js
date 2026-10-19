(function () {
  'use strict';

  const API_ORIGIN = ['127.0.0.1', 'localhost'].includes(location.hostname)
    ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  const $ = id => document.getElementById(id);
  const categoryLabels = {planned_extra: '予定臨', extra: '臨時', regular: '定期等'};
  const stateLabels = {unknown: '未入力', operate: '運転', suspend: '運休', changed: '時刻変更', prohibited: '運転禁止'};
  const statusLabels = {draft: '下書き', published: '公開中', withdrawn: '取下げ'};
  let catalog = [];
  let notices = [];
  let selectedSchedule = null;
  let currentNotice = null;
  let dirty = false;
  let loadingDate = false;
  let bulkOperationRunning = false;
  const selectedCatalogKeys = new Set();
  const adminUtils = window.OperationServiceAdminUtils;
  const U = window.OperationDailyUtils;
  let dailyDay = null, dailyBusy = false, isAdmin = false, loadedWorkflow = 'daily';
  const dailyMode = () => $('managementWorkflow').value === 'daily';

  function setDailyControls() {
    const active = dailyMode();
    $('dailyLayerControls').hidden = !active;
    $('dailySaveExplanation').hidden = !active;
    $('saveDraft').textContent = active ? '保存（公開も自動更新）' : '下書き保存';
    $('publish').hidden = active;
    $('withdraw').hidden = active;
    [...$('operationState').options].forEach(option => { option.hidden = active && ['changed','prohibited'].includes(option.value); });
  }
  function fillDailyLayers(item = {}) {
    const value = U.layers(item);
    $('dailyTimeChanged').checked = value.timeChanged;
    $('dailyProhibited').checked = value.prohibited;
    replaceMarkup($('dailySectionRows'), '');
    value.sections.forEach(addDailySection);
    $('dailySectionDetails').open = value.sections.length > 0;
    replaceMarkup($('stationChoices'), (item.scheduleSnapshot?.stops || selectedSchedule?.stops || []).map(stop => `<option value="${escapeHtml(stop.station)}"></option>`).join(''));
  }
  function addDailySection(section = {}) {
    const row = document.createElement('tr');
    replaceMarkup(row, U.sectionRowMarkup(section));
    row.querySelector('button').addEventListener('click', () => { if (!isAdmin || dailyBusy) return; row.remove(); markDirty(); });
    $('dailySectionRows').append(row);
  }
  function datesFor(spec) {
    if (spec.serviceDateMode !== 'range') return spec.serviceDates || [spec.serviceDate];
    const first = Date.parse(spec.serviceDateStart + 'T00:00:00Z'), last = Date.parse(spec.serviceDateEnd + 'T00:00:00Z');
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first || last - first > 365 * 86400000) throw new Error('期間は1～366日で指定してください。');
    return Array.from({length:(last-first)/86400000+1}, (_, i) => new Date(first + i * 86400000).toISOString().slice(0,10));
  }
  function requireDailyLoaded() {
    if (!dailyDay || dailyDay.serviceDate !== normalizedDate($('serviceDate').value)) throw new Error('施行日を変更した場合はダイヤを読み込み直してください。');
  }
  async function dailyVersions(spec) {
    requireDailyLoaded();
    const dates = datesFor(spec), versions = {}, drafts = [];
    if (!dates.length || dates.length > 366) throw new Error('対象日は1～366日で指定してください。');
    for (let i=0; i<dates.length; i+=4) await Promise.all(dates.slice(i,i+4).map(async date => {
      const day = date === dailyDay.serviceDate ? dailyDay : await api(`/api/operation-service/daily?serviceDate=${date}`);
      versions[date] = day.version;
      if (day.version && day.version !== day.publishedVersion) drafts.push(date);
    }));
    return {dates, versions, drafts};
  }
  async function dailyAction(action) {
    if (dailyBusy) return;
    if (!isAdmin) { setMessage('保存には管理者権限が必要です。', 'error'); return; }
    dailyBusy = true;
    const controls = [...document.querySelectorAll('button, input, select, textarea')];
    const previous = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try { await action(); }
    catch (error) { setMessage(`保存・公開更新に失敗しました: ${error.status === 409 ? '別の画面で更新されています。入力内容を控えて再読込してください。' : error.message}`, 'error'); }
    finally { dailyBusy = false; controls.forEach((control, i) => { control.disabled = previous[i]; }); updateBulkSelection(); }
  }
  async function saveDailyFromTrain(status) {
    return dailyAction(async () => {
      requireDailyLoaded();
      if (status === 'withdrawn') throw new Error('列車単位の取下げではなく、基本活休を未入力にしてください。日全体の取下げは日別一覧画面から行えます。');
      const selection = serviceDateResult();
      if (!selection.ok) throw new Error(selection.message);
      let row = {...(currentNotice || {}), ...formPayload('draft'), timetableDayType:currentNotice?.timetableDayType || $('dayType').value};
      if (!row.trainNumber || !row.title) throw new Error('列車番号・表題を入力してください。');
      const duplicate = dailyDay.items.some(item => U.key(item) === U.key(row) && U.key(item) !== U.key(currentNotice || {}));
      if (duplicate) throw new Error('同じ列車番号は登録済みです。一覧から既存の列車を選んで編集してください。');
      row.timeChanged = $('dailyTimeChanged').checked || row.timeChanges.length > 0;
      row.prohibited = $('dailyProhibited').checked;
      row.sectionOverrides = [...$('dailySectionRows').querySelectorAll('tr')].map(tr => Object.fromEntries([...tr.querySelectorAll('[data-section-field]')].map(input => [input.dataset.sectionField, input.value.trim()])));
      row = U.withBase(row, ['operate','suspend','unknown'].includes($('operationState').value) ? $('operationState').value : 'unknown');
      row.operationKind = row.prohibited ? 'prohibition' : row.sectionOverrides.length ? 'partial' : row.timeChanged ? 'time_change' : U.kinds[row.baseActivity];
      const target = await dailyVersions(selection.spec);
      if (!confirm(`${row.trainNumber}を${target.dates.length}日分に保存し、各日全体の公開一覧・PDFを更新します。他列車の旧未公開下書きも含まれます。${target.drafts.length ? `対象：${target.drafts.join('、')}。` : ''}よろしいですか？`)) return;
      if (target.dates.length === 1 && target.dates[0] === dailyDay.serviceDate) {
        const oldKey = U.key(currentNotice || row);
        const items = dailyDay.items.filter(item => U.key(item) !== oldKey && U.key(item) !== U.key(row));
        await api('/api/operation-service/daily/commit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({serviceDate:dailyDay.serviceDate, version:dailyDay.version, commonRemarks:dailyDay.commonRemarks, items:[...items,row]})});
      } else {
        await api('/api/operation-service/daily/apply-publish', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...selection.spec, versions:target.versions, applyMode:'replace', items:[row]})});
      }
      markDirty(false); selectedCatalogKeys.clear(); await loadDate();
      const saved = notices.find(item => U.key(item) === U.key(row));
      if (saved) editNotice(saved);
      setMessage(`${row.trainNumber}を保存し、${target.dates.length}日分の公開一覧・PDFを更新しました。日別一覧画面と同じデータです。`, 'success');
    });
  }
  async function bulkDailyFromTrain(state, trains, spec) {
    return dailyAction(async () => {
      requireDailyLoaded();
      if (dirty) throw new Error('編集中の内容を先に保存するか、入力を破棄してから一括処理してください。');
      const target = await dailyVersions(spec);
      if (!confirm(`${trains.length}列車を${target.dates.length}日分、基本${stateLabels[state]}に保存・公開更新します。対象日の時刻変更・区間指定・禁止は維持し、各日全体（旧未公開下書きを含む）を公開更新します。よろしいですか？`)) return;
      const items = trains.map(train => U.withBase(U.fromTrain(train, $('dayType').value), state));
      await api('/api/operation-service/daily/apply-publish', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...spec, versions:target.versions, applyMode:'activity', items})});
      selectedCatalogKeys.clear(); await loadDate();
      renderBulkResult(`一括${stateLabels[state]}`, trains.length, [], trains.length);
      setMessage(`${trains.length}列車・${target.dates.length}日分を保存・公開更新しました。`, 'success');
    });
  }

  function tokyoToday() {
    return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  }

  function normalizedDate(value) {
    return adminUtils.normalizeDate(value);
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

  function sameIntegratedTrain(train, notice) {
    if (normalized(train?.trainNumber) !== normalized(notice?.trainNumber)) return false;
    const snapshot = notice?.scheduleSnapshot || {};
    const trainLines = (train?.lines || []).map(normalized).sort().join('|');
    const noticeLines = (notice?.lines?.length ? notice.lines : snapshot.lines || []).map(normalized).sort().join('|');
    if (trainLines !== noticeLines) return false;
    if (snapshot.origin && normalized(snapshot.origin) !== normalized(train.origin)) return false;
    if (snapshot.destination && normalized(snapshot.destination) !== normalized(train.destination)) return false;
    return true;
  }

  function sameUniqueTrainNumber(train, notice) {
    const number = normalized(train?.trainNumber);
    return number && number === normalized(notice?.trainNumber)
      && catalog.filter(item => normalized(item.trainNumber) === number).length === 1;
  }

  function existingNoticeForTrain(train) {
    return notices.filter(item => item.scheduleKey === train.scheduleKey || sameIntegratedTrain(train, item) || sameUniqueTrainNumber(train, item)).sort((left, right) => {
      const rank = item => item.scheduleKey === train.scheduleKey ? 2 : sameIntegratedTrain(train, item) ? 1 : 0;
      return rank(right) - rank(left) || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
    })[0] || null;
  }

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
      const error = new Error(['daily_management_required','daily_workflow_update_required'].includes(payload.error)
        ? 'この日は日別共有データで管理しています。管理対象を「日別共有データ（現在の方式）」に切り替えてください。'
        : payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = payload.error;
      throw error;
    }
    return payload;
  }

  function filteredCatalog() {
    const query = normalized($('trainQuery').value);
    const category = $('trainCategory').value;
    const line = $('trainLine').value;
    const items = catalog.filter(train => {
      if (category && train.category !== category) return false;
      if (line && !(train.lines || []).includes(line)) return false;
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

  function populateLineChoices() {
    const previous = $('trainLine').value;
    const lines = [...new Set(catalog.flatMap(train => train.lines || []).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ja'));
    replaceMarkup($('trainLine'), '<option value="">すべて</option>' + lines.map(line => `<option value="${escapeHtml(line)}">${escapeHtml(line)}</option>`).join(''));
    if (lines.includes(previous)) $('trainLine').value = previous;
  }

  function renderCatalog() {
    const items = filteredCatalog();
    $('catalogMeta').textContent = `${items.length}/${catalog.length}列車`;
    if (!items.length) {
      replaceMarkup($('catalogRows'), '<tr><td colspan="8" class="empty-cell">条件に一致する列車はありません。</td></tr>');
      updateBulkSelection();
      return;
    }
    replaceMarkup($('catalogRows'), items.map(train => {
      const notice = existingNoticeForTrain(train);
      const state = notice?.operationState || '';
      const stateCell = !notice || notice.status === 'withdrawn' || state === 'unknown'
        ? '未入力'
        : `<span class="badge badge-${escapeHtml(state)}" title="${escapeHtml(statusLabels[notice.status] || notice.status)}">${escapeHtml(dailyMode() ? U.statusText(notice) : stateLabels[state] || state)}</span>`;
      return `<tr data-key="${escapeHtml(train.scheduleKey)}" class="${train.scheduleKey === selectedSchedule?.scheduleKey ? 'selected' : ''}" tabindex="0">
        <td><input type="checkbox" class="catalog-check" aria-label="${escapeHtml(train.trainNumber)}を一括対象に選択" ${selectedCatalogKeys.has(train.scheduleKey) ? 'checked' : ''} ${bulkOperationRunning ? 'disabled' : ''}></td>
        <td>${stateCell}</td><td class="category-${escapeHtml(train.category)}">${escapeHtml(categoryLabels[train.category] || train.category)}</td>
        <td><strong>${escapeHtml(train.trainNumber)}</strong></td>
        <td>${escapeHtml(train.trainType || '―')}</td><td>${escapeHtml((train.lines || []).join('・'))}</td>
        <td>${escapeHtml(train.origin)}</td><td>${escapeHtml(train.destination)}</td>
      </tr>`;
    }).join(''));
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
    $('bulkOperate').disabled = !isAdmin || dailyBusy || bulkOperationRunning || selectedCatalogKeys.size === 0;
    $('bulkSuspend').disabled = !isAdmin || dailyBusy || bulkOperationRunning || selectedCatalogKeys.size === 0;
    $('bulkClearActivity').disabled = !isAdmin || dailyBusy || bulkOperationRunning || selectedCatalogKeys.size === 0;
    $('bulkOperate').textContent = selectedCatalogKeys.size ? `選択${selectedCatalogKeys.size}列車を一括運転` : '選択列車を一括運転';
    $('bulkSuspend').textContent = selectedCatalogKeys.size ? `選択${selectedCatalogKeys.size}列車を一括運休` : '選択列車を一括運休';
    $('bulkClearActivity').textContent = selectedCatalogKeys.size ? `選択${selectedCatalogKeys.size}列車を活休未入力へ` : '選択列車を活休未入力へ';
  }

  function setBulkOperationRunning(running) {
    bulkOperationRunning = running;
    ['selectVisible', 'clearSelection', 'bulkServiceDateMode', 'bulkOperationDatePicker',
      'bulkAddOperationDate', 'bulkOperationDateList', 'bulkRemoveOperationDate',
      'bulkServiceDateStart', 'bulkServiceDateEnd'].forEach(id => { $(id).disabled = running; });
    document.querySelectorAll('.catalog-check').forEach(control => { control.disabled = running; });
    updateBulkSelection();
  }

  function renderBulkProgress(actionLabel, completed, total, succeeded, failed) {
    $('bulkResultPanel').classList.remove('hidden');
    $('bulkResultState').textContent = '処理中';
    $('bulkResultSummary').textContent = `${actionLabel}を処理中 ${completed}/${total}　成功 ${succeeded}件　失敗 ${failed}件`;
    $('bulkFailureDetails').classList.add('hidden');
  }

  function renderBulkResult(actionLabel, succeeded, failures, total) {
    const result = adminUtils.bulkResultModel(actionLabel, succeeded, failures, total);
    $('bulkResultPanel').classList.remove('hidden');
    $('bulkResultState').textContent = result.failed.length ? '一部失敗' : '完了';
    $('bulkResultSummary').textContent = `${result.actionLabel} ${result.total}件中　成功 ${result.succeeded}件　失敗 ${result.failed.length}件`;
    $('bulkFailureDetails').classList.toggle('hidden', result.failed.length === 0);
    $('bulkFailureSummary').textContent = `失敗詳細（${result.failed.length}件・すべて表示）`;
    replaceMarkup($('bulkFailureRows'), result.failed.map(item => `<tr><td>${escapeHtml(item.trainNumber)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join(''));
  }

  async function bulkRegister(mode) {
    if (bulkOperationRunning) return;
    const trains = catalog.filter(train => selectedCatalogKeys.has(train.scheduleKey));
    if (!trains.length) return;
    const dateResult = bulkServiceDateResult();
    if (!dateResult.ok) {
      setMessage(`一括操作：${dateResult.message}`, 'error');
      return;
    }
    const dateSpec = dateResult.spec;
    if (dailyMode()) return bulkDailyFromTrain(mode, trains, dateSpec);
    const operate = mode === 'operate';
    const actionLabel = operate ? '一括運転' : '一括運休';
    const stateLabel = operate ? '運転' : '運休';
    if (!confirm(`${trains.length}列車を全区間${stateLabel}として公開します。よろしいですか？`)) return;
    setBulkOperationRunning(true);
    let succeeded = 0;
    let completed = 0;
    let nextIndex = 0;
    const failed = [];
    renderBulkProgress(actionLabel, 0, trains.length, 0, 0);
    async function worker() {
      while (nextIndex < trains.length) {
        const train = trains[nextIndex];
        nextIndex += 1;
        try {
          await api('/api/operation-service/notices', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({
              status: 'published', title: operate ? (train.defaultTitle || '列車運転') : '運転休止',
              operationKind: operate ? 'operation' : 'suspension', operationState: operate ? 'operate' : 'suspend',
              diagramPeriodId: $('diagramPeriod').value || train.diagramPeriod?.id || '', trainNumber: train.trainNumber,
              trainType: train.trainType || '', scheduleKey: train.scheduleKey, sectionStart: train.origin,
              sectionEnd: train.destination, restriction: '', remarks: '', lines: train.lines || [],
              timeChanges: [], scheduleSnapshot: train, noticeNumber: '',
            }, dateSpec)),
          });
          succeeded += 1;
        } catch (error) {
          failed.push({trainNumber: train.trainNumber, reason: error.message});
        }
        completed += 1;
        renderBulkProgress(actionLabel, completed, trains.length, succeeded, failed.length);
        $('statusText').textContent = `${actionLabel}を登録中 ${completed}/${trains.length}　${train.trainNumber}`;
      }
    }
    try {
      await Promise.all(Array.from({length: Math.min(4, trains.length)}, () => worker()));
      selectedCatalogKeys.clear();
      markDirty(false);
      await loadDate();
      renderBulkResult(actionLabel, succeeded, failed, trains.length);
      setMessage(failed.length ? `${actionLabel}は${failed.length}件失敗しました。一括処理結果で全件を確認してください。` : `${actionLabel} ${succeeded}件を公開しました。`, failed.length ? 'error' : 'success');
    } finally {
      setBulkOperationRunning(false);
    }
  }

  async function clearActivityForTrains(trains, dateSpec, bulk = false) {
    if (bulkOperationRunning) return;
    if (!trains.length || !dateSpec) {
      const result = bulk ? bulkServiceDateResult() : serviceDateResult();
      setMessage(`${bulk ? '一括操作：' : ''}${result.message || '対象列車を選択してください。'}`, 'error');
      return;
    }
    if (dailyMode()) return bulkDailyFromTrain('unknown', trains, dateSpec);
    const label = bulk ? `${trains.length}列車` : `${trains[0].trainNumber}列車`;
    if (!confirm(`${label}の指定日の活休情報を未入力へ戻します。公開中の情報は取下げます。よろしいですか？`)) return;
    setBulkOperationRunning(bulk);
    $('clearActivity').disabled = true;
    setMessage('');
    $('statusText').textContent = '活休情報を未入力へ戻しています…';
    try {
      const result = await api('/api/operation-service/notices/clear-activity', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({
          trainNumbers: [...new Set(trains.map(train => train.trainNumber).filter(Boolean))],
        }, dateSpec)),
      });
      selectedCatalogKeys.clear();
      markDirty(false);
      await loadDate();
      const message = result.updatedCount
        ? `${result.updatedCount}件（延べ${result.clearedDateCount}日）の活休情報を未入力へ戻しました。`
        : '指定日に登録済みの活休情報はありませんでした。';
      setMessage(message, 'success');
      if (bulk) renderBulkResult('一括活休未入力', trains.length, [], trains.length);
    } catch (error) {
      setMessage(`活休未入力への変更に失敗しました: ${error.message}`, 'error');
      if (bulk) renderBulkResult('一括活休未入力', 0, trains.map(train => ({trainNumber: train.trainNumber, reason: error.message})), trains.length);
      $('statusText').textContent = '変更失敗';
      updateBulkSelection();
      $('clearActivity').disabled = !currentNotice;
    } finally {
      if (bulk) setBulkOperationRunning(false);
    }
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
        <td><span class="badge badge-${escapeHtml(item.operationState)}">${escapeHtml(dailyMode() ? U.statusText(item) : stateLabels[item.operationState] || item.operationState)}</span></td>
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
    setBulkOperationDates();
    loadingDate = true;
    const previousWorkflowDisabled = $('managementWorkflow').disabled;
    $('managementWorkflow').disabled = true;
    $('loadDate').disabled = true;
    setDailyControls();
    setMessage('');
    $('statusText').textContent = 'ダイヤ原簿と活休情報を読み込んでいます…';
    const params = new URLSearchParams({serviceDate});
    if ($('dayType').value) params.set('dayType', $('dayType').value);
    if ($('diagramPeriod').value) params.set('diagramPeriodId', $('diagramPeriod').value);
    try {
      const [catalogPayload, noticePayload] = await Promise.all([
        api(`/api/operation-service/catalog?${params}`),
        api(dailyMode() ? `/api/operation-service/daily?serviceDate=${encodeURIComponent(serviceDate)}` : `/api/operation-service/notices?serviceDate=${encodeURIComponent(serviceDate)}`),
      ]);
      catalog = catalogPayload.items || [];
      dailyDay = dailyMode() ? noticePayload : null;
      notices = (noticePayload.items || []).map(item => dailyMode() ? {...item, version:dailyDay.version, noticeNumber:dailyDay.noticeNumber, updatedAt:dailyDay.updatedAt,
        status:dailyDay.publishedStatus === 'published' && dailyDay.publishedVersion === dailyDay.version ? 'published' : 'draft'} : item);
      selectedCatalogKeys.clear();
      populateLineChoices();
      selectedSchedule = null;
      currentNotice = null;
      populatePeriodChoices(catalogPayload);
      renderCatalog();
      renderNotices();
      resetForm();
      loadedWorkflow = $('managementWorkflow').value;
      $('statusText').textContent = `${displayDate(catalogPayload.selectionDate || serviceDate)}基準の統合ダイヤ ${catalog.length}列車を読み込みました。`;
    } catch (error) {
      $('managementWorkflow').value = loadedWorkflow; setDailyControls();
      setMessage(error.code === 'admin_required' ? '管理者権限がありません。' : `読込に失敗しました: ${error.message}`, 'error');
      $('statusText').textContent = '読込失敗';
    } finally {
      loadingDate = false;
      $('loadDate').disabled = false;
      $('managementWorkflow').disabled = previousWorkflowDisabled;
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
    const dates = [...new Set((Array.isArray(item?.serviceDates) && item.serviceDates.length ? item.serviceDates : [baseDate]).map(normalizedDate).filter(Boolean))].sort();
    $('serviceDateMode').value = mode;
    renderOperationDateList(dates);
    $('operationDatePicker').value = '';
    $('serviceDateStart').value = displayDate(item?.serviceDateStart || dates[0]);
    $('serviceDateEnd').value = displayDate(item?.serviceDateEnd || dates[dates.length - 1]);
    updateOperationDateControls();
  }

  function operationDateListValues() {
    return Array.from($('operationDateList').options).map(option => option.value);
  }

  function renderOperationDateList(dates, selectedDates = []) {
    const selected = new Set(selectedDates);
    replaceMarkup($('operationDateList'), dates.map(date => `<option value="${escapeHtml(date)}"${selected.has(date) ? ' selected' : ''}>${escapeHtml(displayDate(date))}</option>`).join(''));
    $('operationDateCount').textContent = `${dates.length}日選択`;
  }

  function updateOperationDateControls() {
    const mode = $('serviceDateMode').value;
    document.querySelectorAll('.editor-date-mode-single').forEach(element => element.classList.toggle('hidden', mode !== 'single'));
    document.querySelectorAll('.editor-date-mode-multiple').forEach(element => element.classList.toggle('hidden', mode !== 'multiple'));
    document.querySelectorAll('.editor-date-mode-range').forEach(element => element.classList.toggle('hidden', mode !== 'range'));
    const baseDate = normalizedDate($('serviceDate').value);
    $('singleDateDisplay').textContent = displayDate(baseDate) || '―';
    const dates = operationDateListValues();
    if (mode === 'multiple') $('operationDateSummary').textContent = dates.length ? `${dates.length}日：${dates.map(displayDate).join('・')}` : '日付を追加してください';
    else if (mode === 'range') $('operationDateSummary').textContent = `${$('serviceDateStart').value || '―'} ～ ${$('serviceDateEnd').value || '―'}`;
    else $('operationDateSummary').textContent = displayDate(baseDate) || '―';
  }

  function addOperationDate() {
    const date = normalizedDate($('operationDatePicker').value);
    if (!date) {
      setMessage('追加する日付はYYYY/MM/DD形式で入力してください。', 'error');
      return;
    }
    const dates = [...new Set([...operationDateListValues(), date])].sort();
    renderOperationDateList(dates, [date]);
    $('operationDatePicker').value = '';
    updateOperationDateControls();
    setMessage('');
    markDirty();
  }

  function removeOperationDates() {
    const removing = new Set(Array.from($('operationDateList').selectedOptions).map(option => option.value));
    if (!removing.size) {
      setMessage('削除する日付を一覧から選択してください。', 'error');
      return;
    }
    renderOperationDateList(operationDateListValues().filter(date => !removing.has(date)));
    updateOperationDateControls();
    setMessage('');
    markDirty();
  }

  function serviceDateResult() {
    return adminUtils.dateSelectionResult({
      mode: $('serviceDateMode').value,
      single: $('serviceDate').value,
      dates: operationDateListValues(),
      start: $('serviceDateStart').value,
      end: $('serviceDateEnd').value,
    });
  }

  function collectServiceDates() {
    const result = serviceDateResult();
    return result.ok ? result.spec : null;
  }

  function bulkOperationDateListValues() {
    return Array.from($('bulkOperationDateList').options).map(option => option.value);
  }

  function renderBulkOperationDateList(dates, selectedDates = []) {
    const selected = new Set(selectedDates);
    replaceMarkup($('bulkOperationDateList'), dates.map(date => `<option value="${escapeHtml(date)}"${selected.has(date) ? ' selected' : ''}>${escapeHtml(displayDate(date))}</option>`).join(''));
    $('bulkOperationDateCount').textContent = `${dates.length}日選択`;
  }

  function setBulkOperationDates() {
    const baseDate = normalizedDate($('serviceDate').value) || tokyoToday();
    $('bulkServiceDateMode').value = 'single';
    renderBulkOperationDateList([baseDate]);
    $('bulkOperationDatePicker').value = '';
    $('bulkServiceDateStart').value = displayDate(baseDate);
    $('bulkServiceDateEnd').value = displayDate(baseDate);
    updateBulkOperationDateControls();
  }

  function updateBulkOperationDateControls() {
    const mode = $('bulkServiceDateMode').value;
    document.querySelectorAll('.bulk-date-mode-single').forEach(element => element.classList.toggle('hidden', mode !== 'single'));
    document.querySelectorAll('.bulk-date-mode-multiple').forEach(element => element.classList.toggle('hidden', mode !== 'multiple'));
    document.querySelectorAll('.bulk-date-mode-range').forEach(element => element.classList.toggle('hidden', mode !== 'range'));
    const baseDate = normalizedDate($('serviceDate').value);
    $('bulkSingleDateDisplay').textContent = displayDate(baseDate) || '―';
    const dates = bulkOperationDateListValues();
    if (mode === 'multiple') $('bulkOperationDateSummary').textContent = dates.length ? `${dates.length}日：${dates.map(displayDate).join('・')}` : '日付を追加してください';
    else if (mode === 'range') $('bulkOperationDateSummary').textContent = `${$('bulkServiceDateStart').value || '―'} ～ ${$('bulkServiceDateEnd').value || '―'}`;
    else $('bulkOperationDateSummary').textContent = displayDate(baseDate) || '―';
  }

  function addBulkOperationDate() {
    const date = normalizedDate($('bulkOperationDatePicker').value);
    if (!date) {
      setMessage('一括登録に追加する日付はYYYY/MM/DD形式で入力してください。', 'error');
      return;
    }
    const dates = [...new Set([...bulkOperationDateListValues(), date])].sort();
    renderBulkOperationDateList(dates, [date]);
    $('bulkOperationDatePicker').value = '';
    updateBulkOperationDateControls();
    setMessage('');
  }

  function removeBulkOperationDates() {
    const removing = new Set(Array.from($('bulkOperationDateList').selectedOptions).map(option => option.value));
    if (!removing.size) {
      setMessage('一括登録から削除する日付を一覧で選択してください。', 'error');
      return;
    }
    renderBulkOperationDateList(bulkOperationDateListValues().filter(date => !removing.has(date)));
    updateBulkOperationDateControls();
    setMessage('');
  }

  function bulkServiceDateResult() {
    return adminUtils.dateSelectionResult({
      mode: $('bulkServiceDateMode').value,
      single: $('serviceDate').value,
      dates: bulkOperationDateListValues(),
      start: $('bulkServiceDateStart').value,
      end: $('bulkServiceDateEnd').value,
    });
  }

  function collectBulkServiceDates() {
    const result = bulkServiceDateResult();
    return result.ok ? result.spec : null;
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
        <td><input data-field="arrival" value="${escapeHtml(change.arrival ?? stop.arrival ?? '')}" data-original="${escapeHtml(stop.arrival || '')}"></td>
        <td><input data-field="departure" value="${escapeHtml(change.departure ?? stop.departure ?? '')}" data-original="${escapeHtml(stop.departure || '')}"></td>
        <td><input data-field="trackN" value="${escapeHtml(change.trackN ?? stop.trackN ?? '')}" data-original="${escapeHtml(stop.trackN || '')}"></td>
        <td><input data-field="note" value="${escapeHtml(change.note || '')}" data-original=""></td></tr>`;
    }).join(''));
    $('timeRows').querySelectorAll('input').forEach(input => input.addEventListener('input', () => markDirty()));
  }

  function selectTrain(train) {
    if (!train) return;
    const existing = existingNoticeForTrain(train);
    if (existing) {
      editNotice(existing, train);
      return;
    }
    if (dirty && !confirm('未保存の入力を破棄して、選択列車で新規作成しますか？')) return;
    selectedSchedule = train;
    currentNotice = null;
    $('title').value = train.defaultTitle || '列車運転';
    $('operationKind').value = '';
    $('operationState').value = '';
    if (dailyMode()) { $('operationState').value = 'unknown'; $('operationKind').value = 'unconfirmed'; fillDailyLayers({scheduleSnapshot:train}); }
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
    $('clearActivity').disabled = true;
    $('pdfPreview').disabled = true;
    markDirty(false);
    renderCatalog();
    renderNotices();
    $('statusText').textContent = `${train.trainNumber} ${train.origin}～${train.destination}を選択しました。`;
  }

  function editNotice(item, catalogTrain = null) {
    if (!item) return;
    if (dirty && !confirm('未保存の入力を破棄して、登録済み情報を開きますか？')) return;
    currentNotice = item;
    selectedSchedule = catalogTrain || catalog.find(train => train.scheduleKey === item.scheduleKey)
      || catalog.find(train => sameIntegratedTrain(train, item))
      || catalog.find(train => sameUniqueTrainNumber(train, item)) || item.scheduleSnapshot || null;
    if (dailyMode() && item.scheduleSnapshot) selectedSchedule = item.scheduleSnapshot;
    $('title').value = item.title || '';
    $('operationKind').value = item.operationKind || '';
    $('operationState').value = dailyMode() ? U.layers(item).base : item.operationState || '';
    if (dailyMode()) fillDailyLayers(item);
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
    $('clearActivity').disabled = item.status === 'withdrawn' && item.operationState === 'unknown';
    $('pdfPreview').disabled = dailyMode() ? !dailyDay.noticeNumber || dailyDay.publishedStatus !== 'published' : item.status !== 'published';
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
    if (dailyMode()) fillDailyLayers();
    setOperationDates();
    setSectionOptions(selectedSchedule?.stops || [], '', '');
    renderTimeRows(selectedSchedule, []);
    $('recordIdentity').textContent = '新規';
    $('noticeNumberDisplay').textContent = '未採番（初回公開時に自動採番）';
    $('createdAtDisplay').textContent = '―';
    $('updatedAtDisplay').textContent = '―';
    $('withdraw').disabled = true;
    $('clearActivity').disabled = true;
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
    if (dailyMode()) return saveDailyFromTrain(status);
    const dateResult = serviceDateResult();
    if (!dateResult.ok) {
      setMessage(dateResult.message, 'error');
      return;
    }
    const payload = Object.assign(formPayload(status), dateResult.spec);
    if (!payload.title || !payload.trainNumber || !payload.serviceDate || !payload.operationKind || !payload.operationState) {
      setMessage('表題・列車番号・施行日・手配区分・活休区分は必須です。', 'error');
      return;
    }
    if (status === 'published' && payload.operationState === 'unknown') {
      setMessage('活休未入力は「活休未入力へ戻す」で設定してください。未入力状態は公開できません。', 'error');
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
    if (dailyMode()) {
      const kind = $('operationKind').value;
      if (kind === 'time_change') $('dailyTimeChanged').checked = true;
      else if (kind === 'prohibition') $('dailyProhibited').checked = true;
      else if (['operation','suspension','unconfirmed'].includes(kind)) $('operationState').value = {operation:'operate', suspension:'suspend', unconfirmed:'unknown'}[kind];
      markDirty(); return;
    }
    const map = {unconfirmed: 'unknown', operation: 'operate', suspension: 'suspend', time_change: 'changed', prohibition: 'prohibited'};
    if (map[$('operationKind').value]) $('operationState').value = map[$('operationKind').value];
    markDirty();
  }

  async function initialize() {
    $('serviceDate').value = displayDate(tokyoToday());
    const ready = await window.TayunetAuthReady;
    if (!ready.ok) return;
    isAdmin = ready.profile.isAdmin === true;
    $('saveDraft').disabled = !isAdmin; $('publish').disabled = !isAdmin;
    $('operatorName').textContent = `${ready.user.email || '利用者'} / ${ready.profile.isAdmin ? '管理者' : '閲覧権限'}`;
    if (!ready.profile.isAdmin) setMessage('閲覧はできますが、保存・公開には管理者権限が必要です。', 'error');
    await loadDate();
  }

  $('loadDate').addEventListener('click', loadDate);
  $('managementWorkflow').addEventListener('change', () => {
    if (dirty && !confirm('未保存の入力を破棄して管理対象を切り替えますか？')) { $('managementWorkflow').value = loadedWorkflow; return; }
    markDirty(false); loadDate();
  });
  $('addDailySection').addEventListener('click', () => { if (!isAdmin || dailyBusy) return; if ($('dailySectionRows').children.length >= 100) return setMessage('区間指定は100件以内です。', 'error'); addDailySection(); markDirty(); });
  $('dailySectionRows').addEventListener('input', () => markDirty());
  $('diagramPeriod').addEventListener('change', loadDate);
  $('trainQuery').addEventListener('input', renderCatalog);
  $('trainCategory').addEventListener('change', renderCatalog);
  $('trainLine').addEventListener('change', renderCatalog);
  $('catalogSort').addEventListener('change', renderCatalog);
  $('selectVisible').addEventListener('click', () => { filteredCatalog().forEach(train => selectedCatalogKeys.add(train.scheduleKey)); renderCatalog(); });
  $('clearSelection').addEventListener('click', () => { selectedCatalogKeys.clear(); renderCatalog(); });
  $('bulkOperate').addEventListener('click', () => bulkRegister('operate'));
  $('bulkSuspend').addEventListener('click', () => bulkRegister('suspend'));
  $('bulkClearActivity').addEventListener('click', () => clearActivityForTrains(
    catalog.filter(train => selectedCatalogKeys.has(train.scheduleKey)), collectBulkServiceDates(), true,
  ));
  $('newNotice').addEventListener('click', () => resetForm());
  $('newNoticeMenu').addEventListener('click', event => { event.preventDefault(); resetForm(); });
  $('saveDraft').addEventListener('click', () => save('draft'));
  $('publish').addEventListener('click', () => save('published'));
  $('clearActivity').addEventListener('click', () => {
    const train = selectedSchedule || currentNotice?.scheduleSnapshot || currentNotice;
    if (train) clearActivityForTrains([Object.assign({}, train, {trainNumber: currentNotice?.trainNumber || train.trainNumber})], collectServiceDates());
  });
  $('withdraw').addEventListener('click', () => { if (confirm('公開情報を取下げますか？通達番号と変更履歴は残ります。')) save('withdrawn'); });
  $('duplicate').addEventListener('click', () => {
    currentNotice = null;
    $('recordIdentity').textContent = '複製 / 新規';
    $('noticeNumberDisplay').textContent = '未採番（初回公開時に自動採番）';
    $('createdAtDisplay').textContent = '―';
    $('updatedAtDisplay').textContent = '―';
    $('withdraw').disabled = true;
    $('clearActivity').disabled = true;
    $('pdfPreview').disabled = true;
    markDirty();
  });
  $('pdfPreview').addEventListener('click', () => {
    if (!currentNotice) return;
    const serviceDate = normalizedDate($('serviceDate').value) || currentNotice.serviceDate;
    if (dailyMode()) { window.open(`daily-notice.html?serviceDate=${encodeURIComponent(serviceDate)}&sort=${encodeURIComponent($('catalogSort').value)}`, '_blank', 'noopener'); return; }
    window.open(`notice.html?id=${encodeURIComponent(currentNotice.id)}&serviceDate=${encodeURIComponent(serviceDate)}&print=1`, '_blank', 'noopener');
  });
  $('operationKind').addEventListener('change', syncKindAndState);
  $('serviceDateMode').addEventListener('change', () => {
    if ($('serviceDateMode').value === 'multiple' && !operationDateListValues().length) {
      const baseDate = normalizedDate($('serviceDate').value);
      if (baseDate) renderOperationDateList([baseDate]);
    }
    updateOperationDateControls();
    markDirty();
  });
  $('addOperationDate').addEventListener('click', addOperationDate);
  $('operationDatePicker').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addOperationDate(); } });
  $('removeOperationDate').addEventListener('click', removeOperationDates);
  $('bulkServiceDateMode').addEventListener('change', () => {
    if ($('bulkServiceDateMode').value === 'multiple' && !bulkOperationDateListValues().length) {
      const baseDate = normalizedDate($('serviceDate').value);
      if (baseDate) renderBulkOperationDateList([baseDate]);
    }
    updateBulkOperationDateControls();
  });
  $('bulkAddOperationDate').addEventListener('click', addBulkOperationDate);
  $('bulkOperationDatePicker').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addBulkOperationDate(); } });
  $('bulkRemoveOperationDate').addEventListener('click', removeBulkOperationDates);
  $('serviceDate').addEventListener('input', () => { updateOperationDateControls(); updateBulkOperationDateControls(); });
  ['serviceDateStart', 'serviceDateEnd'].forEach(id => $(id).addEventListener('input', () => { updateOperationDateControls(); markDirty(); }));
  ['bulkServiceDateStart', 'bulkServiceDateEnd'].forEach(id => $(id).addEventListener('input', updateBulkOperationDateControls));
  document.querySelectorAll('.editor-scroll input, .editor-scroll select, .editor-scroll textarea').forEach(control => {
    if (control.id !== 'operationKind') control.addEventListener('input', () => markDirty());
  });
  setInterval(() => { $('clock').textContent = new Date().toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}); }, 1000);
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  initialize();
})();
