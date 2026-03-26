/**
 * 列車運転時刻表 (スタフ) 制御スクリプト - JR実物完全再現版
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

// ── セグメントマージ ──
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

// ── 時刻計算用 ──
function timeToSeconds(t) {
    if (!t || t.trim() === "" || [" ", "||", "…", "=", "＝", "=="].includes(t)) return null;
    const p = t.split(':');
    return parseInt(p[0] || 0) * 3600 + parseInt(p[1] || 0) * 60 + parseInt(p[2] || 0);
}

// ── 時刻フォーマット ──
function formatTime(t, isPassing) {
    if (!t || t.trim() === "" || t === " ") return "";
    if (t === "||" || t === "…") return '<div style="color:red; font-size:45px; font-weight:900; text-align:center;">↓</div>';
    
    // 発時刻が = の場合、セルいっぱいの巨大な二重線を表示
    if (t === "=" || t === "＝" || t === "==") {
        return '<div style="font-size: 55px; letter-spacing: -10px; font-weight: 900; text-align: center; line-height: 1;">＝＝</div>';
    }

    const p = t.split(':');
    const hhmm = `${p[0]}.${p[1]}`;
    const rawSec = p[2] ? p[2].replace(/^0/, '') : '';
    
    const secStr = (rawSec && rawSec !== '0' && rawSec !== '00') 
        ? `<span style="font-size: 19px; margin-left: 3px; transform: translateY(-7px); display: inline-block;">${rawSec}</span>` : '';

    return `
        <div style="display: flex; align-items: baseline; justify-content: flex-start; padding-left: 12px; ${isPassing ? 'color: red;' : ''}">
            <span style="font-size: 40px; font-weight: 900; font-family: Arial;">${hhmm}</span>${secStr}
        </div>`;
}

// ── 運転時分 ──
function formatJifun(diff) {
    if (diff <= 0) return '';
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    const secStr = secs > 0 ? `<span style="font-size: 16px; transform: translateY(-10px); display: inline-block;">${secs}</span>` : '';
    return `<span style="font-size: 28px; font-weight: 900;">${mins}</span>${secStr}`;
}

// ── レンダリング ──
function renderStaff(train, firstSegment) {
    const target = document.getElementById('render-target');
    if (!target) return;
    // 1つだけ表示
    target.innerHTML = createStaffInner(train, firstSegment);
}

function createStaffInner(train, firstSegment) {
    const stopCount = train.stops.length;
    const rowHeight = stopCount > 20 ? '45px' : '58px'; 

    let lastTimedSeconds = null;

    let html = `
        <div style="width: 100%; box-sizing: border-box; padding: 0 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; font-weight: 900; margin-bottom: 5px;">
                <div style="font-size: 30px;">NO.&thinsp;${firstSegment.kid1 || '1'}</div>
                <div style="text-align: right; font-size: 20px; line-height: 1.2;">
                    ${train.line || ''}行路<br>田町運転所
                </div>
            </div>
            <div style="font-size: 24px; font-weight: 900; margin-bottom: 12px;">施行日&emsp;${customDate || '2026/03/19'}</div>

            <table style="width: 100%; border-collapse: collapse; border: 3px solid #000; table-layout: fixed;">
                <colgroup><col style="width: 45%;"><col style="width: 18%;"><col style="width: 18%;"><col style="width: 19%;"></colgroup>
                <tr style="height: 38px; font-size: 15px; font-weight: 900; text-align: center;">
                    <td style="border: 1px solid #000;">列　　車</td>
                    <td style="border: 1px solid #000;">最高速度</td>
                    <td style="border: 1px solid #000;">速度種別</td>
                    <td style="border: 1px solid #000;">けん引定数</td>
                </tr>
                <tr style="height: 120px; text-align: center;">
                    <td style="border: 1px solid #000; text-align: left; padding-left: 15px;">
                        <div style="font-size: 92px; font-weight: 900; font-family: 'Arial Black'; letter-spacing: -4px;">${train.trainNumber || ''}</div>
                    </td>
                    <td style="border: 1px solid #000; font-size: 19px; font-weight: 900;">${(train.speed || '').replace(/[,、]/g, '<br>')}</td>
                    <td style="border: 1px solid #000; font-size: 19px; font-weight: 900;">${train.speedType || ''}</td>
                    <td style="border: 1px solid #000; font-size: 19px; font-weight: 900;">${train.power || ''}</td>
                </tr>
            </table>

            <table style="width: 100%; border-collapse: collapse; border: 3px solid #000; border-top: none; table-layout: fixed;">
                <colgroup>
                    <col style="width: 12%;"><col style="width: 32%;"><col style="width: 20%;"><col style="width: 20%;"><col style="width: 16%;">
                </colgroup>
                <thead>
                    <tr style="height: 45px; border-bottom: 2px solid #000; font-size: 15px; font-weight: 900;">
                        <th style="border-right: 1px solid #000;">運転<br>時分</th>
                        <th style="border-right: 1px solid #000;">停車場名</th>
                        <th style="border-right: 1px solid #000;">着</th>
                        <th style="border-right: 1px solid #000;">発(通)</th>
                        <th style="border: none;">着発線 / 制限</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="height: 52px; border-bottom: 2px solid #000; font-weight: 900;">
                        <td colspan="2" style="text-align: center; border-right: 1px solid #000; font-size: 28px;">
                            ${train.carCount || ''}<span style="font-size: 16px;">両</span>
                        </td>
                        <td colspan="3" style="padding-left: 30px; font-size: 26px;">
                            ${train.carLabel || '（乗継）'}
                        </td>
                    </tr>
    `;

    train.stops.forEach((stop, i) => {
        const isPassing = (stop.arrival === "||" || stop.arrival === "…" || (stop.arrival === "" && stop.departure !== "" && i !== 0 && i !== train.stops.length -1));
        
        let currentSeconds = timeToSeconds(stop.arrival) || timeToSeconds(stop.departure);
        let jifunHtml = '';
        if (currentSeconds !== null) {
            if (lastTimedSeconds !== null) {
                jifunHtml = formatJifun(currentSeconds - lastTimedSeconds);
            }
            lastTimedSeconds = currentSeconds;
        }

        const arrHtml = formatTime(stop.arrival, isPassing);
        const depHtml = formatTime(stop.departure, isPassing);

        html += `
            <tr style="height: ${rowHeight}; border-bottom: 1px solid #000;">
                <td style="border-right: 1px solid #000; text-align: right; padding-right: 8px;">${jifunHtml}</td>
                <td style="border-right: 1px solid #000;">
                    <div style="font-size: 26px; font-weight: 900; text-align: justify; text-align-last: justify; padding: 0 15px; ${isPassing ? 'color: red;' : ''}">
                        ${stop.station}
                    </div>
                </td>
                <td style="border-right: 1px solid #000;">${arrHtml}</td>
                <td style="border-right: 1px solid #000;">${depHtml}</td>
                <td style="text-align: center; font-size: 28px; font-weight: 900; font-style: italic; font-family: serif;">
                    ${stop.trackN || ''}
                </td>
            </tr>
        `;
    });

    const d = new Date();
    const today = `${d.getFullYear()}年 ${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes()}分作成`;

    html += `
                </tbody>
            </table>
            <div style="border: 3px solid #000; border-top: none; min-height: 100px; padding: 10px; box-sizing: border-box;">
                <div style="font-size: 15px; font-weight: 900; border-bottom: 1px solid #000; margin-bottom: 8px;">【注意事項】</div>
                <div style="font-size: 20px; font-weight: 900; white-space: pre-wrap;">${train.notes || ''}</div>
            </div>
            <div style="font-size: 15px; font-weight: 900; margin-top: 15px;">${today}</div>
        </div>
    `;
    return html;
}
