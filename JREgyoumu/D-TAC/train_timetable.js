const params = new URLSearchParams(location.search);
const targetId = params.get('id');
let train = null;
let activeIndex = 0;
let isRunning = false;
let locationEnabled = true;
let lastEventHour = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupClock();
  setupControls();
  try {
    let group = readTransferredTrain();
    if (!group.length) group = findTrain(await fetchTimetables());
    if (!group.length) throw new Error(targetId ? '該当する列車がありません。' : '列車が選択されていません。');
    train = mergeTrainSegments(dedupeSegments(group));
    renderSummary(train);
    renderTimetable(train);
    chooseInitialIndex();
  } catch (error) {
    document.getElementById('timetable-body').innerHTML = `<div class="error">${esc(error.message || '時刻表を読み込めませんでした。')}</div>`;
  }
}

function setupClock() {
  const clock = document.getElementById('live-clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('ja-JP',{hour12:false}); };
  tick(); setInterval(tick,1000);
}

function setupControls() {
  document.getElementById('back-button').addEventListener('click', () => location.assign('train_list.html'));
  document.getElementById('run-button').addEventListener('click', toggleRun);
  document.getElementById('location-on').addEventListener('click', () => setLocation(true));
  document.getElementById('location-off').addEventListener('click', () => setLocation(false));
  document.getElementById('step-prev').addEventListener('click', () => setActive(activeIndex - 1,true));
  document.getElementById('step-next').addEventListener('click', () => setActive(activeIndex + 1,true));
  document.getElementById('collapse-button').addEventListener('click', toggleSummary);
  document.getElementById('remarks-toggle').addEventListener('click', () => document.getElementById('remarks-panel').classList.toggle('open'));
}

function readTransferredTrain() {
  try {
    const value = JSON.parse(sessionStorage.getItem('selectedTrainData') || '[]');
    return Array.isArray(value) ? value : value ? [value] : [];
  } catch { return []; }
}

async function fetchTimetables() {
  const local = ['localhost','127.0.0.1'].includes(location.hostname) || location.protocol === 'file:';
  const candidates = local ? ['./timetables.json','https://tayunet-traininfo.com/T-time/timetables.json'] : ['https://tayunet-traininfo.com/T-time/timetables.json','./timetables.json'];
  for (const path of candidates) {
    try { const response = await fetch(path); if (response.ok) return response.json(); } catch { /* next */ }
  }
  throw new Error('時刻表データを読み込めませんでした。');
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
    seen.add(key); return true;
  });
}

function mergeTrainSegments(segments) {
  const base = {...segments[0],stops:[],lines:[]};
  segments.forEach((segment,segmentIndex) => {
    if (segment.line && !base.lines.includes(segment.line)) base.lines.push(segment.line);
    (segment.stops || []).forEach((stop,stopIndex) => {
      const previous = base.stops.at(-1);
      if (segmentIndex && stopIndex === 0 && previous?.station === stop.station) {
        base.stops[base.stops.length - 1] = {...previous,...stop,arrival:previous.arrival || stop.arrival,departure:stop.departure || previous.departure,trackN:stop.trackN || previous.trackN};
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
  body.querySelectorAll('.timetable-row').forEach(row => row.addEventListener('click', () => setActive(Number(row.dataset.index),true)));
  body.querySelectorAll('.marker-button').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation(); button.classList.toggle('marked');
  }));
}

function rowHtml(stop,index,stops) {
  const passing = isPassing(stop,index,stops.length);
  const previousTime = previousDeparture(stops,index);
  const currentTime = seconds(stop.arrival) ?? seconds(stop.departure);
  const runtime = index ? formatDuration(previousTime,currentTime) : '';
  const arrival = passing && !String(stop.arrival ?? '').trim() && rawTime(stop.departure) ? '↓' : stop.arrival;
  const track = displayTrack(stop.trackN);
  const memo = stop.memo || stop.article || '';
  return `<section class="timetable-row timetable-grid" data-index="${index}">
    <div class="run-time">${runtime}</div>
    <div class="station${passing ? ' pass' : ''}">${stationMarkup(stop.station)}</div>
    <div class="time-cell${passing ? ' pass' : ''}">${timeMarkup(arrival,passing)}</div>
    <div class="time-cell${passing ? ' pass' : ''}">${timeMarkup(stop.departure,passing)}</div>
    <div class="track">${esc(track)}</div>
    <div class="limit">${esc(stop.speedLimit || '')}</div>
    <div class="memo">${esc(memo)}</div>
    <button class="marker-button" type="button" aria-label="マーカー"></button>
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
  const t = rawTime(text); if (!t) return '';
  const showHour = !passing || lastEventHour === null || lastEventHour !== t.h;
  lastEventHour = t.h;
  return `<span class="time-main">${showHour ? `${t.h}.` : ''}${String(t.m).padStart(2,'0')}<small class="time-sec">${t.s ? String(t.s).padStart(2,'0') : ''}</small></span>`;
}

function isPassing(stop,index,length) {
  const a = String(stop.arrival ?? '').trim(), d = String(stop.departure ?? '').trim();
  const symbol = value => ['||','↓','…'].includes(value);
  return symbol(a) || symbol(d) || (!a && !!rawTime(d) && index > 0 && index < length - 1);
}

function seconds(value) { const t = rawTime(value); return t ? t.h*3600+t.m*60+t.s : null; }
function previousDeparture(stops,index) {
  for (let i=index-1;i>=0;i--) { const value = seconds(stops[i].departure) ?? seconds(stops[i].arrival); if (value !== null) return value; }
  return null;
}
function formatDuration(start,end) {
  if (start === null || end === null) return '';
  let diff=end-start; if (diff<0) diff+=86400;
  const min=Math.floor(diff/60), sec=diff%60;
  return `<span>${min}</span>${sec ? `<small class="small-sec">${String(sec).padStart(2,'0')}</small>` : ''}`;
}

function chooseInitialIndex() {
  if (!train?.stops?.length) return;
  const now = new Date();
  const nowSec = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();
  let found = train.stops.findIndex(stop => (seconds(stop.departure) ?? seconds(stop.arrival) ?? Infinity) >= nowSec);
  if (found < 0) found = 0;
  setActive(found,false);
}

function setActive(index,scroll) {
  if (!train?.stops?.length) return;
  activeIndex = Math.max(0,Math.min(train.stops.length-1,index));
  document.querySelectorAll('.timetable-row').forEach((row,rowIndex) => {
    row.classList.toggle('active',rowIndex===activeIndex);
    row.classList.toggle('passed',rowIndex<activeIndex);
    row.querySelector('.run-time')?.classList.toggle('active-run',rowIndex===activeIndex);
  });
  if (scroll) document.querySelector(`.timetable-row[data-index="${activeIndex}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});
}

function toggleRun() {
  isRunning=!isRunning;
  const button=document.getElementById('run-button');
  button.classList.toggle('running',isRunning);
  button.innerHTML=isRunning ? '<span>⊘</span> 運行終了' : '<span>▶</span> 運行開始';
  if (isRunning && locationEnabled) chooseInitialIndex();
}
function setLocation(value) {
  locationEnabled=value;
  document.getElementById('location-on').classList.toggle('selected',value);
  document.getElementById('location-off').classList.toggle('selected',!value);
}
function toggleSummary() {
  const summary=document.getElementById('train-summary');
  const collapsed=summary.classList.toggle('collapsed');
  document.getElementById('collapse-button').textContent=collapsed ? '⌄' : '⌃';
}

function displayTrack(value) {
  const text=String(value ?? '').trim();
  if (text==='中線') return '中';
  const hidden=new Set(['上本','下本','武上','武下','客上','客下','貨上','貨下','本線','快上','快下','電上','電下','京上','京下','南外','北外','山貨下','山貨上','大支下','大支上','須上','須下']);
  return hidden.has(text) ? '' : text.replace(/([0-9０-９])番$/,'$1');
}
function stationMarkup(value) {
  const chars=Array.from(String(value ?? '').replace(/[\s　]+/g,''));
  const classes=['station-glyphs']; if(chars.length===1) classes.push('single'); if(chars.length>4) classes.push('long');
  return `<span class="${classes.join(' ')}">${chars.map(char=>`<span>${esc(char)}</span>`).join('')}</span>`;
}
function displayDate(value) {
  const text=String(value || '').trim(), match=text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : text;
}
function esc(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
