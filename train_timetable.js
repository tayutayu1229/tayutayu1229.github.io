document.addEventListener('DOMContentLoaded', () => {
    // 1. データの取得とエラーチェック
    const sessionData = sessionStorage.getItem('selectedTrainData');
    if (!sessionData) {
        console.error("データがありません。一覧から選択してください。");
        return;
    }

    const trainGroup = JSON.parse(sessionData);
    // train_list.js は配列で保存しているため、最初の要素を取得
    const train = Array.isArray(trainGroup) ? trainGroup[0] : trainGroup;

    // 2. ヘッダー要素への流し込み（IDが存在するかチェックしながら）
    const setSafeText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setSafeText("date", train.startDate || "");
    setSafeText("train-no", train.tr1 || train.trainNumber || "");
    setSafeText("max-speed", train.speed || ""); // JSONに無ければ空

    const body = document.getElementById("timetable-body");
    if (!body) {
        console.error("ID: timetable-body が見つかりません。HTMLを確認してください。");
        return;
    }
    body.innerHTML = "";

    // 3. 計算用・整形用ツール
    const isBlank = (v) => !v || v.trim() === "" || v.trim() === "…" || v.trim() === "||" || v.trim() === " ";

    const toTotalSeconds = (timeStr) => {
        if (!timeStr || isBlank(timeStr)) return null;
        const parts = timeStr.split(':');
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const s = parts[2] ? parseInt(parts[2], 10) : 0;
        return h * 3600 + m * 60 + s;
    };

    const formatTime = (timeStr, isPass) => {
        if (isBlank(timeStr)) return isPass ? " " : "";
        const parts = timeStr.split(':');
        const h = parts[0];
        const m = parts[1];
        const s = parts[2] || "00";
        const content = `${h}.${m}<span class="sec">${s}</span>`;
        return isPass ? `( ${content} )` : content;
    };

    const calcRunTime = (startSec, endSec) => {
        if (startSec === null || endSec === null) return "";
        const diff = endSec - startSec;
        if (diff < 0) return ""; 
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        return `<div>${m}</div><div class="runtime-sec">${s.toString().padStart(2, '0')}</div>`;
    };

    // 4. メインループ（行生成）
    let lastDepartureSec = null;

    train.stops.forEach((stop, index) => {
        const arrSec = toTotalSeconds(stop.arrival);
        const depSec = toTotalSeconds(stop.departure);

        // 通過判定：着時刻が空、もしくは記号
        const isPass = (stop.arrival === "…" || stop.arrival === "||" || isBlank(stop.arrival));
        
        // 運転時分の基準点
        const currentRefSec = isPass ? depSec : (arrSec || depSec);

        const row = document.createElement("div");
        row.className = "row";

        const runtimeContent = (index > 0 && lastDepartureSec !== null) 
            ? calcRunTime(lastDepartureSec, currentRefSec) 
            : "";

        row.innerHTML = `
            <div class="cell runtime-cell">${runtimeContent}</div>
            <div class="cell station-name">${stop.station}</div>
            <div class="cell">
                <div class="time-val ${!isPass && arrSec !== null ? 'arr-box cell' : ''}">
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

        // 次の駅のための「発」基準
        if (depSec !== null) lastDepartureSec = depSec;
    });
});
