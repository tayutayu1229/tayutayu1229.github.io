(function (global) {
  'use strict';

  function isYardMovement(train) {
    return !!(train && train.yardMovement && typeof train.yardMovement === 'object' &&
      (train.type === '入区' || train.type === '出区' || train.yardMovement.category === '入区' || train.yardMovement.category === '出区'));
  }

  function cell(row, tag, value) {
    const element = document.createElement(tag);
    element.textContent = value == null || value === '' ? '　' : String(value);
    row.appendChild(element);
    return element;
  }

  function open(train, date) {
    if (!isYardMovement(train)) return false;
    document.getElementById('yardDialogBackdrop')?.remove();
    const yard = train.yardMovement;
    const category = yard.category || train.type;
    const station = category === '出区' ? (train.destination || train.stops?.[0]?.station || '') :
      (train.origin || train.stops?.[0]?.station || '');
    const backdrop = document.createElement('div');
    backdrop.id = 'yardDialogBackdrop';
    backdrop.className = 'yard-dialog-backdrop';
    const dialog = document.createElement('section');
    dialog.className = 'yard-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `${train.trainNumber || ''} 入出区ダイヤ`);
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'yard-dialog-close'; close.textContent = '✖ 閉じる';
    close.addEventListener('click', () => backdrop.remove());
    dialog.appendChild(close);
    const heading = document.createElement('div'); heading.className = 'yard-dialog-heading';
    const title = document.createElement('p');
    title.textContent = `■線区:[${train.line || '—'}] 駅名:[${station || '—'}] 施行日:${date || train.startDate || '—'}`;
    heading.appendChild(title); dialog.appendChild(heading);

    const wrap = document.createElement('div'); wrap.className = 'yard-dialog-table-wrap';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const top = document.createElement('tr');
    ['入出区列番', '区分', '運行', '前運用列番', '後運用列番', '運休', '抑止', '動力'].forEach((label, index) => {
      const th = cell(top, 'th', label);
      th.className = index === 0 || index === 3 || index === 4 ? 'yard-col-wide' : 'yard-col-narrow';
    });
    thead.appendChild(top); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    [train.trainNumber, category, yard.operation || '', yard.previousTrainNumber || train.tr1 || '',
      yard.nextTrainNumber || train.tr2 || '', yard.cancelled || '', yard.suspended || '', yard.power || train.power || ''].forEach(value => cell(row, 'td', value));
    tbody.appendChild(row); table.appendChild(tbody); wrap.appendChild(table);

    const routeTable = document.createElement('table');
    const routeHead = document.createElement('thead');
    const labels = document.createElement('tr');
    cell(labels, 'th', '');
    ['発番線', '経由番線1', '経由番線2', '経由番線3', '経由番線4', '経由番線5', '経由番線6', '着番線'].forEach(label => cell(labels, 'th', label));
    routeHead.appendChild(labels); routeTable.appendChild(routeHead);
    const routeBody = document.createElement('tbody');
    const timeRow = document.createElement('tr'); cell(timeRow, 'th', '時刻');
    const trackRow = document.createElement('tr'); cell(trackRow, 'th', '番線');
    const positions = [
      [yard.departureTime, yard.departureTrack], [yard.viaTime, yard.viaTrack],
      [yard.viaTime2, yard.viaTrack2], [yard.viaTime3, yard.viaTrack3],
      [yard.viaTime4, yard.viaTrack4], [yard.viaTime5, yard.viaTrack5],
      [yard.viaTime6, yard.viaTrack6], [yard.arrivalTime, yard.arrivalTrack]
    ];
    positions.forEach(([time, track]) => { cell(timeRow, 'td', time); cell(trackRow, 'td', track); });
    routeBody.append(timeRow, trackRow); routeTable.appendChild(routeBody); wrap.appendChild(routeTable);
    dialog.appendChild(wrap);
    const note = document.createElement('p'); note.className = 'yard-dialog-note';
    note.textContent = '時刻・番線は入出区ダイヤの登録データです。';
    dialog.appendChild(note);
    backdrop.appendChild(dialog);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    close.focus();
    return true;
  }

  global.TayunetYardMovement = { isYardMovement, open };
})(window);
