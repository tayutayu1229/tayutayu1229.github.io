(() => {
  "use strict";

  const CONFIG = {
    standardToken: "4tf33x46mhk1umi1jhfiy040thiafy3onu9y71ltyrplwnkjka5u5pni8k2d3z6v",
    challengeToken: "26d1y7j8fkzdabx6iuxby79nqu8tdz8h6mmu05apwseyvg8h9uvymkl5y9ikpo9o",
    standardBase: "https://api.odpt.org/api/v4",
    challengeBase: "https://api-challenge.odpt.org/api/v4",
    cacheKey: "skyDeskCacheV2",
    favoritesKey: "skyDeskFavoritesV2",
    snapshotsKey: "skyDeskSnapshotsV2"
  };

  const SOURCES = [
    { id: "jal-departure", name: "JAL リアルタイム出発", airline: "JAL", type: "departure", endpoint: "odpt:FlightInformationDeparture" },
    { id: "jal-arrival", name: "JAL リアルタイム到着", airline: "JAL", type: "arrival", endpoint: "odpt:FlightInformationArrival" },
    { id: "jal-schedule", name: "JAL フライト時刻表", airline: "JAL", type: "schedule", endpoint: "odpt:FlightSchedule" },
    { id: "ana-departure", name: "ANA リアルタイム出発", airline: "ANA", type: "departure", endpoint: "odpt:FlightInformationDeparture" },
    { id: "ana-arrival", name: "ANA リアルタイム到着", airline: "ANA", type: "arrival", endpoint: "odpt:FlightInformationArrival" },
    { id: "ana-schedule", name: "ANA フライト時刻表", airline: "ANA", type: "schedule", endpoint: "odpt:FlightSchedule" },
    { id: "tiat-departure", name: "羽田国際線 リアルタイム出発", airline: "HND-TIAT", type: "departure", endpoint: "odpt:FlightInformationDeparture", challenge: true },
    { id: "tiat-arrival", name: "羽田国際線 リアルタイム到着", airline: "HND-TIAT", type: "arrival", endpoint: "odpt:FlightInformationArrival", challenge: true },
    { id: "tiat-schedule", name: "羽田国際線 フライト時刻表", airline: "HND-TIAT", type: "schedule", endpoint: "odpt:FlightSchedule", challenge: true }
  ];

  const AIRPORTS = {
    HND: "東京（羽田）", NRT: "東京（成田）", ITM: "大阪（伊丹）", KIX: "大阪（関西）", CTS: "札幌（新千歳）", OKA: "沖縄（那覇）", NGO: "名古屋（中部）", FUK: "福岡", KOJ: "鹿児島", HIJ: "広島", SDJ: "仙台", AOJ: "青森", AXT: "秋田", FKS: "福島", MMB: "女満別", AKJ: "旭川", HKD: "函館", MSJ: "三沢", GAJ: "山形", KMJ: "熊本", OIT: "大分", MYJ: "松山", TAK: "高松", TKS: "徳島", IZO: "出雲", YGJ: "米子", TTJ: "鳥取", KCZ: "高知", KMI: "宮崎", ISG: "石垣", MMY: "宮古", ASJ: "奄美", TNE: "種子島", OKD: "札幌（丘珠）", WKJ: "稚内", KUH: "釧路", OBO: "帯広", MBE: "紋別", SHB: "中標津", IKI: "壱岐", TSJ: "対馬", NTQ: "能登", KKJ: "北九州", UBJ: "山口宇部", IWJ: "岩国", TOY: "富山", KMQ: "小松", FSZ: "静岡", HNA: "花巻", SHM: "南紀白浜", OKI: "隠岐", HAC: "八丈島", OGS: "小笠原",
    ICN: "ソウル（仁川）", GMP: "ソウル（金浦）", PEK: "北京（首都）", PKX: "北京（大興）", PVG: "上海（浦東）", SHA: "上海（虹橋）", CAN: "広州", SZX: "深圳", HKG: "香港", TPE: "台北（桃園）", TSA: "台北（松山）", SIN: "シンガポール", KUL: "クアラルンプール", BKK: "バンコク", SGN: "ホーチミン", HAN: "ハノイ", DAD: "ダナン", DEL: "デリー", BOM: "ムンバイ", BLR: "ベンガルール", CGK: "ジャカルタ", DPS: "デンパサール", MNL: "マニラ", CEB: "セブ", GUM: "グアム", SPN: "サイパン", ROR: "パラオ",
    SFO: "サンフランシスコ", JFK: "ニューヨーク", LAX: "ロサンゼルス", ORD: "シカゴ", BOS: "ボストン", SEA: "シアトル", IAD: "ワシントンD.C.", DFW: "ダラス", YVR: "バンクーバー", YYZ: "トロント", HNL: "ホノルル", KOA: "コナ",
    LHR: "ロンドン", CDG: "パリ", FRA: "フランクフルト", MUC: "ミュンヘン", HEL: "ヘルシンキ", AMS: "アムステルダム", FCO: "ローマ", MAD: "マドリード", VIE: "ウィーン", BRU: "ブリュッセル", CPH: "コペンハーゲン", ARN: "ストックホルム", IST: "イスタンブール",
    DXB: "ドバイ", AUH: "アブダビ", DOH: "ドーハ", SYD: "シドニー", MEL: "メルボルン", BNE: "ブリスベン", PER: "パース", AKL: "オークランド"
  };
  const DOMESTIC = new Set(["HND","NRT","ITM","KIX","CTS","OKA","NGO","FUK","KOJ","HIJ","SDJ","AOJ","AXT","FKS","MMB","AKJ","HKD","MSJ","GAJ","KMJ","OIT","MYJ","TAK","TKS","IZO","YGJ","TTJ","KCZ","KMI","ISG","MMY","ASJ","TNE","OKD","WKJ","KUH","OBO","MBE","SHB","IKI","TSJ","NTQ","KKJ","UBJ","IWJ","TOY","KMQ","FSZ","HNA","SHM","OKI","HAC","OGS"]);
  const CALENDARS = {
    Monday: "月曜", Tuesday: "火曜", Wednesday: "水曜", Thursday: "木曜", Friday: "金曜", Saturday: "土曜", Sunday: "日曜", Weekday: "平日", Holiday: "祝日", SaturdayHoliday: "土・祝", Everyday: "毎日"
  };

  const state = {
    departures: [], arrivals: [], schedules: [], sourceStatus: {}, updatedAt: null,
    direction: "departure", overviewDirection: "departure", layout: "table", currentView: "overview", airport: "HND",
    favorites: new Set(readJSON(CONFIG.favoritesKey, [])), refreshTimer: null, loading: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const code = value => String(value || "").replace(/^odpt\.Airport:/, "").replace(/^odpt\.AirportTerminal:/, "").split(".").pop();
  const operatorCode = value => String(value || "").replace(/^odpt\.Operator:/, "");
  const airlineColor = airline => ({ JAL: "#d64152", ANA: "#1768e5", "HND-TIAT": "#6747c7" }[airline] || "#8490a4");
  const airportName = value => AIRPORTS[code(value)] || code(value) || "不明";
  const terminal = value => {
    const raw = code(value);
    const match = raw.match(/Terminal(\w+)/i);
    return match ? `T${match[1]}` : (raw || "—");
  };
  const flightNumber = item => (item["odpt:flightNumber"] || []).join(" / ") || "便名不明";
  const getText = value => typeof value === "string" ? value : (value?.ja || value?.en || "");
  const route = (item, direction = item._direction) => direction === "departure"
    ? { from: code(item["odpt:departureAirport"]), to: code(item["odpt:destinationAirport"]) }
    : { from: code(item["odpt:originAirport"]), to: code(item["odpt:arrivalAirport"]) };
  const scheduledTime = (item, direction = item._direction) => item[direction === "departure" ? "odpt:scheduledDepartureTime" : "odpt:scheduledArrivalTime"] || "—";
  const estimatedTime = (item, direction = item._direction) => item[direction === "departure" ? "odpt:estimatedDepartureTime" : "odpt:estimatedArrivalTime"] || "";
  const actualTime = (item, direction = item._direction) => item[direction === "departure" ? "odpt:actualDepartureTime" : "odpt:actualArrivalTime"] || "";
  const operationalTime = item => actualTime(item) || estimatedTime(item) || scheduledTime(item);
  const minutes = value => {
    if (!/^\d{1,2}:\d{2}$/.test(value || "")) return null;
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  };
  const delayMinutes = item => {
    const scheduled = minutes(scheduledTime(item));
    const operational = minutes(actualTime(item) || estimatedTime(item));
    if (scheduled == null || operational == null) return 0;
    let difference = operational - scheduled;
    if (difference < -720) difference += 1440;
    if (difference > 720) difference -= 1440;
    return difference;
  };
  const rawStatus = item => String(item["odpt:flightStatus"] || "").split(":").pop();
  const isCancelled = item => /Cancel/i.test(rawStatus(item));
  const isDelayed = item => /Delay/i.test(rawStatus(item)) || delayMinutes(item) >= 10;
  const isBoarding = item => /Boarding|GateClosed|CheckIn/i.test(rawStatus(item));
  const isInAir = item => /InAir/i.test(rawStatus(item));
  const isFinished = item => /Departed|Arrived/i.test(rawStatus(item));
  const statusInfo = item => {
    const raw = rawStatus(item);
    if (isCancelled(item)) return { label: "欠航", cls: "cancel" };
    if (isDelayed(item)) return { label: `遅延${delayMinutes(item) > 0 ? ` +${delayMinutes(item)}分` : ""}`, cls: "delay" };
    if (/Boarding/i.test(raw)) return { label: "搭乗中", cls: "boarding" };
    if (/GateClosed/i.test(raw)) return { label: "搭乗締切", cls: "boarding" };
    if (/CheckIn/i.test(raw)) return { label: "手続き中", cls: "boarding" };
    if (/InAir/i.test(raw)) return { label: "飛行中", cls: "inair" };
    if (/Departed/i.test(raw)) return { label: "出発済", cls: "departed" };
    if (/Arrived/i.test(raw)) return { label: "到着済", cls: "arrived" };
    if (/Early/i.test(raw)) return { label: "早着・早発", cls: "ok" };
    if (/Estimated/i.test(raw)) return { label: "時刻変更", cls: "delay" };
    return { label: raw ? raw.replace(/([A-Z])/g, " $1").trim() : "定刻", cls: "ok" };
  };
  const isInternational = item => {
    const r = route(item);
    return !DOMESTIC.has(r.from) || !DOMESTIC.has(r.to);
  };
  const itemId = item => [item._direction, flightNumber(item), route(item).from, route(item).to, scheduledTime(item)].join("|");
  const nowMinutes = () => new Date().getHours() * 60 + new Date().getMinutes();
  const relativeTime = value => {
    const t = minutes(value);
    if (t == null) return 9999;
    let diff = t - nowMinutes();
    if (diff < -360) diff += 1440;
    return diff;
  };

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function airlineMarkup(airline) {
    const label = airline === "HND-TIAT" ? "TIAT" : airline;
    return `<span class="airline-chip" style="--airline:${airlineColor(airline)}"><i></i>${esc(label)}</span>`;
  }
  function empty(message) { return `<div class="empty">${esc(message)}</div>`; }
  function metric(label, value, note, color = "var(--blue)") {
    return `<div class="metric" style="--metric-color:${color}"><span class="metric-label">${esc(label)}</span><div class="metric-value">${esc(value)}</div><div class="metric-note">${note}</div></div>`;
  }

  function normalizeRecord(record, source) {
    const operator = operatorCode(record["odpt:operator"] || record["odpt:airline"]);
    let airline = source.airline;
    if (source.airline === "HND-TIAT" && operator && operator !== "HND-TIAT") airline = operator;
    return { ...record, _source: source.id, _provider: source.airline, _airline: airline, _direction: source.type };
  }
  function recordScore(item) {
    return Object.values(item).filter(value => value != null && value !== "" && (!Array.isArray(value) || value.length)).length;
  }
  function deduplicate(items) {
    const map = new Map();
    items.forEach(item => {
      const key = itemId(item);
      const existing = map.get(key);
      if (!existing || recordScore(item) > recordScore(existing)) map.set(key, existing ? { ...existing, ...item } : item);
    });
    return [...map.values()];
  }
  function sourceUrl(source) {
    const base = source.challenge ? CONFIG.challengeBase : CONFIG.standardBase;
    const token = source.challenge ? CONFIG.challengeToken : CONFIG.standardToken;
    return `${base}/${source.endpoint}?odpt:operator=odpt.Operator:${source.airline}&acl:consumerKey=${token}`;
  }
  async function fetchSource(source) {
    const started = performance.now();
    try {
      const response = await fetch(sourceUrl(source));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.sourceStatus[source.id] = { ok: true, count: Array.isArray(data) ? data.length : 0, latency: Math.round(performance.now() - started), checkedAt: new Date() };
      return Array.isArray(data) ? data.map(record => normalizeRecord(record, source)) : [];
    } catch (error) {
      state.sourceStatus[source.id] = { ok: false, count: 0, latency: Math.round(performance.now() - started), checkedAt: new Date(), error: error.message };
      return [];
    }
  }

  async function fetchAllData() {
    if (state.loading) return;
    state.loading = true;
    $("#refreshButton")?.classList.add("loading");
    $("#sideStatusDot")?.classList.add("loading");
    $("#sideStatus") && ($("#sideStatus").textContent = "データを更新中");
    const batches = await Promise.all(SOURCES.map(fetchSource));
    const liveDepartures = deduplicate(batches.flatMap((batch, index) => SOURCES[index].type === "departure" ? batch : []));
    const liveArrivals = deduplicate(batches.flatMap((batch, index) => SOURCES[index].type === "arrival" ? batch : []));
    const liveSchedules = batches.flatMap((batch, index) => SOURCES[index].type === "schedule" ? batch : []);
    const succeeded = Object.values(state.sourceStatus).filter(status => status.ok).length;

    if (liveDepartures.length || liveArrivals.length || liveSchedules.length) {
      state.departures = liveDepartures;
      state.arrivals = liveArrivals;
      state.schedules = liveSchedules;
      state.updatedAt = new Date();
      writeJSON(CONFIG.cacheKey, { departures: state.departures, arrivals: state.arrivals, schedules: state.schedules, updatedAt: state.updatedAt.toISOString() });
      toast(`${succeeded}/${SOURCES.length}データソースを更新しました`);
    } else {
      const cached = readJSON(CONFIG.cacheKey, null);
      if (cached) {
        state.departures = cached.departures || [];
        state.arrivals = cached.arrivals || [];
        state.schedules = cached.schedules || [];
        state.updatedAt = new Date(cached.updatedAt);
        toast("APIに接続できないため、前回のデータを表示しています");
      } else {
        toast("データを取得できませんでした。接続設定を確認してください");
      }
    }
    state.loading = false;
    $("#refreshButton")?.classList.remove("loading");
    updateConnectionStatus();
    populateFilters();
    renderAll();
  }

  function updateConnectionStatus() {
    const ok = Object.values(state.sourceStatus).filter(status => status.ok).length;
    const dot = $("#sideStatusDot");
    dot?.classList.remove("loading", "error");
    if (ok < 1) dot?.classList.add("error");
    $("#sideStatus").textContent = ok === SOURCES.length ? "すべて正常" : ok ? `${ok}/${SOURCES.length} 接続中` : "オフライン表示";
    $("#sideUpdated").textContent = state.updatedAt ? `更新 ${state.updatedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}` : "ODPT API";
  }

  function allFlights() { return [...state.departures, ...state.arrivals]; }
  function alerts() { return allFlights().filter(item => isCancelled(item) || isDelayed(item)); }
  function dataForDirection(direction = state.direction) { return direction === "departure" ? state.departures : state.arrivals; }
  function sortByUpcoming(items) { return [...items].sort((a, b) => relativeTime(scheduledTime(a)) - relativeTime(scheduledTime(b))); }

  function renderAll() {
    const renderers = { overview: renderOverview, flights: renderFlights, alerts: renderAlerts, airports: renderAirports, schedule: renderSchedules, analytics: renderAnalytics, saved: renderSaved, system: renderSystem };
    (renderers[state.currentView] || renderOverview)();
    $("#navFlightCount").textContent = allFlights().length;
    $("#navAlertCount").textContent = alerts().length;
    $("#navSavedCount").textContent = state.favorites.size;
  }

  function renderOverview() {
    const flights = allFlights();
    const delayed = flights.filter(item => isDelayed(item) && !isCancelled(item));
    const cancelled = flights.filter(isCancelled);
    const boarding = state.departures.filter(isBoarding);
    const finished = flights.filter(isFinished).length;
    const ontime = flights.length ? Math.max(0, Math.round((flights.length - delayed.length - cancelled.length) / flights.length * 100)) : 0;
    $("#heroSummary").textContent = flights.length
      ? `${flights.length}便を監視中。${alerts().length ? `${alerts().length}便に注意が必要です。` : "現在、大きな乱れは見つかっていません。"}`
      : "リアルタイムの運航データを待っています。";
    $("#metricGrid").innerHTML = [
      metric("監視中の便", `${flights.length}`, `出発 ${state.departures.length}・到着 ${state.arrivals.length}`),
      metric("定時率", `${ontime}%`, "遅延10分未満を定時として算出", "var(--green)"),
      metric("遅延", `${delayed.length}`, delayed.length ? `<strong>平均 ${average(delayed.map(delayMinutes).filter(n => n > 0))}分</strong>` : "遅延便なし", "var(--amber)"),
      metric("欠航", `${cancelled.length}`, cancelled.length ? `<strong>確認が必要です</strong>` : "欠航便なし", "var(--red)"),
      metric("搭乗案内", `${boarding.length}`, `完了 ${finished}便`, "#6747c7")
    ].join("");
    renderUpcoming();

    const attention = [...flights.filter(isCancelled), ...flights.filter(item => isDelayed(item) && !isCancelled(item))].slice(0, 5);
    $("#attentionList").innerHTML = attention.length ? attention.map(item => {
      const info = statusInfo(item), r = route(item);
      return `<div class="attention-row" data-flight-id="${esc(itemId(item))}"><span class="attention-icon ${info.cls}">${info.cls === "cancel" ? "×" : "!"}</span><div><strong>${esc(flightNumber(item))} · ${esc(r.from)} → ${esc(r.to)}</strong><small>${esc(getText(item["odpt:flightInformationSummary"]) || getText(item["odpt:flightInformationText"]) || info.label)}</small></div><span class="status ${info.cls}">${esc(info.label)}</span></div>`;
    }).join("") : empty("現在、要確認の便はありません");

    const counts = new Map();
    flights.forEach(item => { const r = route(item); [r.from, r.to].forEach(ap => ap && counts.set(ap, (counts.get(ap) || 0) + 1)); });
    const ranking = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
    $("#airportRanking").innerHTML = ranking.length ? ranking.map(([ap, count], index) => `<div class="rank-row"><span class="rank-number">0${index + 1}</span><span class="rank-airport">${esc(ap)} <small>${esc(AIRPORTS[ap] || "")}</small></span><span class="rank-value">${count}便</span></div>`).join("") : empty("空港データを待っています");
  }

  function renderUpcoming() {
    const data = sortByUpcoming(dataForDirection(state.overviewDirection)).filter(item => relativeTime(scheduledTime(item)) > -90).slice(0, 6);
    $("#upcomingFlights").innerHTML = data.length ? data.map(miniFlightMarkup).join("") : empty("直近の便はありません");
  }
  function miniFlightMarkup(item) {
    const r = route(item), info = statusInfo(item), other = item._direction === "departure" ? r.to : r.from;
    return `<div class="mini-flight" data-flight-id="${esc(itemId(item))}"><div><span class="time-main">${esc(scheduledTime(item))}</span><small class="time-sub">${item._direction === "departure" ? "出発" : "到着"}</small></div><div><span class="flight-number">${esc(flightNumber(item))}</span>${airlineMarkup(item._airline)}</div><div><span class="route-main">${esc(other)}</span><small class="route-sub">${esc(AIRPORTS[other] || other)}</small></div><span class="status ${info.cls}">${esc(info.label)}</span><span class="mono">${esc(item["odpt:departureGate"] || terminal(item[item._direction === "departure" ? "odpt:departureAirportTerminal" : "odpt:arrivalAirportTerminal"]))}</span><button class="favorite ${state.favorites.has(itemId(item)) ? "active" : ""}" data-favorite-id="${esc(itemId(item))}" aria-label="保存">${state.favorites.has(itemId(item)) ? "♥" : "♡"}</button></div>`;
  }

  function filteredFlights() {
    const search = $("#flightSearch").value.trim().toLowerCase();
    const airline = $("#airlineFilter").value;
    const airport = $("#airportFilter").value;
    const status = $("#statusFilter").value;
    const type = $("#typeFilter").value;
    let result = dataForDirection().filter(item => {
      const r = route(item);
      const haystack = [flightNumber(item), r.from, r.to, AIRPORTS[r.from], AIRPORTS[r.to], item._airline].join(" ").toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (airline !== "all" && item._provider !== airline && item._airline !== airline) return false;
      if (airport !== "all" && r.from !== airport && r.to !== airport) return false;
      if (status === "attention" && !isDelayed(item) && !isCancelled(item)) return false;
      if (status === "boarding" && !isBoarding(item)) return false;
      if (status === "inair" && !isInAir(item)) return false;
      if (status === "finished" && !isFinished(item)) return false;
      if (type === "domestic" && isInternational(item)) return false;
      if (type === "international" && !isInternational(item)) return false;
      return true;
    });
    const sort = $("#sortFlights").value;
    result.sort((a, b) => {
      if (sort === "delay") return delayMinutes(b) - delayMinutes(a);
      if (sort === "flight") return flightNumber(a).localeCompare(flightNumber(b), "ja", { numeric: true });
      if (sort === "airport") return (route(a).to || route(a).from).localeCompare(route(b).to || route(b).from);
      return (minutes(scheduledTime(a)) ?? 9999) - (minutes(scheduledTime(b)) ?? 9999);
    });
    return result;
  }

  function renderFlights() {
    $("#depCount").textContent = state.departures.length;
    $("#arrCount").textContent = state.arrivals.length;
    const result = filteredFlights();
    $("#flightResultCount").textContent = `${result.length}便`;
    const displayLimit = state.layout === "cards" ? 300 : 500;
    $("#flightResultDescription").textContent = `${state.direction === "departure" ? "出発" : "到着"}便の検索結果${result.length > displayLimit ? `（先頭${displayLimit}便を表示）` : ""}`;
    const container = $("#flightResults");
    container.className = `flight-results ${state.layout}-layout`;
    if (!result.length) { container.innerHTML = empty("条件に一致する便はありません"); return; }
    const visible = result.slice(0, displayLimit);
    container.innerHTML = state.layout === "cards" ? visible.map(flightCardMarkup).join("") : flightTableMarkup(visible);
  }
  function flightTableMarkup(items) {
    const departure = state.direction === "departure";
    return `<table class="data-table"><thead><tr><th>定刻</th><th>便名</th><th>航空会社</th><th>${departure ? "出発地" : "出発地"}</th><th>${departure ? "目的地" : "到着地"}</th><th>実績 / 予定</th><th>ゲート</th><th>機材</th><th>状態</th><th></th></tr></thead><tbody>${items.map(item => {
      const r = route(item), info = statusInfo(item), delayed = delayMinutes(item);
      return `<tr data-flight-id="${esc(itemId(item))}"><td class="mono">${esc(scheduledTime(item))}</td><td><span class="flight-number">${esc(flightNumber(item))}</span><small class="subtext">${isInternational(item) ? "国際線" : "国内線"}</small></td><td>${airlineMarkup(item._airline)}</td><td><span class="airport-code">${esc(r.from)}</span><small class="subtext">${esc(AIRPORTS[r.from] || "")}</small></td><td><span class="airport-code">${esc(r.to)}</span><small class="subtext">${esc(AIRPORTS[r.to] || "")}</small></td><td class="mono ${delayed > 0 ? "delay-text" : ""}">${esc(operationalTime(item))}${delayed > 0 ? `<small class="subtext">+${delayed}分</small>` : ""}</td><td>${esc(item["odpt:departureGate"] || "—")}<small class="subtext">${esc(terminal(item[departure ? "odpt:departureAirportTerminal" : "odpt:arrivalAirportTerminal"]))}</small></td><td>${esc(item["odpt:aircraftType"] || "—")}</td><td><span class="status ${info.cls}">${esc(info.label)}</span></td><td><button class="favorite ${state.favorites.has(itemId(item)) ? "active" : ""}" data-favorite-id="${esc(itemId(item))}">${state.favorites.has(itemId(item)) ? "♥" : "♡"}</button></td></tr>`;
    }).join("")}</tbody></table>`;
  }
  function flightCardMarkup(item) {
    const r = route(item), info = statusInfo(item), active = state.favorites.has(itemId(item));
    return `<article class="flight-card" data-flight-id="${esc(itemId(item))}"><div class="flight-card-top"><div><span class="flight-number">${esc(flightNumber(item))}</span>${airlineMarkup(item._airline)}</div><button class="favorite ${active ? "active" : ""}" data-favorite-id="${esc(itemId(item))}">${active ? "♥" : "♡"}</button></div><div class="flight-card-route"><div><strong>${esc(r.from)}</strong><small>${esc(AIRPORTS[r.from] || "")}</small></div><span>→</span><div><strong>${esc(r.to)}</strong><small>${esc(AIRPORTS[r.to] || "")}</small></div></div><div class="flight-card-foot"><span>定刻 <strong class="mono">${esc(scheduledTime(item))}</strong></span><span>${esc(item["odpt:departureGate"] ? `GATE ${item["odpt:departureGate"]}` : terminal(item[item._direction === "departure" ? "odpt:departureAirportTerminal" : "odpt:arrivalAirportTerminal"]))}</span><span class="status ${info.cls}">${esc(info.label)}</span></div></article>`;
  }

  function renderAlerts() {
    const selected = $("#alertAirportFilter").value;
    const filterAirport = item => selected === "all" || Object.values(route(item)).includes(selected);
    const cancels = allFlights().filter(item => isCancelled(item) && filterAirport(item));
    const delays = allFlights().filter(item => isDelayed(item) && !isCancelled(item) && filterAirport(item)).sort((a, b) => delayMinutes(b) - delayMinutes(a));
    const boarding = state.departures.filter(item => (isBoarding(item) || isInAir(item)) && filterAirport(item));
    const totalDelay = delays.map(delayMinutes).filter(n => n > 0);
    $("#alertMetrics").innerHTML = [
      ["欠航", cancels.length, "var(--red)"], ["遅延", delays.length, "var(--amber)"], ["平均遅延", `${average(totalDelay)}分`, "var(--amber)"], ["搭乗・飛行中", boarding.length, "var(--blue)"]
    ].map(([label, value, color]) => `<div class="alert-tile" style="--tile-color:${color}"><span>${label}</span><strong>${value}</strong></div>`).join("");
    $("#cancelCount").textContent = cancels.length;
    $("#delayCount").textContent = delays.length;
    $("#boardingCount").textContent = boarding.length;
    $("#cancelList").innerHTML = cancels.length ? cancels.slice(0, 100).map(alertItemMarkup).join("") : empty("欠航便はありません");
    $("#delayList").innerHTML = delays.length ? delays.slice(0, 100).map(alertItemMarkup).join("") : empty("遅延便はありません");
    $("#boardingList").innerHTML = boarding.length ? boarding.slice(0, 100).map(alertItemMarkup).join("") : empty("搭乗・飛行中の便はありません");
  }
  function alertItemMarkup(item) {
    const r = route(item), info = statusInfo(item);
    const note = getText(item["odpt:flightInformationSummary"]) || getText(item["odpt:flightInformationText"]);
    return `<div class="alert-item" data-flight-id="${esc(itemId(item))}"><div class="alert-item-top"><span class="flight-number">${esc(flightNumber(item))}</span>${airlineMarkup(item._airline)}<span class="status ${info.cls}">${esc(info.label)}</span></div><div class="alert-route">${esc(r.from)} → ${esc(r.to)} · ${esc(scheduledTime(item))}</div><div class="alert-detail">${esc(note || `${AIRPORTS[r.from] || r.from}から${AIRPORTS[r.to] || r.to}への運航情報`)}</div></div>`;
  }

  function popularAirports() {
    const counts = new Map([["HND", 9999], ["NRT", 9998], ["ITM", 9997], ["KIX", 9996], ["CTS", 9995], ["FUK", 9994], ["OKA", 9993]]);
    allFlights().forEach(item => Object.values(route(item)).forEach(ap => ap && counts.set(ap, (counts.get(ap) || 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(entry => entry[0]);
  }
  function renderAirports() {
    const airports = popularAirports();
    if (!airports.includes(state.airport)) state.airport = airports[0] || "HND";
    $("#airportSelector").innerHTML = airports.map(ap => `<button class="${ap === state.airport ? "active" : ""}" data-airport="${esc(ap)}">${esc(ap)}<small>${esc((AIRPORTS[ap] || "").split("（")[0])}</small></button>`).join("");
    const departures = state.departures.filter(item => route(item).from === state.airport);
    const arrivals = state.arrivals.filter(item => route(item).to === state.airport);
    const flights = [...departures, ...arrivals];
    const delays = flights.filter(isDelayed), cancels = flights.filter(isCancelled);
    $("#airportHero").innerHTML = `<div class="airport-identity"><span class="airport-code-big">${esc(state.airport)}</span><div><span class="section-kicker">AIRPORT MONITOR</span><h2>${esc(AIRPORTS[state.airport] || state.airport)}</h2><p>${flights.length}便のリアルタイム運航情報を監視しています</p></div></div><div class="airport-clock"><strong>${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</strong><small>JAPAN STANDARD TIME</small></div>`;
    const ontime = flights.length ? Math.max(0, Math.round((flights.length - delays.length - cancels.length) / flights.length * 100)) : 0;
    $("#airportMetrics").innerHTML = [metric("出発便", departures.length, "リアルタイム"), metric("到着便", arrivals.length, "リアルタイム"), metric("定時率", `${ontime}%`, "現在の取得範囲", "var(--green)"), metric("要確認", delays.length + cancels.length, "遅延・欠航", "var(--amber)")].join("");
    $("#airportDepartures").innerHTML = departures.length ? sortByUpcoming(departures).slice(0, 8).map(miniFlightMarkup).join("") : empty("出発便データはありません");
    $("#airportArrivals").innerHTML = arrivals.length ? sortByUpcoming(arrivals).slice(0, 8).map(miniFlightMarkup).join("") : empty("到着便データはありません");
  }

  function flattenSchedules() {
    const result = [];
    state.schedules.forEach(schedule => {
      const airline = schedule._airline || schedule._provider;
      const origin = code(schedule["odpt:originAirport"]);
      const destination = code(schedule["odpt:destinationAirport"]);
      const calendarRaw = String(schedule["odpt:calendar"] || "").split(":").pop();
      const calendar = CALENDARS[calendarRaw] || calendarRaw || "—";
      (schedule["odpt:flightScheduleObject"] || []).forEach(object => result.push({
        airline, provider: schedule._provider, flight: (object["odpt:flightNumber"] || []).join(" / ") || "—", origin, destination,
        departure: object["odpt:originTime"] || "—", arrival: object["odpt:destinationTime"] || "—", aircraft: object["odpt:aircraftType"] || "—", calendar,
        from: String(object["odpt:isValidFrom"] || "").slice(0, 10), to: String(object["odpt:isValidTo"] || "").slice(0, 10), note: getText(object["odpt:note"])
      }));
    });
    return result;
  }
  function filteredSchedules() {
    const search = $("#scheduleSearch").value.toLowerCase().trim(), airline = $("#scheduleAirline").value, day = $("#scheduleDay").value;
    return flattenSchedules().filter(item => {
      if (airline !== "all" && item.provider !== airline && item.airline !== airline) return false;
      if (day !== "all" && item.calendar !== day) return false;
      const haystack = [item.flight, item.origin, item.destination, AIRPORTS[item.origin], AIRPORTS[item.destination]].join(" ").toLowerCase();
      return !search || haystack.includes(search);
    }).sort((a, b) => (minutes(a.departure) ?? 9999) - (minutes(b.departure) ?? 9999));
  }
  function renderSchedules() {
    const data = filteredSchedules();
    $("#scheduleCount").textContent = `${data.length}件`;
    if (!data.length) { $("#scheduleResults").innerHTML = empty("時刻表データはありません"); return; }
    $("#scheduleResults").innerHTML = `<table class="data-table"><thead><tr><th>便名</th><th>航空会社</th><th>出発</th><th>出発時刻</th><th>到着</th><th>到着時刻</th><th>運航日</th><th>機材</th><th>有効期間</th></tr></thead><tbody>${data.slice(0, 500).map(item => `<tr><td><span class="flight-number">${esc(item.flight)}</span></td><td>${airlineMarkup(item.airline)}</td><td><span class="airport-code">${esc(item.origin)}</span><small class="subtext">${esc(AIRPORTS[item.origin] || "")}</small></td><td class="mono">${esc(item.departure)}</td><td><span class="airport-code">${esc(item.destination)}</span><small class="subtext">${esc(AIRPORTS[item.destination] || "")}</small></td><td class="mono">${esc(item.arrival)}</td><td>${esc(item.calendar)}</td><td>${esc(item.aircraft)}</td><td>${esc(item.from || "—")}<small class="subtext">〜 ${esc(item.to || "—")}</small></td></tr>`).join("")}</tbody></table>`;
  }

  function average(values) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
  function renderAnalytics() {
    const flights = allFlights(), delayed = flights.filter(item => isDelayed(item) && !isCancelled(item)), cancelled = flights.filter(isCancelled);
    const delayValues = delayed.map(delayMinutes).filter(value => value > 0);
    const peak = hourlyCounts();
    const peakHour = peak.reduce((best, item) => item.total > best.total ? item : best, { hour: "—", total: 0 });
    $("#analyticsMetrics").innerHTML = [metric("取得便数", flights.length, "現在のデータセット"), metric("平均遅延", `${average(delayValues)}分`, `${delayValues.length}便から算出`, "var(--amber)"), metric("欠航率", `${flights.length ? (cancelled.length / flights.length * 100).toFixed(1) : 0}%`, `${cancelled.length}便`, "var(--red)"), metric("ピーク時間帯", peakHour.total ? `${peakHour.hour}:00` : "—", `${peakHour.total}便`, "#6747c7"), metric("監視空港", uniqueAirports().length, "出発地・到着地", "var(--green)")].join("");
    const max = Math.max(1, ...peak.map(item => Math.max(item.departure, item.arrival)));
    $("#hourlyChart").innerHTML = peak.map(item => `<div class="bar-column" title="${item.hour}時 出発${item.departure} 到着${item.arrival}"><div class="bar-pair"><i class="bar" style="height:${item.departure / max * 100}%"></i><i class="bar arr" style="height:${item.arrival / max * 100}%"></i></div><span class="bar-label">${item.hour}</span></div>`).join("");
    const airlineGroups = groupBy(flights, item => item._airline || item._provider);
    const largest = Math.max(1, ...[...airlineGroups.values()].map(items => items.length));
    $("#airlineAnalysis").innerHTML = [...airlineGroups].sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([airline, items]) => `<div class="analysis-row"><div class="analysis-row-top"><span>${airlineMarkup(airline)}</span><strong>${items.length}便 · 遅延${items.filter(isDelayed).length}</strong></div><div class="progress"><i style="width:${items.length / largest * 100}%;background:${airlineColor(airline)}"></i></div></div>`).join("") || empty("分析対象がありません");
    const destinations = new Map();
    flights.forEach(item => { const r = route(item), ap = item._direction === "departure" ? r.to : r.from; destinations.set(ap, (destinations.get(ap) || 0) + 1); });
    $("#destinationAnalysis").innerHTML = [...destinations].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ap, count]) => `<div class="destination-item"><strong>${esc(ap)}</strong><span>${esc(AIRPORTS[ap] || ap)}</span><small>${count}便</small></div>`).join("") || empty("分析対象がありません");
  }
  function hourlyCounts() {
    return Array.from({ length: 24 }, (_, hour) => ({ hour: String(hour).padStart(2, "0"), departure: state.departures.filter(item => minutes(scheduledTime(item)) >= hour * 60 && minutes(scheduledTime(item)) < (hour + 1) * 60).length, arrival: state.arrivals.filter(item => minutes(scheduledTime(item)) >= hour * 60 && minutes(scheduledTime(item)) < (hour + 1) * 60).length })).map(item => ({ ...item, total: item.departure + item.arrival }));
  }
  function groupBy(items, keyFn) { const map = new Map(); items.forEach(item => { const key = keyFn(item) || "その他"; map.set(key, [...(map.get(key) || []), item]); }); return map; }
  function uniqueAirports() { const set = new Set(); allFlights().forEach(item => Object.values(route(item)).forEach(ap => ap && set.add(ap))); return [...set]; }

  function renderSaved() {
    const items = allFlights().filter(item => state.favorites.has(itemId(item)));
    $("#savedFlights").innerHTML = items.length ? items.map(flightCardMarkup).join("") : empty("まだ保存した便はありません。フライトボードで♡を押してください。");
    const snapshots = readJSON(CONFIG.snapshotsKey, []);
    $("#snapshotList").innerHTML = snapshots.length ? snapshots.map((snapshot, index) => `<div class="snapshot-row"><div><strong>${esc(new Date(snapshot.at).toLocaleString("ja-JP"))}</strong><small>総便数 ${snapshot.total} · 遅延 ${snapshot.delay} · 欠航 ${snapshot.cancel}</small></div><button data-delete-snapshot="${index}">削除</button></div>`).join("") : empty("保存したスナップショットはありません");
  }

  function renderSystem() {
    $("#sourceGrid").innerHTML = SOURCES.map(source => {
      const status = state.sourceStatus[source.id];
      const image = source.airline === "ANA" ? `<img class="ana-source-logo" src="assets/ana-logo/corp_symbol_01.jpg" alt="ANA">` : `<span class="live-dot ${status ? (status.ok ? "" : "error") : "loading"}"></span>`;
      return `<div class="source-card"><div class="source-card-top">${image}<strong>${esc(source.name)}</strong><span class="status ${status?.ok ? "ok" : status ? "cancel" : "boarding"}">${status?.ok ? "正常" : status ? "エラー" : "未確認"}</span></div><p>取得件数 <b>${status?.count ?? "—"}</b> · 応答 <b>${status?.latency ? `${status.latency}ms` : "—"}</b><br>${source.challenge ? "チャレンジ2026 API" : "ODPT 標準 API"}</p></div>`;
    }).join("");
  }

  function findFlight(id) { return allFlights().find(item => itemId(item) === id); }
  function openDetail(item) {
    if (!item) return;
    const r = route(item), info = statusInfo(item), delayed = delayMinutes(item), active = state.favorites.has(itemId(item));
    const note = getText(item["odpt:flightInformationSummary"]) || getText(item["odpt:flightInformationText"]);
    $("#drawerContent").innerHTML = `<div class="drawer-header"><span class="section-kicker">FLIGHT DETAILS</span><h2>${esc(flightNumber(item))}<button class="favorite ${active ? "active" : ""}" data-favorite-id="${esc(itemId(item))}">${active ? "♥" : "♡"}</button></h2><p>${airlineMarkup(item._airline)} · ${isInternational(item) ? "国際線" : "国内線"} · ${item._direction === "departure" ? "出発情報" : "到着情報"}</p><span class="status ${info.cls}">${esc(info.label)}</span></div><div class="drawer-route"><div><strong>${esc(r.from)}</strong><small>${esc(AIRPORTS[r.from] || r.from)}</small></div><span>→</span><div><strong>${esc(r.to)}</strong><small>${esc(AIRPORTS[r.to] || r.to)}</small></div></div><div class="drawer-timeline"><div class="drawer-time"><strong>${esc(scheduledTime(item))}</strong><i class="timeline-dot"></i><div><p>定刻</p><small>${item._direction === "departure" ? "出発予定時刻" : "到着予定時刻"}</small></div></div><div class="drawer-time"><strong class="${delayed > 0 ? "delay-text" : ""}">${esc(actualTime(item) || estimatedTime(item) || "—")}</strong><i class="timeline-dot"></i><div><p>${actualTime(item) ? "実績時刻" : "変更予定時刻"}</p><small>${delayed > 0 ? `定刻より${delayed}分遅れ` : delayed < 0 ? `定刻より${Math.abs(delayed)}分早い` : "定刻どおり"}</small></div></div></div><div class="detail-grid"><div class="detail-box"><span>ターミナル</span><strong>${esc(terminal(item[item._direction === "departure" ? "odpt:departureAirportTerminal" : "odpt:arrivalAirportTerminal"]))}</strong></div><div class="detail-box"><span>搭乗口</span><strong>${esc(item["odpt:departureGate"] || "—")}</strong></div><div class="detail-box"><span>機材</span><strong>${esc(item["odpt:aircraftType"] || "—")}</strong></div><div class="detail-box"><span>データ提供</span><strong>${esc(item._provider || item._airline)}</strong></div></div>${note ? `<div class="info-note">${esc(note)}</div>` : ""}`;
    $("#detailDrawer").classList.add("open");
    $("#detailDrawer").setAttribute("aria-hidden", "false");
    $("#scrim").classList.add("open");
  }
  function closeDetail() {
    $("#detailDrawer").classList.remove("open");
    $("#detailDrawer").setAttribute("aria-hidden", "true");
    $("#scrim").classList.remove("open");
  }

  function toggleFavorite(id) {
    if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
    writeJSON(CONFIG.favoritesKey, [...state.favorites]);
    renderAll();
    const current = findFlight(id);
    if ($("#detailDrawer").classList.contains("open") && current) openDetail(current);
    toast(state.favorites.has(id) ? "保存した便に追加しました" : "保存した便から外しました");
  }
  function saveSnapshot() {
    const snapshots = readJSON(CONFIG.snapshotsKey, []);
    snapshots.unshift({ at: new Date().toISOString(), total: allFlights().length, delay: allFlights().filter(isDelayed).length, cancel: allFlights().filter(isCancelled).length });
    writeJSON(CONFIG.snapshotsKey, snapshots.slice(0, 20));
    renderSaved();
    toast("現在の運航状態を保存しました");
  }
  function exportCsv(filename, rows) {
    if (!rows.length) return toast("出力できるデータがありません");
    const csv = "\uFEFF" + rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function populateFilters() {
    const airports = uniqueAirports().sort();
    [$("#airportFilter"), $("#alertAirportFilter")].forEach(select => {
      const selected = select.value;
      const first = select.id === "airportFilter" ? "すべての空港" : "全空港";
      select.innerHTML = `<option value="all">${first}</option>${airports.map(ap => `<option value="${esc(ap)}">${esc(ap)} ${esc(AIRPORTS[ap] || "")}</option>`).join("")}`;
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    });
    const days = [...new Set(flattenSchedules().map(item => item.calendar).filter(Boolean))];
    const daySelect = $("#scheduleDay"), selected = daySelect.value;
    daySelect.innerHTML = `<option value="all">全運航日</option>${days.map(day => `<option value="${esc(day)}">${esc(day)}</option>`).join("")}`;
    if ([...daySelect.options].some(option => option.value === selected)) daySelect.value = selected;
  }

  function showView(view, search = "") {
    state.currentView = view;
    $$(".view").forEach(element => element.classList.toggle("active", element.id === `view-${view}`));
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === view));
    const names = { overview: ["OPERATIONS OVERVIEW", greeting()], flights: ["LIVE FLIGHT BOARD", "フライトボード"], alerts: ["IRREGULAR OPERATIONS", "運航アラート"], airports: ["AIRPORT MONITOR", "空港モニター"], schedule: ["PUBLISHED TIMETABLE", "運航時刻表"], analytics: ["PERFORMANCE", "運航分析"], saved: ["MY WATCHLIST", "保存した便"], system: ["DATA SOURCES", "データ接続"] };
    $("#pageEyebrow").textContent = names[view][0];
    $("#pageTitle").textContent = names[view][1];
    location.hash = view;
    renderAll();
    if (view === "flights" && search) { $("#flightSearch").value = search; renderFlights(); }
    $("#sidebar").classList.remove("open");
  }
  function greeting() {
    const hour = new Date().getHours();
    return hour < 11 ? "おはようございます" : hour < 18 ? "こんにちは" : "おつかれさまです";
  }
  function updateClock() {
    const now = new Date();
    $("#clock").textContent = now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    $("#date").textContent = now.toLocaleDateString("ja-JP", { month: "short", day: "numeric", weekday: "short" });
  }
  function resetRefreshTimer() {
    clearInterval(state.refreshTimer);
    if ($("#autoRefresh").checked) state.refreshTimer = setInterval(fetchAllData, Number($("#refreshInterval").value));
  }

  function bindEvents() {
    document.addEventListener("click", event => {
      const nav = event.target.closest("[data-view]");
      if (nav) return showView(nav.dataset.view);
      const go = event.target.closest("[data-go]");
      if (go) return showView(go.dataset.go);
      const favorite = event.target.closest("[data-favorite-id]");
      if (favorite) { event.stopPropagation(); return toggleFavorite(favorite.dataset.favoriteId); }
      const flight = event.target.closest("[data-flight-id]");
      if (flight) return openDetail(findFlight(flight.dataset.flightId));
      const airport = event.target.closest("[data-airport]");
      if (airport) { state.airport = airport.dataset.airport; return renderAirports(); }
      const direction = event.target.closest("[data-direction]");
      if (direction) {
        const parent = direction.parentElement;
        $$('button', parent).forEach(button => button.classList.remove("active")); direction.classList.add("active");
        if (parent.id === "overviewDirection") { state.overviewDirection = direction.dataset.direction; renderUpcoming(); }
        else { state.direction = direction.dataset.direction; renderFlights(); }
        return;
      }
      const layout = event.target.closest("[data-layout]");
      if (layout) { state.layout = layout.dataset.layout; $$('[data-layout]').forEach(button => button.classList.toggle("active", button === layout)); renderFlights(); return; }
      const deletion = event.target.closest("[data-delete-snapshot]");
      if (deletion) { const snapshots = readJSON(CONFIG.snapshotsKey, []); snapshots.splice(Number(deletion.dataset.deleteSnapshot), 1); writeJSON(CONFIG.snapshotsKey, snapshots); renderSaved(); }
    });
    ["flightSearch", "airlineFilter", "airportFilter", "statusFilter", "typeFilter", "sortFlights"].forEach(id => $("#" + id).addEventListener(id === "flightSearch" ? "input" : "change", renderFlights));
    ["scheduleSearch", "scheduleAirline", "scheduleDay"].forEach(id => $("#" + id).addEventListener(id === "scheduleSearch" ? "input" : "change", renderSchedules));
    $("#alertAirportFilter").addEventListener("change", renderAlerts);
    $("#clearFilters").addEventListener("click", () => { $("#flightSearch").value = ""; ["airlineFilter", "airportFilter", "statusFilter", "typeFilter"].forEach(id => $("#" + id).value = "all"); renderFlights(); });
    $("#refreshButton").addEventListener("click", fetchAllData);
    $("#systemRefresh").addEventListener("click", fetchAllData);
    $("#saveSnapshot").addEventListener("click", saveSnapshot);
    $("#closeDrawer").addEventListener("click", closeDetail);
    $("#scrim").addEventListener("click", () => { closeDetail(); $("#sidebar").classList.remove("open"); });
    $("#menuButton").addEventListener("click", () => { $("#sidebar").classList.toggle("open"); $("#scrim").classList.toggle("open", $("#sidebar").classList.contains("open")); });
    $("#autoRefresh").addEventListener("change", resetRefreshTimer);
    $("#refreshInterval").addEventListener("change", resetRefreshTimer);
    $("#clearCache").addEventListener("click", () => { localStorage.removeItem(CONFIG.cacheKey); toast("データキャッシュを消去しました"); });
    $("#globalSearch").addEventListener("keydown", event => { if (event.key === "Enter") { showView("flights", event.target.value); event.target.value = ""; } });
    document.addEventListener("keydown", event => {
      if (event.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { event.preventDefault(); $("#globalSearch").focus(); }
      if (event.key === "Escape") closeDetail();
    });
    $("#exportFlights").addEventListener("click", () => exportCsv(`flights-${new Date().toISOString().slice(0,10)}.csv`, [["方向","定刻","便名","航空会社","出発地","到着地","実績・予定","ゲート","機材","状態"], ...filteredFlights().map(item => { const r = route(item); return [item._direction, scheduledTime(item), flightNumber(item), item._airline, r.from, r.to, operationalTime(item), item["odpt:departureGate"] || "", item["odpt:aircraftType"] || "", statusInfo(item).label]; })]));
    $("#exportSchedule").addEventListener("click", () => exportCsv(`flight-schedule-${new Date().toISOString().slice(0,10)}.csv`, [["便名","航空会社","出発地","出発時刻","到着地","到着時刻","運航日","機材","有効開始","有効終了"], ...filteredSchedules().map(item => [item.flight,item.airline,item.origin,item.departure,item.destination,item.arrival,item.calendar,item.aircraft,item.from,item.to])]));
  }

  function boot() {
    bindEvents();
    updateClock();
    setInterval(updateClock, 30000);
    const cached = readJSON(CONFIG.cacheKey, null);
    if (cached) {
      state.departures = cached.departures || [];
      state.arrivals = cached.arrivals || [];
      state.schedules = cached.schedules || [];
      state.updatedAt = cached.updatedAt ? new Date(cached.updatedAt) : null;
    }
    populateFilters();
    renderAll();
    const hash = location.hash.slice(1);
    showView($("#view-" + hash) ? hash : "overview");
    resetRefreshTimer();
    fetchAllData();
  }

  boot();
})();
