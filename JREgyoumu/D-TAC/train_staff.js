/**
 * 列車運転時刻表 (スタフ) 制御スクリプト - A3/2列/自動計算対応版
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
            // A3タテ2列を想定し、同じデータを2列出力（または別列車を表示可能）
            renderStaff(mergedTrain, group[0]);
        } else {
            container.innerHTML = "該当データがありません";
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = "読み込みエラー";
    }
});

// ── セグメントマージ (変更なし) ──
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

// ── 時刻計算用ユーティリティ ──
function timeToSeconds(t) {
    if (!t || t.trim() === "" || t === " " || t === "||" || t === "…" || t === "=") return null;
    const p = t.split(':');
    return parseInt(p[0] || 0) * 3600 + parseInt(p[1] || 0) * 60 + parseInt(p[2] || 0);
}

// ── 時刻フォーマット (左寄せ・秒を下付き・秒00非表示) ──
function formatTime(t, isPassing) {
    if (!t || t.trim() === "" || t === " ") return "";
    if (t === "||" || t === "…") return '<span class="pass-arrow">↓</span>';
    if (t === "=" || t === "＝") return '<span class="stop-symbol">＝＝</span>';

    const p = t.split(':');
    const hhmm = `${p[0]}.${p[1]}`;
    const rawSec = p[2] ? p[2].replace(/^0/, '') : '';
    const secStr = (rawSec && rawSec !== '0' && rawSec !== '00') 
        ? `<span class="time-sec">${rawSec}</span>` : '';

    return `
        <div class="time-container ${isPassing ? 'time-passing' : ''}">
            <span class="time-main">${hhmm}</span>${secStr}
        </div>`;
}

// ── 運転時分の表示用フォーマット ──
function formatJifun(diff) {
    if (diff <= 0) return '';
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    const secStr = secs > 0 ? `<span class="jifun-sec">${secs}</span>` : '';
    return `<span class="jifun-main">${mins}</span>${secStr}`;
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${d.getMinutes()}分作成`;
}

// ── レンダリング ──
function renderStaff(train, firstSegment) {
    const target = document.getElementById('render-target');
    if (!target) return;

    // A3タテの中に「同じものを2列」表示する構成
    let fullHtml = `<div class="staff-column">${createStaffInner(train, firstSegment)}</div>`;
    fullHtml += `<div class="staff-column">${createStaffInner(train, firstSegment)}</div>`;
    
    target.innerHTML = fullHtml;
}

// スタフの内側を生成する関数
function createStaffInner(train, firstSegment) {
    const stopCount = train.stops.length;
    // A3に合わせて行の高さを調整
    const rowHeight = stopCount > 25 ? '32px' : '40px'; 
    const stFontSize = '14px'; // 駅名は少し小さく

    let lastTimedSeconds = null;

    let html = `
        <div class="staff-header">
            <div class="hd-no">NO.&thinsp;${firstSegment.kid1 || '1'}</div>
            <div class="hd-right">${train.line || ''}行路<br>田町運転所</div>
        </div>
        <div class="hd-date">施行日&emsp;${customDate || ''}</div>

        <table class="info-table">
            <colgroup><col class="col-train"><col class="col-speed"><col class="col-speedt"><col class="col-power"></colgroup>
            <tr><td>列　　車</td><td>最高速度</td><td>速度種別</td><td>けん引定数</td></tr>
            <tr>
                <td class="train-num-cell">${train.trainNumber || '―'}</td>
                <td><div class="speed-val">${(train.speed || '').replace(/[,、]/g, '\n')}</div></td>
                <td style="font-size:10px;">${train.speedType || ''}</td>
                <td style="font-size:10px;">${train.power || ''}</td>
            </tr>
        </table>

        <table class="main-timetable">
            <colgroup>
                <col class="col-jifun"><col class="col-station"><col class="col-arr">
                <col class="col-dep"><col class="col-line"><col class="col-limit"><col class="col-memo">
            </colgroup>
            <thead>
                <tr><th>運転<br>時分</th><th>停車場名</th><th>着</th><th>発(通)</th><th>着発<br>線</th><th>制限</th><th>記事</th></tr>
            </thead>
            <tbody>
                <tr class="car-num-row">
                    <td class="car-num-cell" colspan="2">${train.carCount || ''}<span>両</span></td>
                    <td class="syosho-cell" colspan="5">${train.carLabel || '（乗継）'}</td>
                </tr>
    `;

    train.stops.forEach((stop, i) => {
        const isPassing = (stop.arrival === "||" || stop.arrival === "…" || stop.departure === "||" || stop.departure === "…");
        
        // --- 運転時分の自動累計計算 ---
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
            <tr style="height:${rowHeight};">
                <td class="jifun-cell">${jifunHtml}</td>
                <td class="${isPassing ? 'st-name-text st-passing' : 'st-name-text'}" style="font-size:${stFontSize};">${stop.station}</td>
                <td>${arrHtml}</td>
                <td>${depHtml}</td>
                <td class="track-num">${stop.trackN || ''}</td>
                <td></td>
                <td></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <div class="notes-area">
            <div class="notes-label">注意事項</div>
            <div class="notes-text">${train.notes || ''}</div>
        </div>
        <div class="staff-footer">${todayStr()}</div>
    `;
    return html;
}
