document.addEventListener('DOMContentLoaded', () => {
    // 前のページから渡されたデータを取得
    const sessionData = sessionStorage.getItem('selectedTrainData');
    if (!sessionData) {
        console.error("列車データが見つかりません");
        return;
    }
    const trainGroup = JSON.parse(sessionData);
    const train = trainGroup[0]; // 最初の要素を対象とする

    // ヘッダー情報の反映
    document.getElementById("date").textContent = train.startDate || "";
    document.getElementById("train-no").textContent = train.tr1 || train.trainNumber || "";
    // 速度種別や最高速度がJSONに存在する場合はここで反映（現状は空欄対応）
    const maxSpeedEl = document.getElementById("max-speed");
    if (maxSpeedEl) maxSpeedEl.textContent = train.speed || "";

    const body = document.getElementById("timetable-body");
    body.innerHTML = "";

    // ヘルパー関数: 空判定（鉄道特有の記号を含む）
    const isBlank = (v) => !v || v.trim() === "" || v.trim() === "…" || v.trim() === "||";

    // 時刻を秒に変換（正確な計算用）
    const toTotalSeconds = (timeStr) => {
        if (!timeStr || isBlank(timeStr)) return null;
        const parts = timeStr.split(':');
        if (parts.length < 2) return null;
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = parts[2] ? parseInt(parts[2], 10) : 0;
        return h * 3600 + m * 60 + s;
    };

    // 表示用時刻の整形 (10:02:30 -> 10.02 30)
    const formatTimeForDisplay = (timeStr, isPass) => {
        if (!timeStr || timeStr.trim() === "") return "";
        if (timeStr === "…" || timeStr === "||") return timeStr;

        const parts = timeStr.split(':');
        const h = parts[0];
        const m = parts[1];
        const s = parts[2] || "00";

        const content = `${h}.${m}<span class="sec">${s}</span>`;
        return isPass ? `( ${content} )` : content;
    };

    // 運転時分の計算
    const calcRunTime = (startSec, endSec) => {
        if (startSec === null || endSec === null) return "";
        const diff = endSec - startSec;
        if (diff < 0) return ""; // 逆転防止

        const m = Math.floor(diff / 60);
        const s = diff % 60;
        // 分を大きく、秒を小さく表示
        return `<div>${m}</div><div class="runtime-sec">${s.toString().padStart(2, '0')}</div>`;
    };

    let lastDepartureSec = null;

    train.stops.forEach((stop, index) => {
        const arrSec = toTotalSeconds(stop.arrival);
        const depSec = toTotalSeconds(stop.departure);

        // 通過判定: arrivalが空または記号なら通過
        const isPass = (stop.arrival === "…" || stop.arrival === "||" || stop.arrival === " ");
        
        // 運転時分計算用の「今回の着火点」
        // 通過駅ならdepartureの時刻を基準にし、停車駅ならarrivalを基準にする
        const currentReferenceSec = isPass ? depSec : (arrSec || depSec);

        const row = document.createElement("div");
        row.className = "row";
        if (isPass) row.classList.add("is-pass");

        // 運転時分セルの生成
        const runtimeContent = (index > 0 && lastDepartureSec !== null) 
            ? calcRunTime(lastDepartureSec, currentReferenceSec) 
            : "";

        row.innerHTML = `
            <div class="cell runtime-cell">${runtimeContent}</div>
            <div class="cell station-name">${stop.station}</div>
            <div class="cell">
                <div class="time-val ${!isPass && arrSec !== null ? 'arr-box cell' : ''}">
                    ${formatTimeForDisplay(stop.arrival, isPass)}
                </div>
            </div>
            <div class="cell time-val">
                ${formatTimeForDisplay(stop.departure, false)}
            </div>
            <div class="cell track-cell">${stop.trackN || ""}</div>
            <div class="cell limit-cell">30</div>
            <div class="cell memo-cell"></div>
        `;

        body.appendChild(row);

        // 次の駅のために基準時刻を更新
        // 通過・停車に関わらず、その駅を「出た」時刻を次の区間の開始点とする
        if (depSec !== null) {
            lastDepartureSec = depSec;
        }
    });
});
