/**
 * 列車運転時刻表 (スタフ) 制御スクリプト - リアル再現版
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

// ── 時刻フォーマット (秒の重なり防止) ──
function formatTime(t, isPassing) {
    if (!t || t.trim() === "" || t === " ") return "";
    if (t === "||" || t === "…") return '<span class="pass-arrow">↓</span>';
    
    // 終着駅の巨大な「＝」
    if (t === "=" || t === "＝" || t === "==") {
        return '<div class="end-mark">＝</div>';
    }

    const p = t.split(':');
    const hhmm = `${p[0]}.${p[1]}`;
    const rawSec = p[2] ? p[2].replace(/^0/, '') : '';
    
    // 秒がある場合、重なりを防ぐために time-sec クラスを使用
    const secStr = (rawSec && rawSec !== '0' && rawSec !== '00') 
        ? `<span class="time-sec">${rawSec}</span>` : '';

    return `
        <div class="time-container ${isPassing ? 'time-passing' : ''}">
            <span class="time-main">${hhmm}</span>${secStr}
        </div>`;
}

// ── 運転時分の表示 ──
function formatJifun(diff) {
    if (diff <= 0) return '';
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    const secStr = secs > 0 ? `<span class="jifun-sec">${secs}</span>` : '';
    return `<span class="jifun-main">${mins}</span>${secStr}`;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}年 ${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes()}分作成`;
}

// ── レンダリング ──
function renderStaff(train, firstSegment) {
    const target = document.getElementById('render-target');
    if (!target) return;

    let fullHtml = `<div class="staff-column">${createStaffInner(train, firstSegment)}</div>`;
    // 右側が必要な場合は追加。不要なら空のdiv等
    target.innerHTML = fullHtml;
}

function createStaffInner(train, firstSegment) {
    const stopCount = train.stops.length;
    const rowHeight = stopCount > 25 ? '28px' : (stopCount > 15 ? '34px' : '44px'); 

    let lastTimedSeconds = null;

    let html = `
        <div class="staff-header">
            <div class="hd-no">NO.&thinsp;${firstSegment.kid1 || '1'}</div>
            <div class="hd-right">${train.line || '川越貨物行路'}行路<br>田町運転所</div>
        </div>
        <div class="staff-header" style="justify-content: flex-start; gap: 20px;">
            <div style="font-size:16px;">施行日&emsp;${customDate || '2026/03/19'}</div>
        </div>

        <table class="info-table">
            <colgroup>
                <col class="col-train-no">
                <col class="col-speed">
                <col class="col-type">
                <col>
            </colgroup>
            <tr><td>列　　車</td><td>最高速度<br>(Km/h)</td><td>速度種別</td><td>けん引定数</td></tr>
            <tr>
                <td class="train-num-cell">
                    <div class="train-num-text">${train.trainNumber || '―'}</div>
                </td>
                <td><div class="info-sub-text">${(train.speed || '').replace(/[,、]/g, '<br>')}</div></td>
                <td><div class="info-sub-text">${train.speedType || ''}</div></td>
                <td><div class="info-sub-text">${train.power || ''}</div></td>
            </tr>
        </table>

        <table class="main-timetable">
            <colgroup>
                <col class="col-jifun"><col class="col-station"><col class="col-arr">
                <col class="col-dep"><col class="col-line"><col class="col-limit">
            </colgroup>
            <thead>
                <tr><th>運転<br>時分</th><th>停車場名</th><th>着</th><th>発(通)</th><th>着発<br>線</th><th>制限</th></tr>
            </thead>
            <tbody>
                <tr style="height:28px;">
                    <td colspan="2" style="font-size:18px; font-weight:900; text-align:center;">
                        ${train.carCount || ''}<span style="font-size:12px;">両</span>
                    </td>
                    <td colspan="4" style="text-align:left; padding-left:20px; font-weight:900; font-size:20px;">
                        ${train.carLabel || '（乗継）'}
                    </td>
                </tr>
    `;

    train.stops.forEach((stop, i) => {
        const isPassing = (stop.arrival === "||" || stop.arrival === "…" || (stop.arrival === "" && stop.departure !== "" && i !== 0 && i !== train.stops.length -1));
        
        // 運転時分の計算
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
        const nameClass = isPassing ? 'st-name-text st-passing' : 'st-name-text';

        html += `
            <tr style="height:${rowHeight};">
                <td class="jifun-cell">${jifunHtml}</td>
                <td class="col-station">
                    <div class="${nameClass}">${stop.station}</div>
                </td>
                <td>${arrHtml}</td>
                <td>${depHtml}</td>
                <td class="track-num">${stop.trackN || ''}</td>
                <td></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <div class="notes-area">
            <div style="font-size:11px; font-weight:900; border-bottom:1px solid #000; margin-bottom:4px;">注意事項</div>
            <div class="notes-text">${train.notes || ''}</div>
        </div>
        <div class="staff-footer">${todayStr()}</div>
    `;
    return html;
}
