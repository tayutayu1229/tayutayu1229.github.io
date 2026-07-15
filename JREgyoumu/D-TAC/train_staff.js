const params = new URLSearchParams(location.search);
const targetId = params.get('id');
let specifiedDate = params.get('date') || localToday();
let renderedTrain = null;

document.addEventListener('DOMContentLoaded', loadStaff);

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0,10);
}

async function loadStaff() {
  const target = document.getElementById('render-target');
  try {
    let group = readTransferredTrain();
    if (!group.length) group = findTrain(await fetchTimetables());
    if (!group.length) throw new Error(targetId ? '該当する列車がありません。' : '列車が選択されていません。');
    renderedTrain = mergeTrainSegments(dedupeSegments(group));
    setupToolbar();
    setupDateControl(renderedTrain.startDate);
    renderA3(renderedTrain, group[0]);
  } catch (error) {
    target.innerHTML = `<div class="error">${esc(error.message || '時刻表を読み込めませんでした。')}</div>`;
  }
}

function setupToolbar() {
  const back = document.getElementById('back-button');
  const zoom = document.getElementById('preview-zoom');
  const value = document.getElementById('preview-zoom-value');
  back?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = 'train_list.html';
  });
  const saved = Number(localStorage.getItem('staffPreviewZoom')) || 100;
  const initial = Math.min(140,Math.max(40,saved));
  if (zoom) zoom.value = String(initial);
  const applyZoom = () => {
    const percent = Number(zoom?.value) || 100;
    document.getElementById('render-target')?.style.setProperty('--preview-scale',String(percent / 100));
    if (value) value.value = `${percent}%`;
    localStorage.setItem('staffPreviewZoom',String(percent));
  };
  zoom?.addEventListener('input',applyZoom);
  applyZoom();
}

function setupDateControl(fallbackDate) {
  const input = document.getElementById('execution-date');
  const button = document.getElementById('apply-date');
  if (!input || !button) return;
  const initial = specifiedDate || fallbackDate || '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(initial)) input.value = initial;
  else if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(initial)) {
    const [y,m,d] = initial.split('/'); input.value = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  button.addEventListener('click', () => {
    specifiedDate = input.value;
    if (specifiedDate) params.set('date',specifiedDate); else params.delete('date');
    history.replaceState(null,'',`${location.pathname}?${params.toString()}`);
    if (renderedTrain) renderA3(renderedTrain);
  });
}

function readTransferredTrain() {
  try {
    const value = JSON.parse(sessionStorage.getItem('selectedTrainData') || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function fetchTimetables() {
  const local = ['localhost','127.0.0.1'].includes(location.hostname);
  const candidates = local
    ? ['./timetables.json','https://tayunet-traininfo.com/T-time/timetables.json']
    : ['https://tayunet-traininfo.com/T-time/timetables.json','./timetables.json'];
  for (const path of candidates) {
    try {
      const response = await fetch(path);
      if (response.ok) return response.json();
    } catch { /* deployed source then local copy */ }
  }
  throw new Error('時刻表データを読み込めませんでした。');
}

function findTrain(allData) {
  if (!targetId) return [];
  return allData.filter(item => {
    const raw = item.startDate || item.dayType || '';
    const p = raw.split(/[\/\-]/);
    const dateKey = p.length >= 3 ? `${Number(p[1])}/${Number(p[2])}` : raw;
    return `${dateKey}_${item.trainNumber}` === targetId;
  });
}

function dedupeSegments(segments) {
  const seen = new Set();
  return segments.filter(segment => {
    const key = JSON.stringify([segment.line, segment.stops, segment.speed, segment.power]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function mergeTrainSegments(segments) {
  const base = { ...segments[0], stops: [], lines: [] };
  segments.forEach((segment, segmentIndex) => {
    if (segment.line && !base.lines.includes(segment.line)) base.lines.push(segment.line);
    (segment.stops || []).forEach((stop, stopIndex) => {
      const previous = base.stops.at(-1);
      if (segmentIndex && stopIndex === 0 && previous?.station === stop.station) {
        base.stops[base.stops.length - 1] = {
          ...previous, ...stop,
          arrival: previous.arrival || stop.arrival,
          departure: stop.departure || previous.departure,
          trackN: stop.trackN || previous.trackN
        };
      } else base.stops.push({ ...stop });
    });
  });
  base.destination = segments.at(-1).destination || base.destination;
  return base;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function rawTime(value) {
  const text = String(value ?? '').trim();
  if (!text || ['||','↓','…','=','＝','=='].includes(text)) return null;
  const [h = '0', m = '0', s = '0'] = text.split(':');
  return { h:Number(h), m:Number(m), s:Number(s) };
}

function isSymbol(value) { return ['||','↓','…'].includes(String(value ?? '').trim()); }

function isPassing(stop, index, length) {
  const a = String(stop.arrival ?? '').trim();
  const d = String(stop.departure ?? '').trim();
  return isSymbol(a) || isSymbol(d) || (!a && d && index > 0 && index < length - 1);
}

function timeCell(value, passing, abbreviated) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (isSymbol(text)) return '<div class="arrow">↓</div>';
  if (['=','＝','=='].includes(text)) return '<div class="endmark" aria-label="終端"></div>';
  const t = rawTime(text);
  if (!t) return '';
  return `<div class="time${passing ? ' pass' : ''}">
    <span class="hour-part">${abbreviated ? '' : `${t.h}.`}</span>
    <span class="minute-group"><span class="minute-part">${String(t.m).padStart(2,'0')}</span><span class="second-part">${t.s ? String(t.s).padStart(2,'0') : ''}</span></span>
  </div>`;
}

function speedParts(value) {
  const text = String(value || '').trim();
  return { maximum:'', kind:text };
}

function speedKindClass(value) {
  const length = Array.from(String(value || '')).length;
  return length > 20 ? ' kind-long kind-xlong' : length > 11 ? ' kind-long' : '';
}

function displayTrack(value) {
  const text = String(value ?? '').trim();
  if (text === '中線') return '中';
  const implicitTracks = new Set([
    '上本','下本','武上','武下','客上','客下','貨上','貨下','本線',
    '快上','快下','電上','電下','京上','京下','南外','北外',
    '山貨下','山貨上','大支下','大支上','須上','須下'
  ]);
  if (implicitTracks.has(text)) return '';
  return text.replace(/([0-9０-９])番$/, '$1');
}

function stationMarkup(value) {
  const chars = Array.from(String(value ?? '').replace(/[\s　]+/g,''));
  const classes = ['station-glyphs'];
  if (chars.length === 1) classes.push('single');
  if (chars.length > 4) classes.push('long');
  return `<span class="${classes.join(' ')}">${chars.map(char=>`<span>${esc(char)}</span>`).join('')}</span>`;
}

function displayDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  return match ? `${match[1]}年　${Number(match[2])}月${Number(match[3])}日` : text;
}

function seconds(value) {
  const t = rawTime(value); return t ? t.h * 3600 + t.m * 60 + t.s : null;
}

function runningTime(stops, index) {
  if (!index) return '';
  let start = null;
  for (let i = index - 1; i >= 0 && start === null; i--) start = seconds(stops[i].departure) ?? seconds(stops[i].arrival);
  const end = seconds(stops[index].arrival) ?? seconds(stops[index].departure);
  if (start === null || end === null) return '';
  let diff = end - start; if (diff < 0) diff += 86400;
  const min = Math.floor(diff / 60), sec = diff % 60;
  return `<span class="run-value"><span class="run-minute">${min}</span>${sec ? `<span class="run-second">${String(sec).padStart(2,'0')}</span>` : ''}</span>`;
}

function makeChunks(stops) {
  const max = 43;
  if (stops.length <= max) return [{ stops, offset:0 }];
  if (stops.length <= max * 2) {
    const midpoint = Math.ceil(stops.length / 2);
    return [
      { stops:stops.slice(0,midpoint + 1), offset:0 },
      { stops:stops.slice(midpoint), offset:midpoint }
    ];
  }
  const chunks = [];
  let offset = 0;
  while (offset < stops.length) {
    const end = Math.min(offset + max, stops.length);
    chunks.push({ stops:stops.slice(offset,end), offset });
    if (end === stops.length) break;
    offset = end - 1;
  }
  return chunks;
}

function cardHtml(train, stops, offset, continued, hasNext) {
  const rowHeight = Math.max(6.1, Math.min(12, 295 / Math.max(stops.length, 1)));
  const speed = speedParts(train.speed);
  const stationFont = Math.max(12, Math.min(21, rowHeight * 2.7));
  const timeFont = Math.max(16, Math.min(30, rowHeight * 3.65));
  const trackFont = Math.max(14, Math.min(26, rowHeight * 3.2));
  const runFont = Math.max(10, Math.min(18, rowHeight * 2.1));
  const style = `--station-font:${stationFont}px;--time-font:${timeFont}px;--track-font:${trackFont}px;--run-font:${runFont}px;--run-sec-font:${Math.max(7,runFont*.58)}px;--time-sec-font:${Math.max(7,timeFont*.42)}px;--arrow-font:${Math.max(14,timeFont*.9)}px;--end-font:${Math.max(18,timeFont*1.15)}px`;
  const rows = stops.map((stop, localIndex) => {
    const index = offset + localIndex;
    const passing = isPassing(stop, index, train.stops.length);
    const arrivalAbbr = passing;
    const departureAbbr = passing && index > 0;
    const trackText = displayTrack(stop.trackN);
    const trackLength = Math.min(5,Array.from(trackText).length);
    return `<tr class="stop-row" style="--row-height:${rowHeight}mm">
      <td class="run">${localIndex === 0 ? '' : runningTime(train.stops,index)}</td>
      <td class="station${passing ? ' pass' : ''}">${stationMarkup(stop.station)}</td>
      <td>${timeCell(stop.arrival,passing,arrivalAbbr)}</td>
      <td>${timeCell(stop.departure,passing,departureAbbr)}</td>
      <td class="track"><span class="track-glyph len-${trackLength}">${esc(trackText)}</span></td>
      <td class="limit">${esc(stop.speedLimit)}</td>
      <td class="memo">${esc(stop.memo)}</td>
    </tr>`;
  }).join('');
  return `<section class="card">
    <table class="staff" style="${style}">
      <colgroup><col style="width:10%"><col style="width:22%"><col style="width:18%"><col style="width:18%"><col style="width:12%"><col style="width:9%"><col style="width:11%"></colgroup>
      <thead>
        <tr class="top-label"><th colspan="2">列　車</th><th>最高速度<br>（Km／h）</th><th colspan="2">速度種別</th><th colspan="2">けん引定数</th></tr>
        <tr class="top-value"><td colspan="2" class="train-no"><span class="compressed">${esc(train.trainNumber)}</span></td><td class="speed"></td><td colspan="2" class="speed-kind${speedKindClass(speed.kind)}"><span>${esc(speed.kind)}</span></td><td colspan="2" class="power">${esc(train.power)}</td></tr>
        <tr class="column-head"><th>運転<br>時分</th><th>停車場名</th><th>着</th><th>発（通）</th><th>着発線</th><th>制限<br>速度</th><th>記事</th></tr>
      </thead>
      <tbody>
        <tr class="cars-row${train.carCount ? '' : ' empty-cars'}"><td colspan="7"><span class="cars">${esc(train.carCount || '')}</span>${train.carCount ? '<small>両</small>' : ''}<span class="continuation">${continued ? '（前頁から）' : ''}</span></td></tr>
        ${rows}
        <tr class="tail-row"><td colspan="7">${hasNext ? '（次頁へ）' : '（終着）'}</td></tr>
      </tbody>
    </table>
    <div class="notes-title">注意事項</div><div class="notes">${esc(train.notes)}</div>
  </section>`;
}

function halfHtml(train, stops, pageNo, offset, hasNext) {
  const date = specifiedDate || train.startDate || train.dayType || '';
  const office = train.office || '';
  const workName = train.workName || train.line || '';
  const now = new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  return `<section class="half${stops.length ? '' : ' empty-half'}">
    <i class="crop tl">＋</i><i class="crop tr">＋</i><i class="crop bl">＋</i><i class="crop br">＋</i>
    ${stops.length ? `<header class="page-head"><div class="page-no">NO. ${pageNo}</div><div class="office">${esc(workName)} 行路<br>${esc(office)}</div></header>
      <div class="effective">施行日　${esc(displayDate(date))}</div>
      ${cardHtml(train,stops,offset,pageNo > 1,hasNext)}
      <div class="created">${esc(now)} 作成</div>` : '<span>（余白）</span>'}
  </section>`;
}

function renderA3(train) {
  const chunks = makeChunks(train.stops);
  const sheets = [];
  for (let index = 0; index < chunks.length; index += 2) {
    const left = chunks[index];
    const right = chunks[index + 1];
    sheets.push(`<div class="sheet-wrap"><article class="a3-sheet">${halfHtml(train,left.stops,index + 1,left.offset,Boolean(right || chunks[index + 2]))}${halfHtml(train,right?.stops || [],index + 2,right?.offset || 0,Boolean(chunks[index + 2]))}</article></div>`);
  }
  document.getElementById('render-target').innerHTML = sheets.join('');
}
