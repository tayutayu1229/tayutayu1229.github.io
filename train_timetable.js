document.addEventListener('DOMContentLoaded', () => {
    const sessionData = sessionStorage.getItem('selectedTrainData');
    if (!sessionData) return;

    const trainGroup = JSON.parse(sessionData);
    const train = Array.isArray(trainGroup) ? trainGroup[0] : trainGroup;

    // ヘッダー情報の反映（undefined対策）
    const safeSet = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = (val === undefined || val === null) ? "" : val;
    };

    safeSet("date", train.startDate);
    safeSet("train-no", train.tr1 || train.trainNumber);
    safeSet("max-speed", ""); // 制限速度は空欄
    safeSet("speed-type", ""); 

    // 出力先を main (#timetable-body) に指定
    const body = document.getElementById("timetable-body");
    if (!body) return;
    body.innerHTML = "";

    const isBlank = (v) => !v || v.trim() === "" || v.trim() === "…" || v.trim() === "||";

    const toTotalSeconds = (timeStr) => {
        if (isBlank(timeStr) || timeStr.includes("=")) return null;
        const parts = timeStr.split(':');
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = parts[2] ? parseInt(parts[2], 10) : 0;
        return h * 3600 + m * 60 + s;
    };

    const formatTime = (timeStr, isPass) => {
        if (!timeStr || timeStr === undefined) return "";
        const t = timeStr.trim();
        if (t === "" || t === "…" || t === "||") return t;
        if (t.includes("=")) return t;

        const parts = t.split(':');
        if (parts.length < 2) return t;

        const h = parts[0];
        const m = parts[1];
        const s = parts[2] || "00";
        // 秒を大きく表示するためのクラスを適用
        const content = `${h}.${m}<span class="sec">${s}</span>`;
        return isPass ? `( ${content} )` : content;
    };

    const calcRunTime = (startSec, endSec) => {
        if (startSec === null || endSec === null) return "";
        const diff = endSec - startSec;
        if (diff <= 0) return ""; 
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        return `<div>${m}</div><div class="runtime-sec">${s.toString().padStart(2, '0')}</div>`;
    };

    let lastDepartureSec = null;

    train.stops.forEach((stop, index) => {
        const arrSec = toTotalSeconds(stop.arrival);
        const depSec = toTotalSeconds(stop.departure);

        // 通過判定（始発と終着以外で着時刻が空なら通過）
        const isPass = isBlank(stop.arrival) && index !== 0 && index !== train.stops.length - 1;
        const currentRefSec = isPass ? depSec : (arrSec || depSec);

        const row = document.createElement("div");
        row.className = "row";

        const runtimeContent = (index > 0 && lastDepartureSec !== null) 
            ? calcRunTime(lastDepartureSec, currentRefSec) 
            : "";

        // trackN（着発線）の undefined 対策
        const trackText = (stop.trackN === undefined || stop.trackN === null) ? "" : stop.trackN;

        row.innerHTML = `
            <div class="cell runtime-cell">${runtimeContent}</div>
            <div class="cell station-name">${stop.station || ""}</div>
            <div class="cell time-val">
                ${formatTime(stop.arrival, isPass)}
            </div>
            <div class="cell time-val">
                ${formatTime(stop.departure, false)}
            </div>
            <div class="cell track-cell">${trackText}</div>
            <div class="cell"></div>
            <div class="cell memo-cell"></div>
        `;

        body.appendChild(row);

        if (depSec !== null) lastDepartureSec = depSec;
    });
});
