(() => {
  'use strict';

  const els = {
    badge: document.getElementById('service-badge'), loading: document.getElementById('loading'), error: document.getElementById('error'),
    detail: document.getElementById('stop-detail'), name: document.getElementById('stop-name'), next: document.getElementById('next-service'),
    departures: document.getElementById('departures'), search: document.getElementById('stop-search'), results: document.getElementById('search-results'),
    clear: document.getElementById('clear-search'), favorite: document.getElementById('favorite-button'), fare: document.getElementById('fare-note'),
    version: document.getElementById('data-version'), operator: document.getElementById('operator-link'), locate: document.getElementById('locate-button'), fit: document.getElementById('fit-button')
  };
  let data;
  let map;
  let routeLayer;
  let markers = new Map();
  let selectedStop;
  let direction = 'all';
  let userMarker;

  const jpDateKey = (date = new Date()) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).filter(p => p.type !== 'literal').map(p => p.value).join('');
  const jpWeekday = (date = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' }).format(date).toLowerCase();
  const minutesNow = () => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return Number(values.hour) * 60 + Number(values.minute);
  };
  const toMinutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function serviceRunsToday() {
    const exception = data.meta.exceptions[jpDateKey()];
    if (exception === 1) return true;
    if (exception === 2) return false;
    return Boolean(data.meta.serviceDays[jpWeekday()]);
  }

  function initializeMap() {
    if (!window.L) throw new Error('地図ライブラリを読み込めませんでした');
    map = L.map('map', { zoomControl: true, minZoom: 12, maxZoom: 19, tap: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);
    routeLayer = L.featureGroup().addTo(map);
    const colors = { SHP0001: '#0b6b47', SHP0002: '#e97824' };
    Object.entries(data.shapes).forEach(([id, points]) => {
      L.polyline(points, { color: colors[id] || '#0b6b47', weight: 6, opacity: .82, lineCap: 'square' }).addTo(routeLayer);
    });
    data.stops.forEach(stop => {
      const icon = L.divIcon({ className: '', html: '<div class="stop-marker"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
      const marker = L.marker([stop.lat, stop.lon], { icon, title: stop.name, keyboard: true }).addTo(routeLayer);
      marker.bindTooltip(stop.name, { direction: 'top', className: 'stop-tooltip', offset: [0, -9] });
      marker.on('click', () => selectStop(stop, true));
      markers.set(stop.name, marker);
    });
    fitRoute();
  }

  function fitRoute() {
    if (map && routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [28, 28] });
  }

  function markerIcon(selected) {
    return L.divIcon({ className: '', html: `<div class="stop-marker${selected ? ' selected' : ''}"></div>`, iconSize: selected ? [26, 26] : [20, 20], iconAnchor: selected ? [13, 13] : [10, 10] });
  }

  function selectStop(stop, moveMap = false) {
    if (!stop) return;
    if (selectedStop && markers.has(selectedStop.name)) markers.get(selectedStop.name).setIcon(markerIcon(false));
    selectedStop = stop;
    const marker = markers.get(stop.name);
    marker.setIcon(markerIcon(true));
    marker.openTooltip();
    if (moveMap) map.flyTo([stop.lat, stop.lon], Math.max(map.getZoom(), 16), { duration: .45 });
    els.name.textContent = stop.name;
    els.favorite.setAttribute('aria-pressed', localStorage.getItem('kitaku-bus-favorite') === stop.name ? 'true' : 'false');
    els.favorite.textContent = els.favorite.getAttribute('aria-pressed') === 'true' ? '★' : '☆';
    els.detail.hidden = false;
    els.loading.hidden = true;
    els.search.value = '';
    els.results.hidden = true;
    renderDepartures();
  }

  function renderDepartures() {
    const running = serviceRunsToday();
    const now = minutesNow();
    const filtered = selectedStop.departures.filter(item => direction === 'all' || item.headsign === direction);
    const next = running ? filtered.find(item => toMinutes(item.time) >= now) : null;
    els.next.replaceChildren();
    if (!running) {
      els.next.appendChild(element('div', 'next-empty', '本日は運休日です'));
    } else if (!next) {
      els.next.appendChild(element('div', 'next-empty', '本日の運行は終了しました'));
    } else {
      const wait = Math.max(0, toMinutes(next.time) - now);
      const main = element('div', 'next-main');
      main.append(
        element('span', 'next-time', next.time),
        element('span', 'next-destination', `${next.headsign}行`),
        element('span', 'next-minutes', wait === 0 ? 'まもなく' : `${wait}分後`),
      );
      els.next.append(element('div', 'next-label', '次のバス'), main);
    }
    els.departures.replaceChildren();
    filtered.forEach(item => {
      const row = document.createElement('div');
      const itemMinutes = toMinutes(item.time);
      row.className = `departure${running && next === item ? ' next' : ''}${running && itemMinutes < now ? ' past' : ''}`;
      const time = document.createElement('time'); time.textContent = item.time;
      const destination = document.createElement('span'); destination.className = 'destination'; destination.textContent = `${item.headsign}行`;
      const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = running && next === item ? '次発' : '';
      row.append(time, destination, tag);
      els.departures.appendChild(row);
    });
    if (!filtered.length) els.departures.appendChild(element('div', 'state-card', 'この行先の便はありません。'));
  }

  function renderSearch() {
    const query = els.search.value.trim().toLocaleLowerCase('ja');
    if (!query) { els.results.hidden = true; return; }
    const matches = data.stops.filter(stop => stop.name.toLocaleLowerCase('ja').includes(query));
    els.results.replaceChildren();
    matches.forEach(stop => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'search-result'; button.textContent = stop.name;
      button.addEventListener('click', () => selectStop(stop, true));
      els.results.appendChild(button);
    });
    if (!matches.length) els.results.appendChild(element('div', 'state-card', '該当する停留所がありません。'));
    els.results.hidden = false;
  }

  function locate() {
    if (!navigator.geolocation) { window.alert('この端末では現在地を取得できません。'); return; }
    els.locate.disabled = true; els.locate.textContent = '現在地を確認中…';
    navigator.geolocation.getCurrentPosition(position => {
      const lat = position.coords.latitude, lon = position.coords.longitude;
      const distance = stop => Math.hypot((stop.lat - lat) * 111, (stop.lon - lon) * 91);
      const nearest = [...data.stops].sort((a, b) => distance(a) - distance(b))[0];
      if (userMarker) userMarker.remove();
      const icon = L.divIcon({ className: '', html: '<div class="user-location"></div>', iconSize: [24, 24], iconAnchor: [12, 12] });
      userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(map).bindTooltip('現在地');
      selectStop(nearest, false);
      map.fitBounds([[lat, lon], [nearest.lat, nearest.lon]], { padding: [60, 60], maxZoom: 16 });
      els.locate.disabled = false; els.locate.textContent = '◎ 現在地から探す';
    }, () => {
      els.locate.disabled = false; els.locate.textContent = '◎ 現在地から探す';
      window.alert('現在地を取得できませんでした。端末の位置情報設定をご確認ください。');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  async function start() {
    try {
      const response = await fetch('data.json?v=2026.06.01');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
      initializeMap();
      const running = serviceRunsToday();
      els.badge.textContent = running ? '本日 運行日' : '本日 運休日';
      els.badge.classList.add(running ? 'running' : 'off');
      els.fare.textContent = `運賃目安 ${Math.min(...data.meta.fares)}〜${Math.max(...data.meta.fares)}円`;
      els.version.textContent = `提供：${data.meta.publisher}／${data.meta.license}／${data.meta.version}`;
      els.operator.href = data.meta.operatorUrl;
      const favorite = localStorage.getItem('kitaku-bus-favorite');
      selectStop(data.stops.find(stop => stop.name === favorite) || data.stops.find(stop => stop.name === '北区役所') || data.stops[0]);
    } catch (error) {
      console.error(error);
      els.loading.hidden = true; els.error.hidden = false;
    }
  }

  els.search.addEventListener('input', renderSearch);
  els.clear.addEventListener('click', () => { els.search.value = ''; els.results.hidden = true; els.search.focus(); });
  els.fit.addEventListener('click', fitRoute);
  els.locate.addEventListener('click', locate);
  els.favorite.addEventListener('click', () => {
    const active = els.favorite.getAttribute('aria-pressed') === 'true';
    if (active) localStorage.removeItem('kitaku-bus-favorite'); else localStorage.setItem('kitaku-bus-favorite', selectedStop.name);
    els.favorite.setAttribute('aria-pressed', active ? 'false' : 'true'); els.favorite.textContent = active ? '☆' : '★';
  });
  document.querySelectorAll('.direction-tabs button').forEach(button => button.addEventListener('click', () => {
    direction = button.dataset.direction;
    document.querySelectorAll('.direction-tabs button').forEach(item => item.classList.toggle('active', item === button));
    renderDepartures();
  }));
  start();
})();
