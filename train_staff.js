const JSON_PATH = '/T-time/timetables.json';
const params = new URLSearchParams(window.location.search);
const targetId = params.get('id');
const customDate = params.get('date');

window.addEventListener('DOMContentLoaded', async () => {
    if (!targetId) return;
    try {
        const response = await fetch(JSON_PATH);
        const data = await response.json();
        const train = data.find(item => {
            const p = (item.startDate || item.dayType || "").split(/[\/\-]/);
            const dateStr = p.length >= 3 ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}` : item.dayType;
            return `${dateStr}_${item.trainNumber}` === targetId;
        });

        if (train) renderStaff(train);
    } catch (e) { console.error(e); }
});

function renderStaff(train) {
    const container = document.getElementById('staff-content');
    
    let html = `
        <div class="header-info">
            <div>施行日：${customDate || ""}</div>
            <div>田町運転区</div>
        </div>
        <table class="staff-table">
            <tr>
                <td colspan="4">列車</td>
                <td colspan="2">最高速度</td>
                <td colspan="2">速度種別</td>
            </tr>
            <tr>
                <td colspan="4" class="train-num-large">${train.trainNumber}</td>
                <td colspan="2">${train.speed || ""}</td>
                <td colspan="2">通電A21p</td>
            </tr>
            <tr style="color:red; font-size:14px;">
                <td colspan="8">車 掌 省 略</td>
            </tr>
            <tr>
                <th style="width:15%">運転時分</th>
                <th style="width:25%">停車場名</th>
                <th style="width:20%">着</th>
                <th style="width:20%">発(通)</th>
                <th style="width:10%">着発線</th>
                <th style="width:10%">記事</th>
            </tr>
    `;

    train.stops.forEach(stop => {
        const arr = formatTime(stop.arrival);
        const dep = formatTime(stop.departure);
        const isPass = (stop.arrival === "||" || !stop.arrival);

        html += `
            <tr>
                <td></td>
                <td>${stop.station}</td>
                <td style="${arr === '↓' ? 'color:red;' : ''}">${arr}</td>
                <td style="${dep.includes('↓') ? 'color:red;' : ''}">${dep}</td>
                <td>${stop.trackN || ""}</td>
                <td></td>
            </tr>
        `;
    });

    html += `</table>`;
    container.innerHTML = html;
}

function formatTime(t) {
    if (!t || t === "||") return "↓";
    if (t === "=" || t === "＝") return "＝";
    const p = t.split(':');
    if (p.length < 2) return t;
    // 秒がある場合は小さく表示
    const sec = p[2] ? `<span class="time-sec">${p[2]}</span>` : "";
    return `${p[0]}.${p[1]}${sec}`;
}