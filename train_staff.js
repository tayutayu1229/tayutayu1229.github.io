/**
 * 列車運転時刻表 (スタフ) 制御スクリプト
 */

const JSON_PATH = '/T-time/timetables.json'; // 環境に合わせて変更してください
const params = new URLSearchParams(window.location.search);
const targetId = params.get('id');
const customDate = params.get('date');

window.addEventListener('DOMContentLoaded', async () => {
    if (!targetId) return;
    try {
        const response = await fetch(JSON_PATH);
        const allData = await response.json();
        
        // 1. 同一列番・同一施行日の全データを抽出
        const group = allData.filter(item => {
            const p = (item.startDate || item.dayType || "").split(/[\/\-]/);
            const dateStr = p.length >= 3 ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}` : item.dayType;
            return `${dateStr}_${item.trainNumber}` === targetId;
        });

        if (group.length > 0) {
            // 2. 駅の重複を排除してマージ
            const mergedTrain = mergeTrainSegments(group);
            renderStaff(mergedTrain);
        }
    } catch (e) { console.error(e); }
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
                // 重複駅（接続駅）の場合、空いている時刻や番線があれば補完
                const existing = mergedStops.find(s => s.station === stop.station);
                if ((!existing.departure || existing.departure === " ") && stop.departure) {
                    existing.departure = stop.departure;
                }
                if (!existing.trackN && stop.trackN) existing.trackN = stop.trackN;
            }
        });
    });
    base.stops = mergedStops;
    return base;
}

function formatStaffTime(t) {
    if (!t || t.trim() === "") return ""; // 空欄は空欄のまま表示
    if (t === "||" || t === "…") return '<span class="pass-arrow">↓</span>';
    if (t === "=" || t === "＝") return '<span class="stop-symbol">＝＝</span>';
    
    const p = t.split(':');
    if (p.length < 2) return `<span class="time-main">${t}</span>`;
    
    const hhmm = `${p[0]}.${p[1]}`;
    const ss = p[2] ? `<span class="time-sec">${p[2]}</span>` : '';
    
    return `<span class="time-main">${hhmm}</span>${ss}`;
}

function renderStaff(train) {
    const target = document.getElementById('render-target');
    const stopCount = train.stops.length;
    
    // 駅数に応じた可変サイズ設定 (画像 の密度感を再現)
    const rowHeight = stopCount > 25 ? '24px' : (stopCount > 15 ? '32px' : '40px');
    const stationFontSize = stopCount > 25 ? '14px' : '18px';

    let html = `
        <div class="staff-header">
            <div>NO. ${train.kid1 || "1"}</div>
            <div class="header-center">
                <div class="shoko-name">田町運転区</div>
            </div>
            <div>施行日 ${customDate || ""}</div>
        </div>

        <table class="info-table">
            <tr>
                <td colspan="4">列　　車</td>
                <td style="width: 15%;">最高速度<br>(Km/h)</td>
                <td style="width: 25%;">速度種別</td>
                <td style="width: 18%;">けん引定数</td>
            </tr>
            <tr>
                <td colspan="4" class="train-num-box">${train.trainNumber}</td>
                <td></td> <td style="font-size: 12px;">${train.speed || ""}</td> <td style="font-size: 9px; line-height: 1.1;">${train.power || ""}<br>${train.ns === 'A' ? '10M5T' : ''}</td>
            </tr>
        </table>

        <table class="main-timetable">
            <thead>
                <tr>
                    <th class="col-jifun">運転<br>時分</th>
                    <th class="col-station">停車場名</th>
                    <th class="col-arr">着</th>
                    <th class="col-dep">発(通)</th>
                    <th class="col-line">着発<br>線</th>
                    <th class="col-limit">制限<br>速度</th>
                    <th class="col-memo">記事</th>
                </tr>
            </thead>
            <tbody>
                <tr class="car-num-row">
                    <td class="car-num" colspan="2" style="font-size:24px; font-weight:700;">15<span style="font-size:12px">両</span></td>
                    <td colspan="5" class="syosho-text">車 掌 省 略</td>
                </tr>
    `;

    train.stops.forEach((stop) => {
        // 操車場や貨物駅などを赤文字にする判定
        const isRed = /操|タ|貨物/.test(stop.station);
        const stClass = isRed ? 'st-name-text st-red' : 'st-name-text';

        html += `
            <tr style="height: ${rowHeight};">
                <td></td>
                <td class="${stClass}" style="font-size: ${stationFontSize};">${stop.station}</td>
                <td>${formatStaffTime(stop.arrival)}</td>
                <td>${formatStaffTime(stop.departure)}</td>
                <td class="track-num">${stop.trackN || ""}</td>
                <td></td>
                <td></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <div class="staff-footer">
            <div>${new Date().toLocaleDateString('ja-JP')} 作成</div>
            <div style="font-weight: bold;">(入区)</div>
        </div>
    `;

    target.innerHTML = html;
}
