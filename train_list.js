document.addEventListener('DOMContentLoaded', () => {
    const JSON_PATH = '../../T-time/timetables.json';
    const listBody = document.querySelector('#timetable-list tbody');
    const searchDateInput = document.getElementById('search-date');
    const searchNumberInput = document.getElementById('search-number');
    const searchButton = document.getElementById('search-button');
    const resetButton = document.getElementById('reset-button');

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
            row.insertCell().textContent = t.startDate || '―';

            let type = t.type;
            if (type === "選択なし") type = "";
            row.insertCell().textContent = type;

            row.insertCell().textContent = t.trainNumber || '―';
            row.insertCell().textContent = `${t.origin} 〜 ${t.destination}`;

            row.addEventListener('click', () => {
                sessionStorage.setItem('selectedTrainData', JSON.stringify(trainGroup));
                window.location.href = 'train_timetable.html';
            });
        });
    };

    const applySearchFilter = () => {
        const dateFilter = searchDateInput.value.trim();
        const numberFilter = searchNumberInput.value.trim().toLowerCase();

        const filtered = cachedAllData.filter(train => {
            let dateMatch = true;
            let numberMatch = true;

            if (dateFilter) dateMatch = train.startDate.includes(dateFilter);
            if (numberFilter) numberMatch = train.trainNumber.toLowerCase().includes(numberFilter);

            return dateMatch && numberMatch;
        });

        renderTimetableList(filtered);
    };

    searchButton.addEventListener('click', applySearchFilter);

    resetButton.addEventListener('click', () => {
        searchDateInput.value = '';
        searchNumberInput.value = '';
        renderTimetableList(cachedAllData);
    });

    loadTimetables();
});
