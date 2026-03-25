document.addEventListener('DOMContentLoaded', () => {
    const JSON_PATH = '../../T-time/timetables.json';
    const listBody = document.querySelector('#timetable-list tbody');
    const searchDateInput = document.getElementById('search-date');
    const searchNumberInput = document.getElementById('search-number');
    const searchButton = document.getElementById('search-button');
    const resetButton = document.getElementById('reset-button');
    
    // index.html側にある「自由設定用の施行日入力欄」を取得（IDは前回の修正に合わせexecution-dateと想定）
    const executionDateInput = document.getElementById('execution-date');

    let cachedAllData = [];

    const loadTimetables = async () => {
        try {
            const response = await fetch(JSON_PATH);
            if (!response.ok) throw new Error("JSON読み込み失敗");

            cachedAllData = await response.json();
            renderTimetableList(cachedAllData);

        } catch (error) {
            listBody.innerHTML =
                '<tr><td colspan="4" style="text-align:center; color:red;">データの読み込みに失敗しました。</td></tr>';
        }
    };

    const renderTimetableList = (data) => {
        listBody.innerHTML = "";

        if (data.length === 0) {
            listBody.innerHTML =
                '<tr><td colspan="4" style="text-align:center;">該当データなし</td></tr>';
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

            const row = listBody.insertRow();
            
            // 施行日（データ上の日付）
            const originalDate = t.startDate || t.dayType || '―';
            row.insertCell().textContent = originalDate;

            let type = t.type;
            if (type === "選択なし") type = "";
            row.insertCell().textContent = type;

            row.insertCell().textContent = t.trainNumber || '―';
            row.insertCell().textContent = `${t.origin} 〜 ${t.destination}`;

            // クリック時の挙動：モード選択
            row.addEventListener('click', () => {
                // 1. 自由設定された施行日があれば取得、なければ元のデータの日付を使用
                const customDate = executionDateInput ? executionDateInput.value : "";
                const finalDate = customDate || originalDate;

                // 2. 遷移用IDの生成 (表示用と同じロジック)
                const p = (originalDate).split(/[\/\-]/);
                const dateKey = p.length >= 3 ? `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}` : originalDate;
                const targetId = `${dateKey}_${t.trainNumber}`;

                // 3. 表示モードの選択
                const isStaff = confirm(
                    `【表示モード選択】\n\nOK：紙スタフ形式 (運転士用)\nキャンセル：デジタル形式 (現行)\n\n設定施行日：${finalDate}`
                );

                // 4. セッションストレージにデータを保存（互換性のため）
                sessionStorage.setItem('selectedTrainData', JSON.stringify(trainGroup));
                
                // 5. 各画面へ遷移
                const baseUrl = isStaff ? 'train_staff.html' : 'train_timetable.html';
                window.location.href = `${baseUrl}?id=${encodeURIComponent(targetId)}&date=${encodeURIComponent(finalDate)}`;
            });
        });
    };

    const applySearchFilter = () => {
        const dateFilter = searchDateInput.value.trim();
        const numberFilter = searchNumberInput.value.trim().toLowerCase();

        const filtered = cachedAllData.filter(train => {
            let dateMatch = true;
            let numberMatch = true;

            if (dateFilter) dateMatch = (train.startDate || "").includes(dateFilter);
            if (numberFilter) numberMatch = (train.trainNumber || "").toLowerCase().includes(numberFilter);

            return dateMatch && numberMatch;
        });

        renderTimetableList(filtered);
    };

    searchButton.addEventListener('click', applySearchFilter);

    resetButton.addEventListener('click', () => {
        searchDateInput.value = '';
        searchNumberInput.value = '';
        if(executionDateInput) executionDateInput.value = '';
        renderTimetableList(cachedAllData);
    });

    loadTimetables();
});