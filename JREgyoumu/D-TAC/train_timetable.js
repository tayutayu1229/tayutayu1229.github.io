const params = new URLSearchParams(location.search);
const targetId = params.get('id');
const FILES_API = TayunetDocumentAPI.apiBase + '/files';
const FILE_BASE = TayunetDocumentAPI.fileBase;
const MARKER_COLORS = ['red','green','blue','yellow','brown'];
const MARKER_TEXTS = ['無地','徐行','規制','注意','両数','停車','始発','時変','合図'];

let train = null;
let isRunning = false;
let locationEnabled = true;
let activePosition = null;
let lastEventHour = null;
let markerTarget = null;
let markerColor = 'green';
let markers = new Map();
let attachmentData = [];
let attachmentsLoaded = false;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  fitDevice();
  setupClock();
  setupControls();
  setupMarkerMenu();
  try {
    let group = readTransferredTrain();
    if (!group.length) group = findTrain(await fetchTimetables());
    if (!group.length) throw new Error(targetId ? '該当する列車がありません。' : '列車が選択されていません。');
    train = mergeTrainSegments(dedupeSegments(group));
    loadMarkers();
    renderSummary(train);
    renderTimetable(train);
    renderOperationState();
  } catch (error) {
    document.getElementById('timetable-body').innerHTML = `<div class="error">${esc(error.message || '時刻表を読み込めませんでした。')}</div>`;
  }
}

function fitDevice() {
  const apply = () => {
    // 実機同様の3:4を維持し、PCでは高さに合わせて横幅まで細くしない。
    const scale = Math.min(1,innerWidth/768);
    document.documentElement.style.setProperty('--scale',String(Math.max(.3,scale)));
  };
  apply();
  addEventListener('resize',apply,{passive:true});
  addEventListener('orientationchange',apply,{passive:true});
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
  document.getElementById('remarks-toggle').addEventListener('click',() => document.getElementById('remarks-panel').classList.toggle('open'));
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
  const attachments = view === 'attachments';
  document.querySelectorAll('.timetable-view').forEach(element => { element.hidden = attachments; });
  document.getElementById('attachments-view').hidden = !attachments;
  document.getElementById('timetable-tab').classList.toggle('active',!attachments);
  document.getElementById('attachments-tab').classList.toggle('active',attachments);
  if (attachments) loadAttachments();
}

function readTransferredTrain() {
  try {
    const value = JSON.parse(sessionStorage.getItem('selectedTrainData') || '[]');
    return Array.isArray(value) ? value : value ? [value] : [];
  } catch { return []; }
}

async function fetchTimetables() {
  return TayunetPrivateData.fetchTimetables();
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
  body.innerHTML = data.stops.map((stop,index) => rowHtml(stop,index,data.stops)).join('');
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
    openMarkerMenu(Number(button.closest('.timetable-row').dataset.index));
  }));
}

function rowHtml(stop,index,stops) {
  const passing = isPassing(stop,index,stops.length);
  const previousTime = previousDeparture(stops,index);
  const currentTime = seconds(stop.arrival) ?? seconds(stop.departure);
  const runtime = index ? formatDuration(previousTime,currentTime) : '';
  const arrival = passing && !String(stop.arrival ?? '').trim() && rawTime(stop.departure) ? '↓' : stop.arrival;
  const marker = markers.get(index);
  return `<section class="timetable-row timetable-grid" data-index="${index}">
    <div class="run-time" title="駅間を選択">${runtime}</div>
    <div class="station${passing ? ' pass' : ''}" title="駅を選択">${stationMarkup(stop.station)}</div>
    <div class="time-cell${passing ? ' pass' : ''}">${timeMarkup(arrival,passing)}</div>
    <div class="time-cell${passing ? ' pass' : ''}">${timeMarkup(stop.departure,passing)}</div>
    <div class="track">${esc(displayTrack(stop.trackN))}</div>
    <div class="limit">${esc(stop.speedLimit || '')}</div>
    <div class="memo">${esc(stop.memo || stop.article || '')}</div>
    <button class="marker-button${marker ? ` has-marker marker-${marker.color}` : ''}" type="button" aria-label="マーカー">${esc(marker?.text || '')}</button>
  </section>`;
}

function rawTime(value) {
  const text = String(value ?? '').trim();
  if (!text || ['||','↓','…','=','＝','=='].includes(text)) return null;
  const [h='0',m='0',s='0'] = text.split(':');
  return {h:Number(h),m:Number(m),s:Number(s)};
}

function timeMarkup(value,passing) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (['||','↓','…'].includes(text)) return '<span class="pass-arrow">↓</span>';
  if (['=','＝','=='].includes(text)) return '<span class="end-mark"></span>';
  const t = rawTime(text);
  if (!t) return '';
  const showHour = !passing || lastEventHour === null || lastEventHour !== t.h;
  lastEventHour = t.h;
  return `<span class="time-main"><span class="time-hour">${showHour ? `${t.h}.` : ''}</span><span class="time-minute">${String(t.m).padStart(2,'0')}</span><small class="time-sec">${t.s ? String(t.s).padStart(2,'0') : ''}</small></span>`;
}

function isPassing(stop,index,length) {
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
  return `<span>${min}</span>${sec ? `<small class="small-sec">${String(sec).padStart(2,'0')}</small>` : ''}`;
}

function toggleRun() {
  isRunning = !isRunning;
  if (isRunning) setPosition('station',0,true);
  else activePosition = null;
  renderOperationState();
}

function renderOperationState() {
  const button = document.getElementById('run-button');
  button.classList.toggle('running',isRunning);
  button.innerHTML = isRunning ? '<span class="run-icon">⊘</span> 運行終了' : '<span class="run-icon">▶</span> 運行開始';
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
  activePosition = {kind,index};
  renderOperationState();
  if (scroll) document.querySelector(`.timetable-row[data-index="${index}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});
}

function stepPosition(direction) {
  if (!isRunning || !train?.stops?.length) return;
  let ordinal = activePosition?.kind === 'between' ? activePosition.index*2-1 : (activePosition?.index || 0)*2;
  ordinal = Math.max(0,Math.min(train.stops.length*2-2,ordinal+direction));
  const kind = ordinal%2 ? 'between' : 'station';
  const index = kind === 'between' ? (ordinal+1)/2 : ordinal/2;
  setPosition(kind,index,true);
}

function setLocation(value) {
  locationEnabled = value;
  document.getElementById('location-on').classList.toggle('selected',value);
  document.getElementById('location-off').classList.toggle('selected',!value);
}

function toggleSummary() {
  const summary = document.getElementById('train-summary');
  const collapsed = summary.classList.toggle('collapsed');
  document.getElementById('collapse-button').textContent = collapsed ? '⌄' : '⌃';
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
  const existing = markers.get(index);
  markerColor = existing?.color || 'green';
  document.getElementById('marker-custom-text').value = existing?.text || '';
  selectMarkerColor(markerColor);
  document.getElementById('marker-menu').hidden = false;
}
function closeMarkerMenu() { document.getElementById('marker-menu').hidden = true; markerTarget = null; }
function selectMarkerColor(color) {
  markerColor = color;
  document.querySelectorAll('.marker-color').forEach(button => button.classList.toggle('selected',button.dataset.color === color));
}
function applyMarker(text) {
  if (markerTarget === null) return;
  markers.set(markerTarget,{color:markerColor,text:String(text).slice(0,4)});
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
  button.textContent = marker?.text || '';
}
function markerStorageKey() { return `dtac-markers:${targetId || train?.trainNumber || 'train'}`; }
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
    TayunetDocumentAPI.showLoginNotice(list, '運転関係書類を表示するにはデータ利用ログインが必要です。');
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
function openDocument(file) {
  const url = fileUrl(file);
  const body = document.getElementById('document-body');
  document.getElementById('document-title').textContent = file.title || file.filename;
  document.getElementById('document-open').href = url;
  if (file.type === 'image') {
    body.innerHTML = `<img src="${esc(url)}" alt="${esc(file.title || file.filename)}">`;
  } else if (file.type === 'pdf') {
    body.innerHTML = `<iframe src="${esc(url)}#view=FitH" title="${esc(file.title || file.filename)}"></iframe>`;
  } else if (file.type === 'word' || file.type === 'excel') {
    body.innerHTML = '<div class="document-fallback">保護されたOffice文書は埋め込み表示できません。<br>「別画面で開く」を使用してください。</div>';
  } else {
    body.innerHTML = `<div class="document-fallback">この形式は埋め込み表示できません。<br>「別画面で開く」を使用してください。</div>`;
  }
  document.getElementById('document-viewer').hidden = false;
}
function closeDocument() {
  document.getElementById('document-viewer').hidden = true;
  document.getElementById('document-body').innerHTML = '';
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
  return `<span class="${classes.join(' ')}">${chars.map(char => `<span>${esc(char)}</span>`).join('')}</span>`;
}
function displayDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : text;
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
