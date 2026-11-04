/* Web adaptations of TRViS D-TAC (MIT): see TRVIS-NOTICE.md. */
const MARKER_TINTS = {red:'#f0402040',green:'#40f02040',blue:'#2040f040',yellow:'#f0f04040',brown:'#80402040'};
let locationWatch = null;
let hakoDiagram = false;

function setupDtacFeatures() {
  const theme = document.getElementById('theme-button');
  const setTheme = dark => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    theme.textContent = dark ? '☀' : '☾';
    theme.setAttribute('aria-label',dark ? 'ライトモードに切り替える' : 'ダークモードに切り替える');
  };
  try { setTheme(localStorage.getItem('dtac-theme') === 'dark'); } catch { setTheme(false); }
  theme.addEventListener('click',() => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    setTheme(dark);
    try { localStorage.setItem('dtac-theme',dark ? 'dark' : 'light'); } catch { /* optional preference */ }
  });
  document.getElementById('marker-mode').addEventListener('click',() => {
    markingMode = !markingMode;
    document.getElementById('marker-mode').setAttribute('aria-pressed',String(markingMode));
    train?.stops.forEach((_,index) => refreshMarker(index));
    if (markingMode) openMarkerMenu(null);
  });
  document.getElementById('horizontal-button').addEventListener('click',openHorizontalTimetable);
  document.getElementById('hako-layout').addEventListener('click',() => {
    hakoDiagram = !hakoDiagram;
    document.getElementById('hako-layout').textContent = hakoDiagram ? 'ハコ表示' : 'ダイヤ表示';
    renderHako();
  });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape') { closeMarkerMenu(); closeDocument(); closeMenu(); }
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || !document.getElementById('marker-menu').hidden || !document.getElementById('document-viewer').hidden) return;
    if (currentView === 'timetable' && isRunning && !locationEnabled && ['ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault(); stepPosition(event.key === 'ArrowUp' ? -1 : 1);
    }
  });
  addEventListener('pagehide',() => {
    if (locationWatch !== null) navigator.geolocation?.clearWatch(locationWatch);
  });
}

function limitMarkerText(value) {
  let width = 0, result = '';
  const segments = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(String(value))].map(x => x.segment) : Array.from(String(value));
  for (const char of segments) {
    const size = char.codePointAt(0) > 0xff && !(char.codePointAt(0) >= 0xff61 && char.codePointAt(0) <= 0xff9f) ? 2 : 1;
    if (width + size > 4) break;
    width += size; result += char;
  }
  return result;
}

async function loadWorkTrains() {
  // A timetable selection can contain multiple route segments of one train.
  // Only collect other trains if the source actually supplies a shared work ID.
  if (!train.workId) return;
  try {
    const records = (await fetchTimetables()).filter(item => item.workId === train.workId && item.startDate === train.startDate && manualDateMatches(item,params.get('date') || item.startDate));
    const groups = new Map();
    records.forEach(item => {
      const key = item.trainNumber;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(item);
    });
    const merged = [...groups.values()].map(group => mergeTrainSegments(dedupeSegments(group)));
    if (merged.length) { workTrains = merged; train = merged.find(item => item.trainNumber === train.trainNumber) || train; }
  } catch { /* Current selected train remains usable when the work lookup fails. */ }
}

function selectWorkTrain(index) {
  const next = workTrains[index];
  if (!next) return;
  setLocation(false);
  train = next; isRunning = false; activePosition = null;
  loadMarkers(); renderSummary(train); renderTimetable(train); renderOperationState(); showView('timetable');
  document.getElementById('timetable-scroll').scrollTop = 0;
}
function nextWorkTrain() {
  const index = workTrains.indexOf(train);
  if (index >= 0 && index + 1 < workTrains.length) selectWorkTrain(index + 1);
}
function afterTrainMarkup(data) {
  const index = workTrains.indexOf(data);
  return `<div class="after-train">${data.afterRemarks ? `<div class="after-remarks">${esc(data.afterRemarks)}</div>` : ''}${data.afterArrive ? `<div class="after-arrive"><span>着後</span>${esc(data.afterArrive)}</div>` : ''}${index >= 0 && index + 1 < workTrains.length ? `<button class="next-train" type="button" data-next-train>次列車 ${esc(workTrains[index+1].trainNumber)} へ</button>` : ''}</div>`;
}

function renderHako() {
  const body = document.getElementById('hako-body');
  if (!body) return;
  document.getElementById('hako-date').textContent = document.getElementById('execution-date').textContent;
  document.getElementById('hako-work').textContent = train?.workName || train?.line || '';
  document.getElementById('hako-group').textContent = train?.workGroupName || '';
  if (!train) { body.textContent = '列車が選択されていません。'; return; }
  const stations = [...new Set(workTrains.flatMap(t => [t.origin || t.stops?.[0]?.station,t.destination || t.stops?.at(-1)?.station]).filter(Boolean))];
  if (stations.length < 2) { body.textContent = 'ハコ表示に必要な始発・終着駅がありません。'; return; }
  const svgNode = (tag,attrs={},text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.entries(attrs).forEach(([key,value]) => node.setAttribute(key,String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const x = name => 125 + stations.indexOf(name) * 490 / Math.max(1,stations.length-1);
  const height = Math.max(1050,workTrains.length*130+240);
  const svg = svgNode('svg',{class:'hako-svg',viewBox:`0 0 744 ${height}`,'aria-label':'行路ハコ'});
  svg.append(svgNode('rect',{width:744,height:100,class:'hako-header-bg'}));
  stations.forEach(name => {
    svg.append(svgNode('line',{x1:x(name),x2:x(name),y1:100,y2:height,class:'hako-guide'}));
    svg.append(svgNode('text',{x:x(name),y:65,'text-anchor':'middle',class:'hako-station'},name));
  });
  const allTimes = workTrains.flatMap(t => [seconds(t.stops?.[0]?.departure),seconds(t.stops?.at(-1)?.arrival)]).filter(t => t !== null);
  const start = allTimes.length ? Math.min(...allTimes) : 0, end = allTimes.length ? Math.max(...allTimes) : 1;
  const yTime = value => 160 + ((value ?? start)-start) / Math.max(1,end-start) * 700;
  workTrains.forEach((t,index) => {
    const first=t.stops?.[0] || {}, last=t.stops?.at(-1) || {};
    const left=x(t.origin || first.station), right=x(t.destination || last.station);
    const y=hakoDiagram ? yTime(seconds(first.departure)) : 200+index*130;
    const yEnd=hakoDiagram ? yTime(seconds(last.arrival) ?? seconds(last.departure)) : y;
    const group=svgNode('g',{class:`hako-train${t === train ? ' selected' : ''}`,'data-work-train':index,role:'button',tabindex:0,'aria-label':`${t.trainNumber}の時刻表を表示`});
    group.append(svgNode('rect',{x:(left+right)/2-85,y:y-50,width:170,height:30,rx:5}));
    group.append(svgNode('text',{x:(left+right)/2,y:y-29,'text-anchor':'middle'},t.trainNumber));
    group.append(svgNode('path',{d:`M ${left},${y-7} V ${y} L ${right},${yEnd} V ${yEnd+7}`}));
    group.append(svgNode('text',{x:left-12,y:y+24,'text-anchor':'end',class:'hako-time'},first.departure || ''));
    group.append(svgNode('text',{x:right+12,y:yEnd+24,class:'hako-time'},last.arrival || last.departure || ''));
    group.append(svgNode('rect',{class:'hako-hit',x:hakoDiagram ? (left+right)/2-85 : 0,y:y-50,width:hakoDiagram ? 170 : 744,height:hakoDiagram ? 30 : 100}));
    group.addEventListener('click',() => selectWorkTrain(index));
    group.addEventListener('keydown',event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectWorkTrain(index); } });
    svg.append(group);
  });
  body.replaceChildren(svg);
}

function coordinates(stop) {
  const lat = stop.latitude ?? stop.lat, lon = stop.longitude ?? stop.lon ?? stop.lng;
  if (lat == null || lon == null || lat === '' || lon === '') return null;
  const latitude = Number(lat), longitude = Number(lon);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? {latitude,longitude} : null;
}
function hasCoordinates() { return Boolean(navigator.geolocation && train?.stops.some(stop => coordinates(stop))); }
function updateLocationWatch() {
  if (locationWatch !== null) { navigator.geolocation?.clearWatch(locationWatch); locationWatch = null; }
  if (!locationEnabled) return;
  locationWatch = navigator.geolocation.watchPosition(position => {
    if (!locationEnabled || !isRunning || position.coords.accuracy > 300) return;
    const rad = Math.PI/180;
    let nearest = null;
    train.stops.forEach((stop,index) => {
      const point = coordinates(stop);
      if (!point || stop.isInfoRow) return;
      const dy=(point.latitude-position.coords.latitude)*rad;
      const dx=(point.longitude-position.coords.longitude)*rad;
      const a=Math.sin(dy/2)**2+Math.cos(point.latitude*rad)*Math.cos(position.coords.latitude*rad)*Math.sin(dx/2)**2;
      const distance=6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
      if (!nearest || distance < nearest.distance) nearest={index,distance};
    });
    if (nearest && nearest.distance < 200 && (activePosition?.kind !== 'station' || activePosition.index !== nearest.index)) setPosition('station',nearest.index,true);
    else if (nearest && activePosition?.kind === 'station' && nearest.distance > 300 && activePosition.index < train.stops.length-1) setPosition('between',activePosition.index+1,true);
  },error => {
    setLocation(false);
    const notice = document.getElementById('location-notice') || document.createElement('div');
    notice.id='location-notice'; notice.className='location-notice'; notice.setAttribute('role','status');
    notice.textContent = error.code === 1 ? '位置情報が許可されていません。手動操作に切り替えました。' : '位置情報を取得できません。手動操作に切り替えました。';
    document.getElementById('timetable-body').prepend(notice);
  },{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}

async function openHorizontalTimetable() {
  const file = train?.horizontalTimetable;
  if (!file) return;
  if (typeof file === 'object' && file.filename) { await openDocument(file); return; }
  let url;
  try { url = new URL(typeof file === 'string' ? file : file.url,location.href); } catch { return; }
  if (!['https:','http:'].includes(url.protocol)) return;
  document.getElementById('document-title').textContent = '電車時刻表';
  document.getElementById('document-open').href = url.href;
  document.getElementById('document-open').removeAttribute('download');
  const frame = document.createElement('iframe');
  frame.src = url.href;
  frame.title = '電車時刻表';
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox','allow-same-origin allow-scripts');
  document.getElementById('document-body').replaceChildren(frame);
  document.getElementById('document-viewer').hidden = false;
}
