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
        
        const searchDateFormatted = dateInput ? dateInput.replace(/-/g, '/') : null;

        let filteredData = data.filter(item => {
            const dateMatch = (() => {
                if (!searchDateFormatted) {
                    return true;
                }

                if (item.type === "通常") {
                    const dateObj = new Date(dateInput);
                    const dayOfWeek = dateObj.getDay();
                    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
                    
                    return ((item.weekday === "平日" && !isWeekend) || 
                            (item.weekday === "土休日" && isWeekend) ||
                            (item.weekday === "曜日関係なし"));
                }

                if (item.type === "臨時") {
                    if (Array.isArray(item.date)) {
                        return item.date.includes(searchDateFormatted);
                    }
                    if (item.start_date && item.end_date) {
                        const startDate = new Date(item.start_date);
                        const endDate = new Date(item.end_date);
                        const inputDate = new Date(searchDateFormatted);
                        return inputDate >= startDate && inputDate <= endDate;
                    }
                    if (typeof item.date === 'string') {
                        return item.date === searchDateFormatted;
                    }
                }
                return false;
            })();

            const divisionMatch = divisionSelect.length === 0 || item.division === divisionSelect;
            const opNumMatch = operationNumberInput.length === 0 || item.operation_number.toLowerCase().includes(operationNumberInput);
            const trainNumMatch = trainNumberInput.length === 0 || item.train_runs.some(run => 
                (run.train_number && run.train_number.toLowerCase().includes(trainNumberInput)) ||
                (run.route && run.route.toLowerCase().includes(trainNumberInput))
            );

            return dateMatch && divisionMatch && opNumMatch && trainNumMatch;
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
                    if (item.type === '臨時') {
                        if (Array.isArray(item.date)) {
                            const dates = item.date.map(d => {
                                const parts = d.split('/');
                                return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                            });
                            const month = dates[0].split('/')[0];
                            const days = dates.map(d => d.split('/')[1]);
                            dateCell.textContent = `${month}/${days.join('.')}`;
                        } else if (item.start_date && item.end_date) {
                            const startDateParts = item.start_date.split('/');
                            const endDateParts = item.end_date.split('/');
                            const startDisplay = `${parseInt(startDateParts[1], 10)}/${parseInt(startDateParts[2], 10)}`;
                            const endDisplay = `${parseInt(endDateParts[1], 10)}/${parseInt(endDateParts[2], 10)}`;
                            // 月が同じ場合は日のみ表示
                            if (startDateParts[1] === endDateParts[1]) {
                                dateCell.textContent = `${startDisplay}〜${parseInt(endDateParts[2], 10)}`;
                            } else {
                                dateCell.textContent = `${startDisplay}〜${endDisplay}`;
                            }
                        } else {
                            const parts = item.date.split('/');
                            dateCell.textContent = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                        }
                    } else {
                        dateCell.textContent = item.weekday;
                    }
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
        
        // 施行日の表示形式を生成
        let displayDate = '';
        if (item.type === '臨時') {
            if (Array.isArray(item.date)) {
                const dates = item.date.map(d => {
                    const parts = d.split('/');
                    return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                });
                const month = dates[0].split('/')[0];
                const days = dates.map(d => d.split('/')[1]);
                displayDate = `${month}/${days.join('.')}`;
            } else if (item.start_date && item.end_date) {
                const startDateParts = item.start_date.split('/');
                const endDateParts = item.end_date.split('/');
                const startDisplay = `${parseInt(startDateParts[1], 10)}/${parseInt(startDateParts[2], 10)}`;
                const endDisplay = `${parseInt(endDateParts[1], 10)}/${parseInt(endDateParts[2], 10)}`;
                if (startDateParts[1] === endDateParts[1]) {
                    displayDate = `${startDisplay}〜${parseInt(endDateParts[2], 10)}`;
                } else {
                    displayDate = `${startDisplay}〜${endDisplay}`;
                }
            } else {
                const parts = item.date.split('/');
                displayDate = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
            }
        } else {
            displayDate = item.weekday;
        }

        // 列車情報のフォーマットをスペース区切りに修正
        let trainRunsHtml = '';
        item.train_runs.forEach(run => {
            trainRunsHtml += `<p><strong>${run.train_number || ''}</strong>&emsp;${run.route}</p>`;
        });

        detailsContainer.innerHTML = `
            <h2>運用詳細</h2>
            <p><strong>施行日:</strong> ${displayDate}</p>
            <p><strong>運用番号:</strong> ${item.operation_number}</p>
            <p><strong>区所名:</strong> ${item.division}</p>
            <p><strong>形式:</strong> ${item.vehicles}</p>
            <h3>列車情報</h3>
            ${trainRunsHtml}
            ${item.successor ? `<p><strong>後継承(備考):</strong> ${item.successor}</p>` : ''}
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
