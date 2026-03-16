document.addEventListener('DOMContentLoaded', () => {
    const trainGroup = JSON.parse(sessionStorage.getItem('selectedTrainData'));
    if (!trainGroup) return;

    const train = trainGroup[0];

    document.getElementById("trainTitle").textContent =
        `${train.tr1 || train.trainNumber}（${train.type}）`;

    document.getElementById("trainMeta").innerHTML = `
        施行日：${train.startDate}<br>
        区間：${train.origin} → ${train.destination}<br>
        種別：${train.type}　電源：${train.power}　線区：${train.line}
    `;

    const tbody = document.querySelector("#timetable tbody");
    tbody.innerHTML = "";

    const toSec = (t) => {
        if (!t || t === "…" || t === "||" || t.trim() === "") return null;
        const [h, m, s] = t.split(":").map(Number);
        return h * 3600 + m * 60 + s;
    };

    const secToMin = (sec) => {
        if (sec === null) return "";
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, "0")}`;
    };

    const calcRunTime = (prevDep, arr) => {
        if (!prevDep || !arr) return "";
        return secToMin(arr - prevDep);
    };

    let prevDepartureSec = null;

    train.stops.forEach(stop => {
        const arrSec = toSec(stop.arrival);
        const depSec = toSec(stop.departure);

        const runTime = calcRunTime(prevDepartureSec, arrSec);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="station">${stop.station}</td>
            <td class="time">${stop.arrival}</td>
            <td class="time">${stop.departure}</td>
            <td>${stop.trackN}</td>
            <td>${runTime}</td>
        `;

        tbody.appendChild(tr);

        if (depSec) prevDepartureSec = depSec;
    });
});
