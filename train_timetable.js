document.addEventListener('DOMContentLoaded', () => {
    const trainGroup = JSON.parse(sessionStorage.getItem('selectedTrainData'));
    if (!trainGroup) return;

    const train = trainGroup[0];

    // ヘッダ
    document.getElementById("trainTitle").textContent = train.tr1 || train.trainNumber;
    document.getElementById("date").textContent = train.startDate;
    document.getElementById("trainNo").textContent = train.tr1 || train.trainNumber;
    document.getElementById("type").textContent = train.type || "";
    document.getElementById("section").textContent = `${train.origin} → ${train.destination}`;

    const tbody = document.querySelector("#timetable tbody");
    tbody.innerHTML = "";

    const isEmptyLike = (v) => {
        if (v === null || v === undefined) return true;
        const t = String(v).trim();
        return t === "" || t === "…" || t === "||";
    };

    const toSec = (t) => {
        if (isEmptyLike(t)) return null;
        const [h, m, s] = t.split(":").map(Number);
        return h * 3600 + m * 60 + s;
    };

    const secToMin = (sec) => {
        if (sec === null) return "";
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, "0")}`;
    };

    const calcRunTime = (prevDepSec, thisPointSec) => {
        if (!prevDepSec || !thisPointSec) return "";
        return secToMin(thisPointSec - prevDepSec);
    };

    let prevDepartureSec = null;

    train.stops.forEach((stop, index) => {
        const arrStr = stop.arrival;     // 表示用はそのまま
        const depStr = stop.departure;   // 表示用はそのまま

        const arrSec = toSec(arrStr);
        const depSec = toSec(depStr);

        // 通過判定：着が空白/…/|| なら「通過扱い」
        const isPass = isEmptyLike(arrStr);

        // 駅間運転時分用の「この駅の基準時刻」
        const thisPointSec = arrSec !== null ? arrSec : depSec;

        // 2駅目以降なら、先に「駅間行」を挿入してから駅行を入れる
        if (index > 0) {
            const runTime = calcRunTime(prevDepartureSec, thisPointSec);
            const between = document.createElement("tr");
            between.className = "between";
            between.innerHTML = `
                <td>${runTime}</td>
                <td colspan="4">駅間</td>
            `;
            tbody.appendChild(between);
        }

        const tr = document.createElement("tr");
        if (isPass) tr.classList.add("pass");

        tr.innerHTML = `
            <td></td>
            <td class="station">${stop.station}</td>
            <td>${isEmptyLike(arrStr) ? "" : arrStr}</td>
            <td>${isEmptyLike(depStr) ? "" : depStr}</td>
            <td class="track">${stop.trackN || ""}</td>
        `;
        tbody.appendChild(tr);

        // 次の駅のために「前駅の発時刻」を更新
        if (depSec !== null) {
            prevDepartureSec = depSec;
        } else if (arrSec !== null && prevDepartureSec === null) {
            // もし発がなくて最初の駅などの場合の保険
            prevDepartureSec = arrSec;
        }
    });
});
