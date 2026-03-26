/**
 * 列車運転時刻表 (スタフ) 制御スクリプト - 画像12・13完全再現版
 */

const JSON_PATH = '../../T-time/timetables.json';
const params    = new URLSearchParams(window.location.search);
const targetId  = params.get('id');
const customDate = params.get('date');

window.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('render-target');
    if (!container) return;
    if (!targetId)  { container.innerHTML = "IDが指定されていません。"; return; }

    try {
        const response = await fetch(JSON_PATH);
        if (!response.ok) throw new Error("JSON取得失敗");
        const allData = await response.json();

        const group = allData.filter(item => {
            const dateStr = item.startDate || item.dayType || "";
            const p = dateStr.split(/[\/\-]/);
            const dateKey = p.length >= 3 ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}` : dateStr;
            return `${dateKey}_${item.trainNumber}` === targetId;
        });

        if (group.length > 0) {
            const mergedTrain = mergeTrainSegments(group);
            renderStaff(mergedTrain, group[0]);
        } else {
            container.innerHTML = "該当データがありません";
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = "読み込みエラー";
    }
});

function mergeTrainSegments(segments) {
    const base = { ...segments[0] };
    const mergedStops = [];
    const seenStations = new Set();
    segments.forEach(seg => {
        seg.stops.forEach(stop => {
            if (!seenStations.has(stop.station)) {
                mergedStops.push({ ...stop });
                seenStations.add(stop.station);
            } else {
                const existing = mergedStops.find(s => s.station === stop.station);
                if ((!existing.arrival || existing.arrival.trim() === "") && stop.arrival) existing.arrival = stop.arrival;
                if ((!existing.departure || existing.departure.trim() === "") && stop.departure) existing.departure = stop.departure;
                if (!existing.trackN && stop.trackN) existing.trackN = stop.trackN;
            }
        });
    });
    base.stops = mergedStops;
    return base;
}

// ── 時刻フォーマット（画像12の 55 30 などの再現） ──
function formatTime(t, isPassing) {
    if (!t || t.trim() === "" || t === " ") return "";
    if (t === "||" || t === "↓" || t === "…") return '<div class="pass-arrow">↓</div>';
    if (t === "=" || t === "＝" || t === "==") return '<div class="end-mark">＝＝</div>';

    const p = t.split(':');
    const hhmm = `${p[0]}.${p[1]}`;
    const rawSec = p[2] ? p[2].replace(/^0/, '') : '';
    
    const secStr = (rawSec && rawSec !== '0' && rawSec !== '00') 
        ? `<span class="time-sec">${rawSec}</span>` : '';

    return `
        <div class="time-container ${isPassing ? 'st-passing' : ''}">
            <span class="time-main">${hhmm}</span>${secStr}
        </div>`;
}

// ── 運転時分（肩に秒を乗せる） ──
function formatJifun(val) {
    if (!val) return "";
    // 秒単位の数値で来る場合と文字列で来る場合の両方に対応
    let min, sec;
    if (typeof val === 'number') {
        min = Math.floor(val / 60);
        sec = val % 60;
    } else {
        const p = String(val).split(':');
        min = p[0];
        sec = p[1] ? p[1].replace(/^0/, '') : '';
    }
    const secStr = (sec && sec != 0) ? `<span class="jifun-sec">${sec}</span>` : '';
    return `<span class="jifun-main">${min}</span>${secStr}`;
}

function renderStaff(train, firstSegment) {
    const target = document.getElementById('render-target');
    if (!target) return;
    target.innerHTML = createStaffInner(train, firstSegment);
}

function createStaffInner(train, firstSegment) {
    const stopCount = train.stops.length;
    // 駅数に応じて行の高さを自動調整
    const rowHeight = stopCount > 15 ? '48px' : '55px';

    let html = `
        <div class="header-flex">
            <div class="no-label">NO. ${firstSegment.kid1 || '1'}</div>
            <div class="depot-info">${train.line || ''}行路<br>新前橋運輸区</div>
        </div>
        <div class="execution-date">施行日　${customDate || train.startDate || '2026/03/19'}</div>

        <table class="info-table">
            <colgroup><col style="width:38%;"><col style="width:18%;"><col style="width:22%;"><col style="width:22%;"></colgroup>
            <tr style="height:35px;"><td>列　　車</td><td>最高速度<br>(Km/h)</td><td>速度種別</td><td>けん引定数</td></tr>
            <tr>
                <td class="train-num-value">${train.trainNumber || ''}</td>
                <td style="font-size:18px;">${train.speed || ''}</td>
                <td style="font-size:22px;">${train.speedType || ''}</td>
                <td style="font-size:18px;">${(train.power || '').replace(/\n/g, '<br>')}</td>
            </tr>
        </table>

        <table class="main-table">
            <colgroup>
                <col style="width:10%;"><col style="width:30%;"><col style="width:20%;"><col style="width:20%;"><col style="width:8%;"><col style="width:6%;"><col style="width:6%;">
            </colgroup>
            <thead>
                <tr><th>運転<br>時分</th><th>停車場名</th><th>着</th><th>発(通)</th><th>着発<br>線</th><th>制限<br>速度</th><th>記事</th></tr>
            </thead>
            <tbody>
                <tr style="height:40px;">
                    <td colspan="2" style="text-align:center; font-size:28px; font-weight:900;">
                        ${train.carCount || ''}<span style="font-size:16px; margin-left:2px;">両</span>
                    </td>
                    <td colspan="5" style="padding-left:20px; font-size:22px; font-weight:900; color:red;">${train.carLabel || ''}</td>
                </tr>
    `;

    train.stops.forEach((stop, i) => {
        // 通過判定（着が矢印、または着空欄かつ途中駅）
        const isPassing = (stop.arrival === "||" || stop.arrival === "↓" || (stop.arrival === "" && stop.departure !== "" && i !== 0 && i !== train.stops.length - 1));
        
        html += `
            <tr style="height: ${rowHeight};">
                <td class="jifun-cell">${formatJifun(stop.timeDiff)}</td>
                <td><div class="station-name ${isPassing ? 'st-passing' : ''}">${stop.station}</div></td>
                <td>${formatTime(stop.arrival, isPassing)}</td>
                <td>${formatTime(stop.departure, isPassing)}</td>
                <td class="track-cell">${stop.trackN || ''}</td>
                <td></td>
                <td style="font-size:12px; font-weight:900; vertical-align:top; padding:2px;">${stop.memo || ''}</td>
            </tr>
        `;
    });

    const d = new Date();
    const today = `${d.getFullYear()}年 ${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes()}分作成`;

    html += `
            </tbody>
        </table>

        <div class="notes-area">
            <div class="notes-title">注意事項</div>
            <div class="notes-content">${(train.notes || '').replace(/\n/g, '<br>')}</div>
        </div>
        <div class="footer-time">${today}</div>
    `;
    return html;
}
