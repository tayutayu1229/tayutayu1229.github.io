document.addEventListener('DOMContentLoaded', () => {
    let data = [];

    // JSONデータの非同期読み込み
    fetch('data.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`データの読み込みに失敗しました。HTTPエラー: ${response.status}`);
            }
            return response.json();
        })
        .then(jsonData => {
            data = jsonData;
            populateDivisionSelect(data);
            displayResults(data);
        })
        .catch(error => {
            console.error('Error loading JSON data:', error);
            document.getElementById('results_table').querySelector('tbody').innerHTML = `<tr><td colspan="6">データの読み込みに失敗しました。<br>${error.message}</td></tr>`;
        });

    const searchButton = document.getElementById('search_button');
    searchButton.addEventListener('click', performSearch);

    function performSearch() {
        const dateInput = document.getElementById('date_input').value;
        const divisionSelect = document.getElementById('division_select').value;
        const operationNumberInput = document.getElementById('operation_number_input').value.trim().toLowerCase();
        const trainNumberInput = document.getElementById('train_number_input').value.trim().toLowerCase();

        // フィルタリングをここで行う
        let filteredData = data.filter(item => {
            // 施行日フィルタ
            if (dateInput.length > 0) {
                const searchDateFormatted = dateInput.replace(/-/g, '/');
                const dateObj = new Date(dateInput);
                const dayOfWeek = dateObj.getDay();
                const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

                const isTempOperation = item.type === "臨時" && item.date === searchDateFormatted;
                const isRegularOperation = item.type === "通常" &&
                                            ((item.weekday === "平日" && !isWeekend) ||
                                             (item.weekday === "土休日" && isWeekend) ||
                                             (item.weekday === "曜日関係なし"));
                if (!isTempOperation && !isRegularOperation) {
                    return false;
                }
            }

            // 区所名フィルタ
            if (divisionSelect.length > 0 && item.division !== divisionSelect) {
                return false;
            }

            // 運用番号フィルタ
            if (operationNumberInput.length > 0 && !item.operation_number.toLowerCase().includes(operationNumberInput)) {
                return false;
            }
            
            // 列車番号フィルタ
            if (trainNumberInput.length > 0) {
                const trainOrRouteMatch = item.train_runs.some(run =>
                    (run.train_number && run.train_number.toLowerCase().includes(trainNumberInput)) ||
                    (run.route && run.route.toLowerCase().includes(trainNumberInput))
                );
                if (!trainOrRouteMatch) {
                    return false;
                }
            }

            return true; // すべての条件を満たした場合
        });

        displayResults(filteredData);
        updateFilterDisplay(dateInput, divisionSelect, operationNumberInput, trainNumberInput);
    }

    function populateDivisionSelect(data) {
        const divisions = [...new Set(data.map(item => item.division))].filter(Boolean).sort();
        const select = document.getElementById('division_select');
        divisions.forEach(division => {
            const option = document.createElement('option');
            option.value = division;
            option.textContent = division;
            select.appendChild(option);
        });
    }

    function updateFilterDisplay(date, division, opNum, trainNum) {
        document.getElementById('filter_display').textContent =
            `絞り込み状況：施行日：${date || '指定なし'} 区所名：${division || '指定なし'} 運用番号：${opNum || '指定なし'} 列車番号：${trainNum || '指定なし'}`;
    }

    function displayResults(results) {
        const tbody = document.getElementById('results_table').querySelector('tbody');
        tbody.innerHTML = '';

        if (results.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">該当する運用情報はありません。</td></tr>';
            return;
        }

        results.forEach(item => {
            item.train_runs.forEach((run, index) => {
                const row = document.createElement('tr');
                row.dataset.id = item.id;

                if (index === 0) {
                    const dateCell = document.createElement('td');
                    dateCell.textContent = item.type === '臨時' ? item.date : item.weekday;
                    dateCell.rowSpan = item.train_runs.length;
                    row.appendChild(dateCell);

                    const divisionCell = document.createElement('td');
                    divisionCell.textContent = item.division;
                    divisionCell.rowSpan = item.train_runs.length;
                    row.appendChild(divisionCell);

                    const opNumCell = document.createElement('td');
                    opNumCell.textContent = item.operation_number;
                    opNumCell.rowSpan = item.train_runs.length;
                    row.appendChild(opNumCell);
                }

                const trainNumCell = document.createElement('td');
                trainNumCell.textContent = run.train_number || '';
                row.appendChild(trainNumCell);

                const routeCell = document.createElement('td');
                routeCell.textContent = run.route;
                row.appendChild(routeCell);

                if (index === 0) {
                    const vehiclesCell = document.createElement('td');
                    vehiclesCell.textContent = item.vehicles;
                    vehiclesCell.rowSpan = item.train_runs.length;
                    row.appendChild(vehiclesCell);
                }

                row.addEventListener('click', () => showDetails(item));
                tbody.appendChild(row);
            });
        });
    }

    function showDetails(item) {
        const modal = document.getElementById('modal');
        const detailsContainer = document.getElementById('modal-details');

        let trainRunsHtml = '<ul>';
        item.train_runs.forEach(run => {
            trainRunsHtml += `<li><strong>${run.train_number || ''}</strong>: ${run.route}</li>`;
        });
        trainRunsHtml += '</ul>';

        detailsContainer.innerHTML = `
            <h2>運用詳細</h2>
            <p><strong>運用番号:</strong> ${item.operation_number}</p>
            <p><strong>区所名:</strong> ${item.division}</p>
            <p><strong>形式:</strong> ${item.vehicles}</p>
            <h3>列車情報</h3>
            ${trainRunsHtml}
            ${item.successor ? `<p><strong>後継承:</strong> ${item.successor}</p>` : ''}
        `;
        modal.style.display = 'block';
    }

    const modal = document.getElementById('modal');
    const closeButton = document.querySelector('.close-button');
    closeButton.onclick = () => {
        modal.style.display = 'none';
    };
    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
});
