document.addEventListener('DOMContentLoaded', () => {
    // データ取得 (sessionStorageから)
    const trainGroup = JSON.parse(sessionStorage.getItem('selectedTrainData'));
    if (!trainGroup || !trainGroup[0]) return;
    const train = trainGroup[0];

    // ヘッダー反映
    document.getElementById("date").textContent = train.startDate;
    document.getElementById("train-no").textContent = train.tr1 || train.trainNumber;

    const body = document.getElementById("timetable-body");
    
    // ユーティリティ関数
    const isEmpty = (v) => !v || v === "" || v === "…" || v === "||" || v === " ";
    
    const toSec = (t) => {
        if (isEmpty(t)) return null;
        const [h, m, s] = t.split(":").map(Number);
        return h * 3600 + m * 60 + s;
    };

    // 時刻の整形 (10.02 00 形式)
    const formatTime = (timeStr, isPass) => {
        if (isEmpty(timeStr)) return isPass ? " " : "";
        const parts = timeStr.split(":");
        const h = parts[0];
        const m = parts[1];
        const s = parts[2] || "00";
        const content = `${h}.${m}<span class="sec">${s}</span>`;
        return isPass ? `( ${content} )` : content;
    };

    // 正確な運転時分の計算
    const getDiffStr = (startSec, endSec) => {
        if (startSec === null || endSec === null) return "";
        const diff = endSec - startSec;
        if (diff <= 0) return "";
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        // 画像のように分を大きく、秒を右下に配置
        return `<div>${m}</div><div class="runtime-sec">${s.toString().padStart(2, '0')}</div>`;
    };

    let lastPointSec = null;

    train.stops.forEach((stop, index) => {
        const arrSec = toSec(stop.arrival);
        const depSec = toSec(stop.departure);
        const isPass = isEmpty(stop.arrival) && index !== 0; // 初発以外で着が空なら通過

        // 今回の基準点 (着、なければ発)
        const currentPointSec = arrSec !== null ? arrSec : depSec;

        const row = document.createElement("div");
        row.className = "row";

        // 運転時分の表示
        const runtimeContent = lastPointSec ? getDiffStr(lastPointSec, currentPointSec) : "";

        row.innerHTML = `
            <div class="cell runtime-cell">${runtimeContent}</div>
            <div class="cell station-name">${stop.station}</div>
            <div class="cell">
                <div class="time-val ${!isPass && arrSec ? 'arr-box cell' : ''}">
                    ${formatTime(stop.arrival, isPass)}
                </div>
            </div>
            <div class="cell time-val">
                ${formatTime(stop.departure, false)}
            </div>
            <div class="cell track-cell">${stop.trackN || ""}</div>
            <div class="cell">30</div>
            <div class="cell"></div>
        `;

        body.appendChild(row);

        // 次の計算用に「発時刻」を保持（通過ならその時刻）
        if (depSec !== null) lastPointSec = depSec;
    });
});
