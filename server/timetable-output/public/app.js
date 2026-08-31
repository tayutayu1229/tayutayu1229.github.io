(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyAjMS_UwsMRm3XkXBqRnt4mgugR1LhWz4I",
    authDomain: "tokyo-pass.firebaseapp.com",
    projectId: "tokyo-pass",
    storageBucket: "tokyo-pass.firebasestorage.app",
    messagingSenderId: "950120670058",
    appId: "1:950120670058:web:3cd13fca317d87baeb7b13",
  };

  const byId = (id) => document.getElementById(id);
  let rawData = [];
  let currentFiltered = [];
  let selectedItem = null;
  let currentUser = null;
  let currentPage = 1;
  const expandedRows = new Set();
  const searchCache = new WeakMap();
  const LOCATION_STORAGE_KEY = "tayunet-timetable-output-location";

  function savedLocation() {
    try { return localStorage.getItem(LOCATION_STORAGE_KEY) || ""; }
    catch (_error) { return ""; }
  }

  function rememberLocation(value) {
    try { localStorage.setItem(LOCATION_STORAGE_KEY, value); }
    catch (_error) { /* storage may be disabled */ }
  }

  function showRowsMessage(message, error) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.className = error ? "empty error" : "empty";
    cell.textContent = message;
    row.appendChild(cell);
    byId("list").replaceChildren(row);
  }

  async function api(path, options) {
    if (!currentUser) throw Object.assign(new Error("login_required"), { status: 401 });
    const request = { ...options, headers: new Headers(options?.headers || {}) };
    request.headers.set("Accept", "application/json");
    request.headers.set("Authorization", `Bearer ${await currentUser.getIdToken()}`);
    if (request.body) request.headers.set("Content-Type", "application/json");
    let response = await fetch(path, request);
    if (response.status === 401) {
      request.headers.set("Authorization", `Bearer ${await currentUser.getIdToken(true)}`);
      response = await fetch(path, request);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `HTTP ${response.status}`), { status: response.status });
    return payload;
  }

  function makeCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "");
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function normalized(value) {
    return String(value ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
  }

  function dayText(item) {
    const value = item.dayType ?? item.operationDay ?? item.serviceType ?? item.calendar ?? "";
    return Array.isArray(value)
      ? value.map((part) => String(part || "").replace(/\s/g, "")).filter(Boolean).join("・")
      : String(value || "").replace(/\s/g, "");
  }

  function stopsOf(item) {
    return Array.isArray(item.stops) ? item.stops : [];
  }

  function routeOf(item) {
    const stops = stopsOf(item);
    return {
      origin: String(item.origin || stops[0]?.station || "—"),
      destination: String(item.destination || stops.at(-1)?.station || "—"),
    };
  }

  function timeRangeOf(item) {
    const stops = stopsOf(item);
    const first = stops.find((stop) => stop?.departure || stop?.arrival);
    const last = stops.slice().reverse().find((stop) => stop?.arrival || stop?.departure);
    return {
      first: String(first?.departure || first?.arrival || "—"),
      last: String(last?.arrival || last?.departure || "—"),
    };
  }

  function searchText(item) {
    if (searchCache.has(item)) return searchCache.get(item);
    const stops = stopsOf(item).flatMap((stop) => [stop?.station, stop?.arrival, stop?.departure, stop?.trackN]);
    const value = normalized([
      item.startDate, item.line, item.trainNumber, item.type, dayText(item),
      item.origin, item.destination, ...stops,
    ].join(" "));
    searchCache.set(item, value);
    return value;
  }

  function trainKey(item) {
    return [item.startDate, item.line, item.trainNumber, item.origin, item.destination].map(normalized).join("|");
  }

  function compareText(left, right) {
    return String(left || "").localeCompare(String(right || ""), "ja", { numeric: true });
  }

  function sortedRows(rows) {
    const mode = byId("sort-select").value;
    return rows.slice().sort((left, right) => {
      if (mode === "date-asc") return compareText(left.startDate, right.startDate) || compareText(left.trainNumber, right.trainNumber);
      if (mode === "train") return compareText(left.trainNumber, right.trainNumber) || compareText(left.startDate, right.startDate);
      if (mode === "line") return compareText(left.line, right.line) || compareText(left.trainNumber, right.trainNumber);
      return compareText(right.startDate, left.startDate) || compareText(left.trainNumber, right.trainNumber);
    });
  }

  function addRouteCell(row, item) {
    const route = routeOf(item);
    const cell = makeCell(row, "", "route");
    const arrow = document.createElement("span");
    arrow.className = "route-arrow";
    arrow.textContent = "→";
    cell.append(document.createTextNode(route.origin), arrow, document.createTextNode(route.destination));
  }

  function addTimeCell(row, item) {
    const range = timeRangeOf(item);
    makeCell(row, `${range.first} → ${range.last}`, "time-range");
  }

  function detailRow(item) {
    const row = document.createElement("tr");
    row.className = "detail-row";
    const cell = document.createElement("td");
    cell.colSpan = 9;
    const details = document.createElement("div");
    details.className = "train-details";
    const summary = document.createElement("div");
    summary.className = "detail-summary";
    const route = routeOf(item);
    const times = timeRangeOf(item);
    [`区間：${route.origin} → ${route.destination}`, `時刻：${times.first} → ${times.last}`, `運転日：${dayText(item) || "記載なし"}`].forEach((value) => {
      const span = document.createElement("span");
      span.textContent = value;
      summary.appendChild(span);
    });
    const stops = document.createElement("div");
    stops.className = "stops";
    stopsOf(item).forEach((stop, index) => {
      if (index) {
        const arrow = document.createElement("span");
        arrow.className = "stop-arrow";
        arrow.textContent = "→";
        stops.appendChild(arrow);
      }
      const chip = document.createElement("span");
      chip.className = "stop";
      const station = document.createElement("b");
      station.textContent = String(stop?.station || "駅名なし");
      const time = document.createElement("small");
      const parts = [];
      if (stop?.arrival) {
        const arrival = String(stop.arrival).trim();
        parts.push(arrival === "着" ? "着" : `着 ${arrival}`);
      }
      if (stop?.departure) {
        const departure = String(stop.departure).trim();
        parts.push(departure === "発" ? "発" : `発 ${departure}`);
      }
      if (stop?.trackN) {
        const track = String(stop.trackN).trim();
        parts.push(/番(?:線)?$/.test(track) ? track : `${track}番線`);
      }
      time.textContent = parts.join(" ") || "時刻記載なし";
      chip.append(station, time);
      stops.appendChild(chip);
    });
    details.append(summary, stops);
    cell.appendChild(details);
    row.appendChild(cell);
    return row;
  }

  function render() {
    const date = byId("qD").value.replace(/-/g, "/");
    const keyword = normalized(byId("qK").value);
    const line = byId("qLine").value;
    const type = byId("qType").value;
    const day = byId("qDay").value;
    currentFiltered = sortedRows(rawData.filter((item) => (
      (date === "" || item.startDate === date)
      && (!keyword || searchText(item).includes(keyword))
      && (!line || String(item.line || "") === line)
      && (!type || String(item.type || "") === type)
      && (!day || dayText(item) === day)
    )));
    byId("result-count").textContent = `${currentFiltered.length.toLocaleString()}件／全${rawData.length.toLocaleString()}件`;
    if (!currentFiltered.length) {
      byId("pagination").hidden = true;
      return showRowsMessage("条件に合う列車はありません。キーワードや絞り込みを変えてください。", false);
    }
    const pageSize = Number(byId("page-size").value) || 100;
    const totalPages = Math.max(1, Math.ceil(currentFiltered.length / pageSize));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const visibleRows = currentFiltered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const fragment = document.createDocumentFragment();
    visibleRows.forEach((item) => {
      const row = document.createElement("tr");
      makeCell(row, item.startDate);
      makeCell(row, item.line, "line-txt");
      makeCell(row, item.trainNumber, "train-no");
      makeCell(row, item.type);
      makeCell(row, dayText(item) || "—", "day-type");
      addRouteCell(row, item);
      addTimeCell(row, item);
      makeCell(row, `${stopsOf(item).length}駅`, "stop-count");
      const action = makeCell(row, "");
      action.className = "row-actions";
      const detailButton = document.createElement("button");
      detailButton.type = "button";
      detailButton.className = "btn btn-small btn-detail";
      const key = trainKey(item);
      detailButton.textContent = expandedRows.has(key) ? "閉じる" : "詳細";
      detailButton.addEventListener("click", () => {
        if (expandedRows.has(key)) expandedRows.delete(key); else expandedRows.add(key);
        render();
      });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-green btn-small";
      button.textContent = "選択";
      button.addEventListener("click", () => openConfirm(item));
      action.append(detailButton, button);
      fragment.appendChild(row);
      if (expandedRows.has(key)) fragment.appendChild(detailRow(item));
    });
    byId("list").replaceChildren(fragment);
    byId("pagination").hidden = false;
    byId("page-info").textContent = `${currentPage} / ${totalPages}ページ（${((currentPage - 1) * pageSize + 1).toLocaleString()}〜${Math.min(currentPage * pageSize, currentFiltered.length).toLocaleString()}件）`;
    byId("previous-page").disabled = currentPage <= 1;
    byId("next-page").disabled = currentPage >= totalPages;
  }

  function replaceOptions(selectId, values, label) {
    const select = byId(selectId);
    const previous = select.value;
    const first = document.createElement("option");
    first.value = "";
    first.textContent = label;
    const options = [...new Set(values.filter(Boolean))].sort(compareText).map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      return option;
    });
    select.replaceChildren(first, ...options);
    if (options.some((option) => option.value === previous)) select.value = previous;
  }

  async function load() {
    showRowsMessage("時刻表データを読み込んでいます。", false);
    byId("reload-button").disabled = true;
    try {
      const [timetables, workbase] = await Promise.all([api("/api/timetables"), api("/api/workbase")]);
      rawData = timetables.items.filter((item) => item && typeof item === "object");
      replaceOptions("qLine", rawData.map((item) => String(item.line || "")), "すべての線区");
      replaceOptions("qType", rawData.map((item) => String(item.type || "")), "すべての種別");
      replaceOptions("qDay", rawData.map(dayText), "すべて");
      const select = byId("qL");
      const previous = savedLocation() || select.value;
      const options = workbase.items.map((location) => {
        const option = document.createElement("option");
        option.value = location;
        option.textContent = location;
        return option;
      });
      select.replaceChildren(...options);
      if (workbase.items.includes(previous)) select.value = previous;
      if (select.value) rememberLocation(select.value);
      currentPage = 1;
      render();
    } catch (error) {
      const message = error.status === 403
        ? "このアカウントは利用できません。管理者へ確認してください。"
        : "時刻表データを読み込めませんでした。更新を押して再度お試しください。";
      showRowsMessage(message, true);
    } finally {
      byId("reload-button").disabled = false;
    }
  }

  function openConfirm(item) {
    selectedItem = item;
    const view = byId("confirm-view");
    view.replaceChildren();
    const route = routeOf(item);
    const outputDate = byId("qOutputDate").value.replace(/-/g, "/") || item.startDate;
    [["元の施行日", item.startDate], ["PDFの施行日", outputDate], ["線区", item.line], ["列番", item.trainNumber], ["区間", `${route.origin} → ${route.destination}`], ["箇所", byId("qL").value]].forEach(([label, value], index) => {
      if (index) view.appendChild(document.createElement("br"));
      const bold = document.createElement("b");
      bold.textContent = `${label}:`;
      view.append(bold, document.createTextNode(` ${String(value || "")}`));
    });
    byId("overlay").classList.add("visible");
  }

  function closeModal() {
    selectedItem = null;
    byId("overlay").classList.remove("visible");
  }

  function downloadPdf(base64, fileName) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function execute() {
    if (!selectedItem) return;
    const item = selectedItem;
    const location = byId("qL").value;
    closeModal();
    byId("loading-overlay").classList.add("visible");
    try {
      const result = await api("/import", {
        method: "POST",
        body: JSON.stringify({
          location,
          outputDate: byId("qOutputDate").value,
          trainKey: {
            trainNumber: String(item.trainNumber || ""),
            startDate: String(item.startDate || ""),
            line: String(item.line || ""),
            origin: String(item.origin || ""),
            destination: String(item.destination || ""),
          },
        }),
      });
      downloadPdf(result.pdf, result.fileName);
    } catch (error) {
      alert(`エラー: ${error.message || "PDFの発行に失敗しました"}`);
    } finally {
      byId("loading-overlay").classList.remove("visible");
    }
  }

  const auth = firebase.initializeApp(firebaseConfig).auth();
  auth.languageCode = "ja";
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  byId("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    byId("auth-error").textContent = "";
    byId("login-button").disabled = true;
    try {
      await auth.signInWithEmailAndPassword(byId("login-email").value.trim(), byId("login-password").value);
      byId("login-password").value = "";
    } catch (_error) {
      byId("auth-error").textContent = "メールアドレスまたはパスワードを確認してください。";
    } finally {
      byId("login-button").disabled = false;
    }
  });
  byId("reload-button").addEventListener("click", load);
  byId("qL").addEventListener("change", () => rememberLocation(byId("qL").value));
  ["qK", "qD", "qLine", "qType", "qDay"].forEach((id) => byId(id).addEventListener("input", () => { currentPage = 1; render(); }));
  byId("sort-select").addEventListener("change", () => { currentPage = 1; render(); });
  byId("page-size").addEventListener("change", () => { currentPage = 1; render(); });
  byId("clear-filters").addEventListener("click", () => {
    ["qK", "qD", "qLine", "qType", "qDay"].forEach((id) => { byId(id).value = ""; });
    currentPage = 1;
    render();
  });
  byId("previous-page").addEventListener("click", () => { if (currentPage > 1) { currentPage -= 1; render(); scrollTo({ top: 0, behavior: "smooth" }); } });
  byId("next-page").addEventListener("click", () => { currentPage += 1; render(); scrollTo({ top: 0, behavior: "smooth" }); });
  byId("close-modal").addEventListener("click", closeModal);
  byId("exec-final").addEventListener("click", execute);
  byId("overlay").addEventListener("click", (event) => { if (event.target === byId("overlay")) closeModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    byId("auth-screen").hidden = Boolean(user);
    if (user) await load();
  });
})();
