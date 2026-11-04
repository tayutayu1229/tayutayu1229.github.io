const params = new URLSearchParams(location.search);
const targetId = params.get('id');
const FILES_API = TayunetDocumentAPI.apiBase + '/files';
const FILE_BASE = TayunetDocumentAPI.fileBase;
const MARKER_COLORS = ['red','green','blue','yellow','brown'];
const MARKER_TEXTS = ['無地','停車','徐行','両数','規制','時変','合図'];

let train = null;
let isRunning = false;
let locationEnabled = false;
let markingMode = false;
let selectedMarkerText = '';
let workTrains = [];
let currentView = 'timetable';
let activePosition = null;
let lastEventHour = null;
let markerTarget = null;
let markerColor = 'green';
let markers = new Map();
let attachmentData = [];
let attachmentsLoaded = false;
let documentObjectUrl = null;
let documentRequestId = 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  fitDevice();
  setupClock();
  setupControls();
  setupMarkerMenu();
  setupDtacFeatures();
  showView('timetable');
  try {
    let group = readTransferredTrain();
    if (targetId && group.length && !findTrain(group).length) group = [];
    if (!group.length || group.some(item => item.source === 'operation-service')) group = findTrain(await fetchTimetables());
    if (!group.length) throw new Error(targetId ? '該当する列車がありません。' : '列車が選択されていません。');
    if (group.some(item => !manualDateMatches(item, params.get('date') || item.startDate))) throw new Error('この手入力時刻表は登録された施行日だけ使用できます。列車一覧から選び直してください。');
    train = mergeTrainSegments(dedupeSegments(group));
    workTrains = [train];
    await loadWorkTrains();
    loadMarkers();
    renderSummary(train);
    renderTimetable(train);
    renderOperationState();
    renderHako();
  } catch (error) {
    document.getElementById('run-button').disabled = true;
    renderOperationState();
    document.getElementById('timetable-body').innerHTML = `<div class="error">${esc(error.message || '時刻表を読み込めませんでした。')}</div>`;
  }
}

function fitDevice() {
  // Match TRViS breakpoints in CSS; never scale the text down with the whole screen.
  addEventListener('resize', () => renderHako(), {passive:true});
}

function setupClock() {
  const clock = document.getElementById('live-clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('ja-JP',{hour12:false}); };
  tick();
  setInterval(tick,1000);
}

function setupControls() {
  const menuButton = document.getElementById('menu-button');
  menuButton.addEventListener('click',toggleMenu);
  menuButton.addEventListener('pointerdown',() => menuButton.classList.add('pressed'));
  ['pointerup','pointercancel','pointerleave'].forEach(name => menuButton.addEventListener(name,() => menuButton.classList.remove('pressed')));
  document.getElementById('menu-scrim').addEventListener('click',closeMenu);
  document.getElementById('back-button').addEventListener('click',() => location.assign('train_list.html'));
  document.querySelectorAll('[data-view],[data-open-view]').forEach(button => button.addEventListener('click',() => showView(button.dataset.view || button.dataset.openView)));
  document.getElementById('run-button').addEventListener('click',toggleRun);
  document.getElementById('location-on').addEventListener('click',() => setLocation(true));
  document.getElementById('location-off').addEventListener('click',() => setLocation(false));
  document.getElementById('step-prev').addEventListener('click',() => stepPosition(-1));
  document.getElementById('step-next').addEventListener('click',() => stepPosition(1));
  document.getElementById('collapse-button').addEventListener('click',toggleSummary);
  document.getElementById('remarks-toggle').addEventListener('click',event => {
    const open = document.getElementById('remarks-panel').classList.toggle('open');
    event.currentTarget.setAttribute('aria-expanded',String(open));
  });
  document.getElementById('attachments-reload').addEventListener('click',() => loadAttachments(true));
  document.getElementById('attachment-search').addEventListener('input',renderAttachments);
  document.getElementById('document-close').addEventListener('click',closeDocument);
}

function toggleMenu() {
  const drawer = document.getElementById('menu-drawer');
  const open = !drawer.classList.contains('open');
  drawer.classList.toggle('open',open);
  document.getElementById('menu-scrim').classList.toggle('open',open);
  drawer.setAttribute('aria-hidden',String(!open));
  document.getElementById('menu-button').setAttribute('aria-expanded',String(open));
}
function closeMenu() {
  document.getElementById('menu-drawer').classList.remove('open');
  document.getElementById('menu-scrim').classList.remove('open');
  document.getElementById('menu-drawer').setAttribute('aria-hidden','true');
  document.getElementById('menu-button').setAttribute('aria-expanded','false');
}

function showView(view) {
  closeMenu();
  currentView = view;
  document.querySelectorAll('.timetable-view').forEach(element => { element.hidden = view !== 'timetable'; });
  document.getElementById('remarks-panel').hidden = view === 'attachments';
  document.getElementById('attachments-view').hidden = view !== 'attachments';
  document.getElementById('hako-view').hidden = view !== 'hako';
  document.querySelectorAll('#hako-tab,#timetable-tab,#attachments-tab').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active',active);
    button.setAttribute('role','tab');
    button.setAttribute('aria-selected',String(active));
  });
  if (view === 'attachments') loadAttachments();
  if (view === 'hako') renderHako();
}

function readTransferredTrain() {
  try {
    const value = JSON.parse(sessionStorage.getItem('selectedTrainData') || '[]');
    return Array.isArray(value) ? value : value ? [value] : [];
  } catch { return []; }
}

async function fetchTimetables() {
  return TayunetPrivateData.fetchTimetables({selectionList:1});
}

function manualDateMatches(train, value) {
  return !train.operationServiceDate || String(train.operationServiceDate).replaceAll('-', '/') === String(value || '').replaceAll('-', '/');
}

function findTrain(allData) {
  if (!targetId) return [];
  return allData.filter(item => {
    const raw = item.startDate || item.dayType || '';
    const p = raw.split(/[\/-]/);
    const dateKey = p.length >= 3 ? `${Number(p[1])}/${Number(p[2])}` : raw;
    return `${dateKey}_${item.trainNumber}` === targetId;
  });
}

function dedupeSegments(segments) {
  const seen = new Set();
  return segments.filter(segment => {
    const key = JSON.stringify([segment.line,segment.stops,segment.speed,segment.power]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeTrainSegments(segments) {
  const base = {...segments[0],stops:[],lines:[]};
  segments.forEach((segment,segmentIndex) => {
    if (segment.line && !base.lines.includes(segment.line)) base.lines.push(segment.line);
    (segment.stops || []).forEach((stop,stopIndex) => {
      const previous = base.stops.at(-1);
      if (segmentIndex && stopIndex === 0 && previous?.station === stop.station) {
        base.stops[base.stops.length-1] = {...previous,...stop,arrival:previous.arrival || stop.arrival,departure:stop.departure || previous.departure,trackN:stop.trackN || previous.trackN};
      } else base.stops.push({...stop});
    });
  });
  base.destination = segments.at(-1).destination || base.destination;
  return base;
}

function renderSummary(data) {
  const date = params.get('date') || data.startDate || data.dayType || '';
  document.getElementById('execution-date').textContent = displayDate(date);
  document.getElementById('work-name').textContent = data.workName || `${data.lines?.[0] || data.line || 'D-TAC'} 行路`;
  document.getElementById('train-number').textContent = data.trainNumber || '―';
  document.getElementById('max-speed').textContent = data.maxSpeed || '';
  document.getElementById('train-info').textContent = data.trainInfo || '';
  document.getElementById('before-departure').textContent = data.beforeDeparture || '';
  document.getElementById('next-day').textContent = data.isNextDay || (rawTime(data.stops?.[0]?.departure)?.h >= 24) ? '(翌)' : '';
  document.getElementById('horizontal-button').hidden = !data.horizontalTimetable;
  document.getElementById('speed-type').textContent = data.speed || '';
  document.getElementById('power').textContent = data.power || '';
  document.getElementById('car-count').textContent = data.carCount ? `${data.carCount} 両` : '';
  document.getElementById('begin-remarks').textContent = data.beginRemarks || '';
  document.getElementById('destination').textContent = data.destination ? `（${data.destination}行）` : '';
  document.getElementById('remarks-content').textContent = data.notes || data.memo || '注意事項はありません。';
}

function renderTimetable(data) {
  lastEventHour = null;
  const body = document.getElementById('timetable-body');
  body.innerHTML = data.stops.map((stop,index) => rowHtml(stop,index,data.stops)).join('') + afterTrainMarkup(data);
  body.querySelector('[data-next-train]')?.addEventListener('click',nextWorkTrain);
  data.stops.forEach((_,index) => refreshMarker(index));
  body.querySelectorAll('.station').forEach(cell => cell.addEventListener('click',event => {
    if (!isRunning) return;
    setPosition('station',Number(event.currentTarget.closest('.timetable-row').dataset.index),true);
  }));
  body.querySelectorAll('.run-time').forEach(cell => cell.addEventListener('click',event => {
    if (!isRunning) return;
    const index = Number(event.currentTarget.closest('.timetable-row').dataset.index);
    if (index > 0) setPosition('between',index,true);
  }));
  body.querySelectorAll('.marker-button').forEach(button => button.addEventListener('click',event => {
    event.stopPropagation();
    if (!markingMode) return;
    const index = Number(button.closest('.timetable-row').dataset.index);
    if (markers.has(index)) { markers.delete(index); saveMarkers(); refreshMarker(index); }
    else { markerTarget = index; applyMarker(selectedMarkerText); }
  }));
}

function rowHtml(stop,index,stops) {
  if (stop.isInfoRow) return `<section class="info-row">${esc(stop.station || stop.memo || '')}</section>`;
  const passing = isPassing(stop,index,stops.length);
  const previousTime = previousDeparture(stops,index);
  const currentTime = seconds(stop.arrival) ?? seconds(stop.departure);
  const runtime = stop.driveTimeMM != null ? `<span>${esc(String(stop.driveTimeMM).length > 2 ? '**' : stop.driveTimeMM)}</span><small class="small-sec">${esc(stop.driveTimeSS || '')}</small>` : index ? formatDuration(previousTime,currentTime) : '';
  const arrival = passing && !String(stop.arrival ?? '').trim() && rawTime(stop.departure) ? '↓' : stop.arrival;
  const marker = markers.get(index);
  const track = stop.arrivalTrack && stop.departureTrack && stop.arrivalTrack !== stop.departureTrack ? `着${displayTrack(stop.arrivalTrack)}\n発${displayTrack(stop.departureTrack)}` : displayTrack(stop.trackN || stop.arrivalTrack || stop.departureTrack);
  const trackLength = Math.max(2,...track.split('\n').map(line => Array.from(line).length));
  return `<section class="timetable-row timetable-grid" data-index="${index}">
    <div class="run-time" title="駅間を選択">${runtime}</div>
    <div class="station${passing ? ' pass' : ''}" title="駅を選択">${stationMarkup(stop.station)}</div>
    <div class="time-cell${passing ? ' pass' : ''}">${timeMarkup(arrival,passing)}</div>
    <div class="time-cell${passing ? ' pass' : ''}">${timeMarkup(stop.departure,passing)}</div>
    <div class="track" style="--track-scale:${Math.min(1,2/trackLength)}">${esc(track)}</div>
    <div class="limit">${esc([stop.runInLimit,stop.runOutLimit].filter(v => v != null && v !== '').join('\n') || stop.speedLimit || '')}</div>
    <div class="memo">${esc(stop.memo || stop.article || stop.note || '')}</div>
    <button class="marker-button${marker ? ` has-marker marker-${marker.color}` : ''}" type="button" aria-label="${esc(stop.station)}のマーカー">${esc(marker?.text || '')}</button>
  </section>`;
}

function rawTime(value) {
  const text = String(value ?? '').trim().replace(/^[#$¥￥]+/, '').replace(/^[([（［]/,'').replace(/[)\]）］]$/,'');
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  return match && Number(match[2]) < 60 && Number(match[3] || 0) < 60 ? {h:Number(match[1]),m:Number(match[2]),s:Number(match[3] || 0)} : null;
}

function timeMarkup(value,passing) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (['||','↓','…'].includes(text)) return '<span class="pass-arrow">↓</span>';
  if (['=','＝','=='].includes(text)) return '<span class="end-mark"></span>';
  const t = rawTime(text);
  if (!t) return esc(text);
  const showHour = !passing || lastEventHour === null || lastEventHour !== t.h;
  lastEventHour = t.h;
  const symbol = text.match(/^[#$¥￥]+/)?.[0] || '';
  const flag = symbol ? `<span class="operation-symbol" title="運休 $／時刻変更 #／運転禁止 ¥">${esc(symbol)}</span>` : '';
  const open = /^[([（［]/.test(text) ? esc(text[0]) : '';
  const close = /[)\]）］]$/.test(text) ? esc(text.at(-1)) : '';
  return `${flag}${open}<span class="time-main"><span class="time-hour">${showHour ? `${t.h % 24}.` : ''}</span><span class="time-minute">${String(t.m).padStart(2,'0')}</span><small class="time-sec">${t.s ? String(t.s).padStart(2,'0') : ''}</small></span>${close}`;
}

function isPassing(stop,index,length) {
  if (typeof stop.isPass === 'boolean') return stop.isPass;
  const a = String(stop.arrival ?? '').trim();
  const d = String(stop.departure ?? '').trim();
  const symbol = value => ['||','↓','…'].includes(value);
  return symbol(a) || symbol(d) || (!a && !!rawTime(d) && index > 0 && index < length-1);
}

function seconds(value) { const t = rawTime(value); return t ? t.h*3600+t.m*60+t.s : null; }
function previousDeparture(stops,index) {
  for (let i=index-1;i>=0;i--) {
    const value = seconds(stops[i].departure) ?? seconds(stops[i].arrival);
    if (value !== null) return value;
  }
  return null;
}
function formatDuration(start,end) {
  if (start === null || end === null) return '';
  let diff = end-start;
  if (diff < 0) diff += 86400;
  const min = Math.floor(diff/60);
  const sec = diff%60;
  return `<span>${min > 99 ? '**' : min}</span>${sec ? `<small class="small-sec">${String(sec).padStart(2,'0')}</small>` : ''}`;
}

function toggleRun() {
  if (!train?.stops?.length) return;
  isRunning = !isRunning;
  if (!isRunning) setLocation(false);
  if (isRunning) setPosition('station',Math.max(0,train.stops.findIndex(stop => !stop.isInfoRow)),true);
  else activePosition = null;
  renderOperationState();
}

function renderOperationState() {
  const button = document.getElementById('run-button');
  button.classList.toggle('running',isRunning);
  button.innerHTML = isRunning ? '<span class="run-icon">⊘</span> 運行終了' : '<span class="run-icon">▶</span> 運行開始';
  document.querySelector('.step-buttons').hidden = !isRunning || locationEnabled;
  document.getElementById('location-on').disabled = !isRunning || !hasCoordinates();
  document.getElementById('location-off').disabled = !isRunning;
  button.setAttribute('aria-pressed',String(isRunning));
  document.getElementById('step-prev').disabled = !isRunning;
  document.getElementById('step-next').disabled = !isRunning;
  document.querySelectorAll('.timetable-row').forEach(row => {
    const index = Number(row.dataset.index);
    row.classList.toggle('running-enabled',isRunning);
    row.classList.toggle('station-active',activePosition?.kind === 'station' && activePosition.index === index);
    row.classList.toggle('between-active',activePosition?.kind === 'between' && activePosition.index === index);
  });
}

function setPosition(kind,index,scroll) {
  if (!train?.stops?.length || !isRunning) return;
  index = Math.max(0,Math.min(train.stops.length-1,index));
  if (kind === 'between' && index === 0) kind = 'station';
  if (train.stops[index].isInfoRow) return;
  activePosition = {kind,index};
  renderOperationState();
  if (scroll) document.querySelector(`.timetable-row[data-index="${index}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});
}

function stepPosition(direction) {
  if (!isRunning || !train?.stops?.length) return;
  let ordinal = activePosition?.kind === 'between' ? activePosition.index*2-1 : (activePosition?.index || 0)*2;
  const max = train.stops.length*2-2;
  do {
    const next = Math.max(0,Math.min(max,ordinal+direction));
    if (next === ordinal) break;
    ordinal = next;
    const rowIndex = ordinal % 2 ? (ordinal+1)/2 : ordinal/2;
    if (!train.stops[rowIndex].isInfoRow) break;
  } while (ordinal > 0 && ordinal < max);
  const kind = ordinal%2 ? 'between' : 'station';
  const index = kind === 'between' ? (ordinal+1)/2 : ordinal/2;
  setPosition(kind,index,true);
}

function setLocation(value) {
  locationEnabled = value && isRunning && hasCoordinates();
  document.getElementById('location-on').classList.toggle('selected',locationEnabled);
  document.getElementById('location-off').classList.toggle('selected',!locationEnabled);
  document.getElementById('location-on').setAttribute('aria-pressed',String(locationEnabled));
  document.getElementById('location-off').setAttribute('aria-pressed',String(!locationEnabled));
  updateLocationWatch();
  renderOperationState();
}

function toggleSummary() {
  const expanded = document.getElementById('expanded-info');
  expanded.hidden = !expanded.hidden;
  const button = document.getElementById('collapse-button');
  button.textContent = expanded.hidden ? '⌄' : '⌃';
  button.setAttribute('aria-expanded',String(!expanded.hidden));
  button.setAttribute('aria-label',expanded.hidden ? '列車情報を展開する' : '列車情報を折りたたむ');
}

function setupMarkerMenu() {
  const options = document.getElementById('marker-options');
  options.innerHTML = `
    <div class="marker-colors">${MARKER_COLORS.map(color => `<button class="marker-color" type="button" data-color="${color}" aria-label="${color}"></button>`).join('')}</div>
    <div class="marker-texts">${MARKER_TEXTS.map(text => `<button class="marker-text" type="button" data-text="${text === '無地' ? '' : text}">${text}</button>`).join('')}</div>
    <div class="marker-custom"><input id="marker-custom-text" maxlength="4" placeholder="任意文字（例：70）"><button id="marker-custom-apply" type="button">設定</button></div>
    <button id="marker-clear" class="marker-clear" type="button">マーカーを消す</button>`;
  options.querySelectorAll('.marker-color').forEach(button => button.addEventListener('click',() => selectMarkerColor(button.dataset.color)));
  options.querySelectorAll('.marker-text').forEach(button => button.addEventListener('click',() => applyMarker(button.dataset.text)));
  document.getElementById('marker-custom-apply').addEventListener('click',() => applyMarker(document.getElementById('marker-custom-text').value.trim()));
  document.getElementById('marker-clear').addEventListener('click',clearMarker);
  document.getElementById('marker-menu-close').addEventListener('click',closeMarkerMenu);
  document.getElementById('marker-menu').addEventListener('click',event => { if (event.target.id === 'marker-menu') closeMarkerMenu(); });
}

function openMarkerMenu(index) {
  markerTarget = index;
  document.getElementById('marker-clear').hidden = index === null;
  const existing = markers.get(index);
  markerColor = existing?.color || markerColor;
  document.getElementById('marker-custom-text').value = existing?.text || '';
  selectMarkerColor(markerColor);
  document.getElementById('marker-menu').hidden = false;
  document.querySelector('.marker-color.selected')?.focus();
}
function closeMarkerMenu() { document.getElementById('marker-menu').hidden = true; markerTarget = null; document.getElementById('marker-mode').focus(); }
function selectMarkerColor(color) {
  markerColor = color;
  document.querySelectorAll('.marker-color').forEach(button => button.classList.toggle('selected',button.dataset.color === color));
}
function applyMarker(text) {
  selectedMarkerText = limitMarkerText(text);
  if (markerTarget === null) { closeMarkerMenu(); return; }
  markers.set(markerTarget,{color:markerColor,text:selectedMarkerText});
  saveMarkers();
  refreshMarker(markerTarget);
  closeMarkerMenu();
}
function clearMarker() {
  if (markerTarget === null) return;
  markers.delete(markerTarget);
  saveMarkers();
  refreshMarker(markerTarget);
  closeMarkerMenu();
}
function refreshMarker(index) {
  const button = document.querySelector(`.timetable-row[data-index="${index}"] .marker-button`);
  if (!button) return;
  const marker = markers.get(index);
  button.className = `marker-button${marker ? ` has-marker marker-${marker.color}` : ''}`;
  button.textContent = limitMarkerText(marker?.text || '');
  button.hidden = !markingMode && !marker;
  button.disabled = !markingMode;
  const row = button.closest('.timetable-row');
  row.dataset.markerColor = marker?.color || '';
  row.style.setProperty('--marker-tint', marker ? MARKER_TINTS[marker.color] || 'transparent' : 'transparent');
}
function markerStorageKey() { return `dtac-markers:${params.get('date') || train?.startDate || ''}:${train?.trainNumber || targetId || 'train'}`; }
function loadMarkers() {
  try { markers = new Map(JSON.parse(localStorage.getItem(markerStorageKey()) || '[]')); } catch { markers = new Map(); }
}
function saveMarkers() {
  try { localStorage.setItem(markerStorageKey(),JSON.stringify([...markers])); } catch { /* storage unavailable */ }
}

async function loadAttachments(force=false) {
  if (attachmentsLoaded && !force) return;
  const list = document.getElementById('attachment-list');
  list.innerHTML = '<div class="attachment-loading">運転関係書類を読み込んでいます…</div>';
  try {
    const response = await TayunetDocumentAPI.request('/api/files');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const files = await response.json();
    attachmentData = files.filter(file => file.tag === 'driving').sort((a,b) => dateValue(b.date)-dateValue(a.date));
    attachmentsLoaded = true;
    renderAttachments();
  } catch (error) {
    TayunetDocumentAPI.showLoginNotice(list, '運転関係書類を表示するには、管理者承認済みの通常のTAYUNETログインが必要です。追加のデータ用ログインはありません。');
  }
}

function renderAttachments() {
  if (!attachmentsLoaded) return;
  const query = document.getElementById('attachment-search').value.trim().toLowerCase();
  const files = attachmentData.filter(file => !query || `${file.title || ''} ${file.description || ''} ${file.filename || ''}`.toLowerCase().includes(query));
  const list = document.getElementById('attachment-list');
  if (!files.length) { list.innerHTML = '<div class="attachment-empty">該当する運転関係書類はありません。</div>'; return; }
  list.innerHTML = files.map((file,index) => `<button class="attachment-item" type="button" data-file-index="${attachmentData.indexOf(file)}">
    <span class="attachment-type ${file.type === 'image' ? 'image' : ''}">${esc((file.type || 'FILE').toUpperCase())}</span>
    <span class="attachment-info"><strong>${esc(file.title || file.filename)}</strong><span>${esc(file.description || '説明なし')}</span></span>
    <span class="attachment-date">${esc(file.date || '')}<br>${formatSize(file.size_kb)}</span>
  </button>`).join('');
  list.querySelectorAll('.attachment-item').forEach(button => button.addEventListener('click',() => openDocument(attachmentData[Number(button.dataset.fileIndex)])));
}

function fileUrl(file) { return `${FILE_BASE}/${encodeURIComponent(file.filename || file.title)}`; }
async function openDocument(file) {
  const requestId = ++documentRequestId;
  const url = fileUrl(file);
  const body = document.getElementById('document-body');
  document.getElementById('document-title').textContent = file.title || file.filename;
  const openLink = document.getElementById('document-open');
  openLink.href = '#';
  body.innerHTML = '<div class="document-fallback">認証済みファイルを読み込んでいます…</div>';
  document.getElementById('document-viewer').hidden = false;
  try {
    const response = await TayunetDocumentAPI.requestUrl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    if (requestId !== documentRequestId) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    if (documentObjectUrl) URL.revokeObjectURL(documentObjectUrl);
    documentObjectUrl = objectUrl;
    openLink.href = objectUrl;
    if (file.type === 'word' || file.type === 'excel' || file.type === 'other') openLink.download = file.filename || file.title;
    else openLink.removeAttribute('download');
    if (file.type === 'image') {
      body.innerHTML = `<img src="${esc(objectUrl)}" alt="${esc(file.title || file.filename)}">`;
    } else if (file.type === 'pdf') {
      body.innerHTML = `<iframe src="${esc(objectUrl)}#view=FitH" title="${esc(file.title || file.filename)}"></iframe>`;
    } else {
      body.innerHTML = '<div class="document-fallback">この形式は埋め込み表示できません。<br>「別画面で開く」を使用してください。</div>';
    }
  } catch (error) {
    if (requestId === documentRequestId) {
      TayunetDocumentAPI.showLoginNotice(body, 'この資料を表示するには、管理者承認済みの通常のTAYUNETログインが必要です。追加のデータ用ログインはありません。');
    }
  }
}
function closeDocument() {
  documentRequestId += 1;
  document.getElementById('document-viewer').hidden = true;
  document.getElementById('document-body').innerHTML = '';
  document.getElementById('document-open').href = '#';
  if (documentObjectUrl) {
    URL.revokeObjectURL(documentObjectUrl);
    documentObjectUrl = null;
  }
}

function dateValue(value) {
  const match = String(value || '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return match ? new Date(Number(match[1]),Number(match[2])-1,Number(match[3])).getTime() : 0;
}
function formatSize(kb) { return !kb ? '' : kb < 1024 ? `${kb} KB` : `${(kb/1024).toFixed(1)} MB`; }

function displayTrack(value) {
  const text = String(value ?? '').trim();
  if (text === '中線') return '中';
  const hidden = new Set(['上本','下本','武上','武下','客上','客下','貨上','貨下','本線','快上','快下','電上','電下','京上','京下','南外','北外','山貨下','山貨上','大支下','大支上','須上','須下']);
  return hidden.has(text) ? '' : text.replace(/([0-9０-９])番$/,'$1');
}
function stationMarkup(value) {
  const chars = Array.from(String(value ?? '').replace(/[\s　]+/g,''));
  const classes = ['station-glyphs'];
  if (chars.length === 1) classes.push('single');
  if (chars.length > 4) classes.push('long');
  return `<span class="${classes.join(' ')}" style="--station-scale:${Math.min(1,4/Math.max(1,chars.length))}">${chars.map(char => `<span>${esc(char)}</span>`).join('')}</span>`;
}
function displayDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : text;
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
