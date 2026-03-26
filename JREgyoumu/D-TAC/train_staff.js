/**
 * 列車運転時刻表 (スタフ) 制御スクリプト - JR実物再現版
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
    if (t === "||" || t === "…") return '<div class="pass-arrow">↓</div>';
    
    // 終着駅の巨大な「＝」
    if (t === "=" || t === "＝" || t === "==") {
        return '<div class="end-mark" style="font-size: 50px; letter-spacing: -8px; font-weight: 900; text-align: center;">＝＝</div>';
    }

    const p = t.split(':');
    const hhmm = `${p[0]}.${p[1]}`;
    const rawSec = p[2] ? p[2].replace(/^0/, '') : '';
    
    const secStr = (rawSec && rawSec !== '0' && rawSec !== '00') 
        ? `<span class="time-sec" style="font-size: 18px; margin-left: 2px; transform: translateY(-6px); display: inline-block;">${rawSec}</span>` : '';

    return `
        <div class="time-container ${isPassing ? 'time-passing' : ''}" style="display: flex; align-items: baseline; justify-content: flex-start; padding-left: 10px;">
            <span class="time-main" style="font-size: 38px; font-weight: 900; font-family: Arial;">${hhmm}</span>${secStr}
        </div>`;
}

// ── 運転時分 ──
function formatJifun(diff) {
    if (diff <= 0) return '';
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    const secStr = secs > 0 ? `<span style="font-size: 14px; transform: translateY(-8px); display: inline-block;">${secs}</span>` : '';
    return `<span style="font-size: 26px; font-weight: 900;">${mins}</span>${secStr}`;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}年 ${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes()}分作成`;
}

// ── レンダリング ──
function renderStaff(train, firstSegment) {
    const target = document.getElementById('render-target');
    if (!target) return;
    // 左側のみ、幅100%
    target.innerHTML = `<div class="staff-column" style="width: 100%; border-right: none;">${createStaffInner(train, firstSegment)}</div>`;
}

function createStaffInner(train, firstSegment) {
    const stopCount = train.stops.length;
    // 駅数に応じて高さを調整するが、基本はパツパツに
    const rowHeight = stopCount > 22 ? '42px' : '55px'; 

    let lastTimedSeconds = null;

    let html = `
        <div class="staff-header" style="display: flex; justify-content: space-between; align-items: flex-end; font-weight: 900; border-bottom: 2px solid #000; padding-bottom: 2px; margin-bottom: 5px;">
            <div style="font-size: 28px;">NO.&thinsp;${firstSegment.kid1 || '1'}</div>
            <div style="text-align: right; font-size: 18px; line-height: 1.1;">
                ${train.line || '川越貨物'}行路<br>田町運転所
            </div>
        </div>
        <div style="font-size: 22px; font-weight: 900; margin-bottom: 8px;">施行日&emsp;${customDate || '2026/03/19'}</div>

        <table style="width: 100%; border-collapse: collapse; border: 3.5px solid #000; table-layout: fixed; margin-bottom: 0;">
            <colgroup><col style="width: 45%;"><col style="width: 18%;"><col style="width: 18%;"><col style="width: 19%;"></colgroup>
            <tr style="height: 35px; font-size: 14px; font-weight: 900; text-align: center;">
                <td style="border: 1px solid #000;">列　　車</td>
                <td style="border: 1px solid #000;">最高速度</td>
                <td style="border: 1px solid #000;">速度種別</td>
                <td style="border: 1px solid #000;">けん引定数</td>
            </tr>
            <tr style="height: 115px; text-align: center;">
                <td style="border: 1px solid #000; text-align: left; padding-left: 10px;">
                    <div style="font-size: 88px; font-weight: 900; font-family: 'Arial Black'; letter-spacing: -4px;">${train.trainNumber || ''}</div>
                </td>
                <td style="border: 1px solid #000; font-size: 18px; font-weight: 900;">${(train.speed || '').replace(/[,、]/g, '<br>')}</td>
                <td style="border: 1px solid #000; font-size: 18px; font-weight: 900;">${train.speedType || ''}</td>
                <td style="border: 1px solid #000; font-size: 18px; font-weight: 900;">${train.power || ''}</td>
            </tr>
        </table>

        <table style="width: 100%; border-collapse: collapse; border: 3.5px solid #000; border-top: none; table-layout: fixed;">
            <colgroup>
                <col style="width: 12%;"><col style="width: 32%;"><col style="width: 20%;"><col style="width: 20%;"><col style="width: 8%;"><col style="width: 8%;">
            </colgroup>
            <thead>
                <tr style="height: 40px; border-bottom: 2px solid #000; font-size: 14px; font-weight: 900;">
                    <th style="border-right: 1px solid #000;">運転<br>時分</th>
                    <th style="border-right: 1px solid #000;">停車場名</th>
                    <th style="border-right: 1px solid #000;">着</th>
                    <th style="border-right: 1px solid #000;">発(通)</th>
                    <th style="border-right: 1px solid #000;">着発<br>線</th>
                    <th>制限</th>
                </tr>
            </thead>
            <tbody>
                <tr style="height: 48px; border-bottom: 2px solid #000; font-weight: 900;">
                    <td colspan="2" style="text-align: center; border-right: 1px solid #000; font-size: 28px;">
                        ${train.carCount || ''}<span style="font-size: 16px;">両</span>
                    </td>
                    <td colspan="4" style="padding-left: 25px; font-size: 26px;">
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
                <td style="border-right: 1px solid #000; text-align: right; padding-right: 5px;">${jifunHtml}</td>
                <td style="border-right: 1px solid #000;">
                    <div style="font-size: 24px; font-weight: 900; text-align: justify; text-align-last: justify; padding: 0 12px; ${isPassing ? 'color: red;' : ''}">
                        ${stop.station}
                    </div>
                </td>
                <td style="border-right: 1px solid #000;">${arrHtml}</td>
                <td style="border-right: 1px solid #000;">${depHtml}</td>
                <td style="border-right: 1px solid #000; text-align: center; font-size: 26px; font-weight: 900; font-style: italic; font-family: serif;">
                    ${stop.trackN || ''}
                </td>
                <td></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <div style="border: 3.5px solid #000; border-top: none; min-height: 90px; padding: 5px; box-sizing: border-box;">
            <div style="font-size: 14px; font-weight: 900; border-bottom: 1px solid #000; margin-bottom: 5px;">【注意事項】</div>
            <div style="font-size: 18px; font-weight: 900; white-space: pre-wrap;">${train.notes || ''}</div>
        </div>
        <div style="font-size: 14px; font-weight: 900; margin-top: 10px;">${todayStr()}</div>
    `;
    return html;
}
