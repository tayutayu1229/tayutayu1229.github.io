document.addEventListener('DOMContentLoaded', () => {
    const JSON_PATH = '../../T-time/timetables.json';
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

    let cachedAllData = [];
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
        if (selectedRow) selectedRow.classList.remove('selected');
        selectedRow = row;
        row.classList.add('selected');

        actionPanel.classList.add('open');
    };

    const closePanel = () => {
        actionPanel.classList.remove('open');
        if (selectedRow) selectedRow.classList.remove('selected');
        selectedRow = null;
        selectedTrainGroup = null;
    };

    const navigate = (isStaff) => {
        if (!selectedTrainGroup) return;
        sessionStorage.setItem('selectedTrainData', JSON.stringify(selectedTrainGroup));
        const baseUrl = isStaff ? 'train_staff.html' : 'train_timetable.html';
        window.location.href = `${baseUrl}?id=${encodeURIComponent(selectedTargetId)}&date=${encodeURIComponent(selectedFinalDate)}`;
    };

    btnDigital.addEventListener('click', () => navigate(false));
    btnStaff.addEventListener('click', () => navigate(true));
    btnClose.addEventListener('click', closePanel);

    // ─── データ読み込み ───
    const loadTimetables = async () => {
        try {
            const response = await fetch(JSON_PATH);
            if (!response.ok) throw new Error('JSON読み込み失敗');
            cachedAllData = await response.json();
            renderTimetableList(cachedAllData);
        } catch (error) {
            listBody.innerHTML =
                '<tr><td colspan="4" style="text-align:center; color:red; padding:32px;">データの読み込みに失敗しました。</td></tr>';
        }
    };

    // ─── テーブル描画 ───
    const renderTimetableList = (data) => {
        listBody.innerHTML = '';
        closePanel();

        if (data.length === 0) {
            listBody.innerHTML =
                '<tr><td colspan="4" style="text-align:center; color:#7a8c82; padding:32px;">該当データなし</td></tr>';
            return;
        }

        // 列番・始発・終着などでグループ化
        const grouped = data.reduce((acc, train) => {
            const key = `${train.startDate}-${train.trainNumber}-${train.origin}-${train.destination}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(train);
            return acc;
        }, {});

        Object.keys(grouped).forEach(key => {
            const trainGroup = grouped[key];
            const t = trainGroup[0];
            const originalDate = t.startDate || t.dayType || '―';

            const row = listBody.insertRow();
            row.insertCell().textContent = originalDate;
            row.insertCell().textContent = t.type === '選択なし' ? '' : (t.type || '');
            row.insertCell().textContent = t.trainNumber || '―';
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

    // ─── 検索 ───
    const applySearchFilter = () => {
        const dateFilter = searchDateInput.value.trim();
        const numberFilter = searchNumberInput.value.trim().toLowerCase();

        const filtered = cachedAllData.filter(train => {
            const dateMatch = !dateFilter || (train.startDate || '').includes(dateFilter);
            const numberMatch = !numberFilter || (train.trainNumber || '').toLowerCase().includes(numberFilter);
            return dateMatch && numberMatch;
        });

        renderTimetableList(filtered);
    };

    searchButton.addEventListener('click', applySearchFilter);

    resetButton.addEventListener('click', () => {
        searchDateInput.value = '';
        searchNumberInput.value = '';
        if (executionDateInput) executionDateInput.value = '';
        renderTimetableList(cachedAllData);
    });

    loadTimetables();
});
