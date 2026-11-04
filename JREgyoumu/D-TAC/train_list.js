document.addEventListener('DOMContentLoaded', () => {
    const listBody = document.querySelector('#timetable-list tbody');
    const searchDateInput = document.getElementById('search-date');
    const searchNumberInput = document.getElementById('search-number');
    const searchButton = document.getElementById('search-button');
    const resetButton = document.getElementById('reset-button');
    const executionDateInput = document.getElementById('execution-date');

    // 操作パネル
    const actionPanel = document.getElementById('action-panel');
    const panelTrainNum = document.getElementById('panel-train-num');
    const panelRoute = document.getElementById('panel-route');
    const btnDigital = document.getElementById('btn-digital');
    const btnStaff = document.getElementById('btn-staff');
    const btnClose = document.getElementById('btn-close');

    const resultCount = document.getElementById('result-count');
    const reservePanelSpace = () => document.documentElement.style.setProperty('--action-panel-height', actionPanel.hidden ? '0px' : `${actionPanel.getBoundingClientRect().height + 24}px`);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reservePanelSpace).observe(actionPanel);
    window.addEventListener('resize', reservePanelSpace);

    let cachedAllData = [];
    let displayedData = [];
    let sortKey = null;
    let sortDirection = 'ascending';
    let selectedTrainGroup = null;
    let selectedTargetId = null;
    let selectedFinalDate = null;
    let selectedRow = null;

    // ─── パネル制御 ───
    const openPanel = (trainGroup, targetId, finalDate, row) => {
        const t = trainGroup[0];

        selectedTrainGroup = trainGroup;
        selectedTargetId = targetId;
        selectedFinalDate = finalDate;

        panelTrainNum.textContent = t.trainNumber || '―';
        panelRoute.textContent = `${t.origin} 〜 ${t.destination}　／　施行日：${finalDate}`;

        // 選択行ハイライト
        if (selectedRow) { selectedRow.classList.remove('selected'); selectedRow.querySelector('.train-select')?.setAttribute('aria-pressed','false'); }
        selectedRow = row;
        row.classList.add('selected');

        row.querySelector('.train-select')?.setAttribute('aria-pressed','true');
        actionPanel.hidden = false;
        actionPanel.classList.add('open');
        reservePanelSpace();
        btnDigital.focus({preventScroll:true});
    };

    const closePanel = (restoreFocus = false) => {
        if (restoreFocus) selectedRow?.querySelector('.train-select')?.focus({preventScroll:true});
        actionPanel.hidden = true;
        actionPanel.classList.remove('open');
        if (selectedRow) { selectedRow.classList.remove('selected'); selectedRow.querySelector('.train-select')?.setAttribute('aria-pressed','false'); }
        selectedRow = null;
        selectedTrainGroup = null;
        reservePanelSpace();
    };

    const navigate = (isStaff) => {
        if (!selectedTrainGroup) return;
        if (selectedTrainGroup.some(train => train.operationServiceDate && train.operationServiceDate.replaceAll('-', '/') !== selectedFinalDate.replaceAll('-', '/'))) {
            alert('この手入力時刻表は登録された施行日だけ使用できます。施行日を合わせてください。'); return;
        }
        sessionStorage.setItem('selectedTrainData', JSON.stringify(selectedTrainGroup));
        const baseUrl = isStaff ? 'train_staff.html' : 'train_timetable.html';
        window.location.href = `${baseUrl}?id=${encodeURIComponent(selectedTargetId)}&date=${encodeURIComponent(selectedFinalDate)}`;
    };

    btnDigital.addEventListener('click', () => navigate(false));
    btnStaff.addEventListener('click', () => navigate(true));
    btnClose.addEventListener('click', () => closePanel(true));
    document.addEventListener('keydown',event => { if (event.key === 'Escape' && !actionPanel.hidden) closePanel(true); });
    executionDateInput.addEventListener('change',() => closePanel());

    // ─── データ読み込み ───
    const loadTimetables = async () => {
        try {
            cachedAllData = await TayunetPrivateData.fetchTimetables({selectionList:1});
            document.querySelectorAll('[data-sort]').forEach(button => { button.disabled = false; });
            renderTimetableList(cachedAllData);
        } catch (error) {
            listBody.innerHTML =
                '<tr><td colspan="4" class="table-message table-error">データを読み込めませんでした。ログイン状態を確認してから、ページを再読み込みしてください。</td></tr>';
            resultCount.textContent = '読み込みに失敗しました';
        }
    };

    // ─── テーブル描画 ───
    const renderTimetableList = (data) => {
        displayedData = data;
        listBody.innerHTML = '';
        closePanel();

        if (data.length === 0) {
            listBody.innerHTML =
                '<tr><td colspan="4" class="table-message">条件に一致する列車はありません。検索条件を変更してください。</td></tr>';
            resultCount.textContent = '0件';
            return;
        }

        // 列番・始発・終着などでグループ化
        const grouped = data.reduce((acc, train) => {
            const key = `${train.startDate}-${train.trainNumber}-${train.origin}-${train.destination}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(train);
            return acc;
        }, {});

        resultCount.textContent = `${Object.keys(grouped).length}件`;
        sortTrainGroups(Object.values(grouped),sortKey,sortDirection).forEach(trainGroup => {
            const t = trainGroup[0];
            const originalDate = t.startDate || t.dayType || '―';

            const row = listBody.insertRow();
            row.insertCell().textContent = originalDate;
            row.insertCell().textContent = t.type === '選択なし' ? '' : (t.type || '');
            const trainButton = document.createElement('button');
            trainButton.type = 'button';
            trainButton.className = 'train-select';
            trainButton.textContent = t.trainNumber || '―';
            trainButton.setAttribute('aria-label',`${t.trainNumber || '列車'}の表示形式を選択`);
            trainButton.setAttribute('aria-pressed','false');
            trainButton.setAttribute('aria-controls','action-panel');
            row.insertCell().appendChild(trainButton);
            row.insertCell().textContent = `${t.origin} 〜 ${t.destination}`;

            row.addEventListener('click', () => {
                const customDate = executionDateInput ? executionDateInput.value : '';
                const finalDate = customDate || originalDate;

                const p = originalDate.split(/[\/\-]/);
                const dateKey = p.length >= 3
                    ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`
                    : originalDate;
                const targetId = `${dateKey}_${t.trainNumber}`;

                openPanel(trainGroup, targetId, finalDate, row);
            });
        });
    };

    document.querySelectorAll('[data-sort]').forEach(button => {
        button.addEventListener('click',() => {
            const key = button.dataset.sort;
            sortDirection = sortKey === key && sortDirection === 'ascending' ? 'descending' : 'ascending';
            sortKey = key;
            document.querySelectorAll('[data-sort]').forEach(control => {
                const active = control.dataset.sort === sortKey;
                const label = control.childNodes[0].textContent.trim();
                control.closest('th').setAttribute('aria-sort',active ? sortDirection : 'none');
                control.querySelector('.sort-icon').textContent = active ? (sortDirection === 'ascending' ? '▲' : '▼') : '↕';
                control.setAttribute('aria-label',`${label}で${active && sortDirection === 'ascending' ? '降順' : '昇順'}に並べ替え`);
            });
            const label = button.childNodes[0].textContent.trim();
            document.getElementById('sort-status').textContent = `${label}の${sortDirection === 'ascending' ? '昇順' : '降順'}で表示しています。`;
            renderTimetableList(displayedData);
        });
    });

    // ─── 検索 ───
    const applySearchFilter = () => {
        const dateFilter = searchDateInput.value.trim();
        const numberFilter = searchNumberInput.value.trim().toLowerCase();

        const filtered = cachedAllData.filter(train => {
            const normalizeDate = value => String(value || '').split(/[\/-]/).map(part => /^\d+$/.test(part) ? Number(part) : part).join('-');
            const dateMatch = !dateFilter || normalizeDate(train.startDate || train.dayType) === normalizeDate(dateFilter);
            const numberMatch = !numberFilter || (train.trainNumber || '').toLowerCase().includes(numberFilter);
            return dateMatch && numberMatch;
        });

        renderTimetableList(filtered);
    };

    document.getElementById('search-form').addEventListener('submit',event => { event.preventDefault(); applySearchFilter(); });

    resetButton.addEventListener('click', () => {
        searchDateInput.value = '';
        searchNumberInput.value = '';
        if (executionDateInput) executionDateInput.value = '';
        renderTimetableList(cachedAllData);
    });

    loadTimetables();
});

// Sort whole train groups so route segments and their navigation data stay together.
function sortTrainGroups(groups,key,direction) {
    if (!key) return [...groups];
    const collator = new Intl.Collator('ja',{numeric:true,sensitivity:'base'});
    const normalized = value => String(value ?? '').normalize('NFKC').trim();
    const valueFor = group => {
        const train = group[0] || {};
        switch (key) {
            case 'date': return normalized(train.startDate || train.dayType);
            case 'type': return train.type === '選択なし' ? '' : normalized(train.type);
            case 'number': return normalized(train.trainNumber);
            case 'route': return normalized(`${train.origin || ''} 〜 ${train.destination || ''}`);
            default: return '';
        }
    };
    const dateValue = value => {
        const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value);
        return match ? Number(match[1])*10000 + Number(match[2])*100 + Number(match[3]) : null;
    };
    return [...groups].sort((left,right) => {
        const a = valueFor(left), b = valueFor(right);
        // Missing values stay at the end in both directions.
        if (!a || !b) return a ? -1 : b ? 1 : 0;
        const da = key === 'date' ? dateValue(a) : null;
        const db = key === 'date' ? dateValue(b) : null;
        const comparison = da !== null && db !== null ? da-db : collator.compare(a,b);
        return direction === 'descending' ? -comparison : comparison;
    });
}
