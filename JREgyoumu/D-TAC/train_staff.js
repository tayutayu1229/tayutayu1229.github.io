/**
 * 列車運転時刻表 (スタフ) 制御スクリプト
 */

const JSON_PATH = '../../T-time/timetables.json';
const params    = new URLSearchParams(window.location.search);
const targetId  = params.get('id');
const customDate = params.get('date');

window.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('render-target');
    if (!container) { console.error("'render-target' が見つかりません。"); return; }
    if (!targetId)  { container.innerHTML = "IDが指定されていません。"; return; }

    try {
        const response = await fetch(JSON_PATH);
        if (!response.ok) throw new Error("JSONの取得に失敗しました");
        const allData = await response.json();

        const group = allData.filter(item => {
            const dateStr = item.startDate || item.dayType || "";
            const p = dateStr.split(/[\/\-]/);
            const dateKey = p.length >= 3
                ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`
                : dateStr;
            return `${dateKey}_${item.trainNumber}` === targetId;
        });

        if (group.length > 0) {
            const mergedTrain = mergeTrainSegments(group);
            renderStaff(mergedTrain, group[0]);
        } else {
            container.innerHTML = "該当データがありません ID:" + targetId;
        }
    } catch (e) {
        console.error(e);
        container.innerHTML = "読み込みエラーが発生しました。";
    }
});

// ── セグメントをマージ ──────────────────────────
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
                if ((!existing.arrival   || existing.arrival.trim()   === "") && stop.arrival)   existing.arrival   = stop.arrival;
                if ((!existing.departure || existing.departure.trim() === "") && stop.departure) existing.departure = stop.departure;
                if (!existing.trackN && stop.trackN) existing.trackN = stop.trackN;
            }
        });
    });

    base.stops = mergedStops;
    return base;
}

// ── 時刻フォーマット（hh.mm + 秒上付き、秒00は非表示）──
function formatTime(t, isPassing) {
    if (!t || t.trim() === "" || t === " ") return "";

    if (t === "||" || t === "…") {
        return '<span class="pass-arrow">↓</span>';
    }
    if (t === "=" || t === "＝") {
        return '<span class="stop-symbol">＝＝</span>';
    }

    const p = t.split(':');
    if (p.length < 2) return `<span class="time-main">${t}</span>`;

    const hhmm = `${p[0]}.${p[1]}`;
    const rawSec = p[2] ? p[2].replace(/^0/, '') : '';
    const secStr = (rawSec && rawSec !== '0' && rawSec !== '00')
        ? `<span class="time-sec">${rawSec}</span>` : '';

    const cls = isPassing ? ' class="time-passing"' : '';
    return `<span${cls ? '' : ''}><span class="time-main">${hhmm}</span>${secStr}</span>`;
}

// ── 運転時分の計算 ──────────────────────────────
function calcJifun(depTime, arrTime) {
    if (!depTime || !arrTime) return '';
    if (depTime === '||' || depTime === '…' || arrTime === '||' || arrTime === '…') return '';

    const toSec = s => {
        const p = s.split(':');
        return parseInt(p[0] || 0) * 3600 + parseInt(p[1] || 0) * 60 + parseInt(p[2] || 0);
    };

    const diff = toSec(arrTime) - toSec(depTime);
    if (diff <= 0) return '';

    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    const secStr = secs > 0
        ? `<span class="jifun-sec">${String(secs).padStart(2, '0')}</span>` : '';

    return `<span class="jifun-main">${mins}</span>${secStr}`;
}

// ── 今日の日付（作成日用）──────────────────────
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日作成`;
}

// ── レンダリング ────────────────────────────────
function renderStaff(train, firstSegment) {
    const target = document.getElementById('render-target');
    if (!target) return;

    const stopCount   = train.stops.length;
    const rowHeight   = stopCount > 25 ? '22px' : stopCount > 15 ? '28px' : '34px';
    const stFontSize  = stopCount > 25 ? '13px' : stopCount > 15 ? '15px' : '16px';

    // ヘッダー情報
    const noNum    = firstSegment.kid1 || '1';
    const lineName = train.line  || '';
    const depot    = '田町運転区'; // 運転所（必要に応じてデータから取得）
    const dateDisp = customDate || '';

    // 速度情報（改行で複数行対応）
    const speedVal  = (train.speed  || '').replace(/[,、]/g, '\n');
    const powerVal  = train.power || '';
    const speedType = train.speedType || '';

    // 車両情報
    const carCount = train.carCount || '';
    const carLabel = carCount ? `${carCount}<span>両</span>` : '';
    const subLabel = train.carLabel || '（乗継）';

    // ── HTML構築 ──
    let html = `
        <div class="staff-header">
            <div class="hd-no">NO.&thinsp;${noNum}</div>
            <div class="hd-right">
                ${lineName ? `${lineName}行路` : ''}<br>
                ${depot}
            </div>
        </div>
        <div class="hd-date">施行日&emsp;${dateDisp}</div>

        <table class="info-table">
            <colgroup>
                <col class="col-train">
                <col class="col-speed">
                <col class="col-speedt">
                <col class="col-power">
            </colgroup>
            <tr>
                <td style="text-align:center; letter-spacing:.2em;">列　　車</td>
                <td>最高速度<br>(Km/h)</td>
                <td>速度種別</td>
                <td>けん引定数</td>
            </tr>
            <tr>
                <td class="train-num-cell">${train.trainNumber || '―'}</td>
                <td><div class="speed-val">${speedVal}</div></td>
                <td style="font-size:9px;">${speedType}</td>
                <td style="font-size:9px; line-height:1.3;">${powerVal}</td>
            </tr>
        </table>

        <table class="main-timetable">
            <colgroup>
                <col class="col-jifun">
                <col class="col-station">
                <col class="col-arr">
                <col class="col-dep">
                <col class="col-line">
                <col class="col-limit">
                <col class="col-memo">
            </colgroup>
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
                    <td class="car-num-cell" colspan="2">${carLabel}</td>
                    <td class="syosho-cell" colspan="5">${subLabel}</td>
                </tr>
    `;

    train.stops.forEach((stop, i) => {
        const isPassing = (
            stop.arrival   === "||" || stop.arrival   === "…" ||
            stop.departure === "||" || stop.departure === "…"
        );
        const stClass = isPassing ? 'st-name-text st-passing' : 'st-name-text';

        // 運転時分：前のstopの発車 → 今のstopの着
        let jifunHtml = '';
        if (i > 0) {
            const prevDep = train.stops[i - 1].departure;
            const curArr  = stop.arrival;
            jifunHtml = calcJifun(prevDep, curArr);
        }

        const arrHtml = formatTime(stop.arrival,   isPassing);
        const depHtml = formatTime(stop.departure, isPassing);

        // 着・発セルに通過クラスを付与
        const arrTdClass = isPassing ? ' class="time-passing"' : '';
        const depTdClass = isPassing ? ' class="time-passing"' : '';

        html += `
            <tr style="height:${rowHeight};">
                <td>${jifunHtml}</td>
                <td class="${stClass}" style="font-size:${stFontSize};">${stop.station}</td>
                <td${arrTdClass}>${arrHtml}</td>
                <td${depTdClass}>${depHtml}</td>
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

    target.innerHTML = html;
}
