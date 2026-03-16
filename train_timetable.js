document.addEventListener('DOMContentLoaded', () => {
    // 1. データの取得
    const sessionData = sessionStorage.getItem('selectedTrainData');
    
    // デバッグ用: ブラウザのF12コンソールでデータが来ているか確認できます
    console.log("SessionData:", sessionData);

    if (!sessionData) {
        alert("列車データが見つかりません。一覧画面から選択し直してください。");
        return;
    }

    const trainGroup = JSON.parse(sessionData);
    // train_list.jsからのデータは配列なので、その1つ目を取り出す
    const train = Array.isArray(trainGroup) ? trainGroup[0] : trainGroup;

    // 2. ヘッダー情報の反映
    document.getElementById("date").textContent = train.startDate || "";
    document.getElementById("train-no").textContent = train.tr1 || train.trainNumber || "";
    document.getElementById("max-speed").textContent = train.speed || "---";
    document.getElementById("speed-type").textContent = train.type || "";

    const body = document.getElementById("timetable-body");
    body.innerHTML = "";

    // 3. ユーティリティ関数
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
        // すでに整形記号の場合はそのまま返す
        if (timeStr === "…" || timeStr === "||") return timeStr;

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
        if (diff <= 0) return ""; 
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        return `<div>${m}</div><div class="runtime-sec">${s.toString().padStart(2, '0')}</div>`;
    };

    // 4. 行の生成
    let lastDepartureSec = null;

    train.stops.forEach((stop, index) => {
        const arrSec = toTotalSeconds(stop.arrival);
        const depSec = toTotalSeconds(stop.departure);

        // 通過駅の判定 (arrivalが空欄、…、|| のいずれか)
        const isPass = isBlank(stop.arrival);
        
        // 運転時分の基準点（停車駅なら着時刻、通過駅なら発(通過)時刻）
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

        // 次の駅の計算用に、この駅の「出発/通過」時刻を保存
        if (depSec !== null) lastDepartureSec = depSec;
    });
});
