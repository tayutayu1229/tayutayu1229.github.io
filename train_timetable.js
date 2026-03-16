document.addEventListener('DOMContentLoaded', () => {
    const trainGroup = JSON.parse(sessionStorage.getItem('selectedTrainData'));
    if (!trainGroup) return;

    const train = trainGroup[0];

    document.getElementById("trainTitle").textContent =
        `${train.tr1 || train.trainNumber}`;

    document.getElementById("trainMeta").innerHTML = `
        施行日：${train.startDate}<br>
        区間：${train.origin} → ${train.destination}<br>
        種別：${train.type}
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

    train.stops.forEach((stop, i) => {
        const arrSec = toSec(stop.arrival);
        const depSec = toSec(stop.departure);

        const isPass = (!arrSec && !depSec);

        const tr = document.createElement("tr");
        if (isPass) tr.classList.add("pass");

        tr.innerHTML = `
            <td class="station">${stop.station}</td>
            <td>${isPass ? "––" : stop.arrival}</td>
            <td>${isPass ? "––" : stop.departure}</td>
            <td class="track">${stop.trackN || ""}</td>
        `;
        tbody.appendChild(tr);

        if (i > 0) {
            const runTime = calcRunTime(prevDepartureSec, arrSec);

            const between = document.createElement("tr");
            between.className = "between";
            between.innerHTML = `
                <td colspan="4">駅間：${runTime}</td>
            `;
            tbody.appendChild(between);
        }

        if (depSec) prevDepartureSec = depSec;
    });
});
