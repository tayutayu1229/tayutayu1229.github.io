(async function () {
  'use strict';
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const notice = element('p');
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'padding:16px;margin:0;background:#fff4ce;color:#594100;text-align:center;font-weight:bold';
  notice.hidden = true;
  document.body.prepend(notice);
  async function refresh() {
    try {
      const bundle = await TayunetFreightStatus.load();
      const {data, health} = bundle;
      const meta = document.querySelector('.hero-meta');
      if (meta) meta.replaceChildren(element('span', `公式発表 ${data.announcementDate}`, 'pill'), element('span', data.asOf, 'pill'));
      const heading = document.querySelector('.summary h2');
      if (heading) heading.textContent = data.title;
      const incidents = document.querySelector('.incidents');
      if (incidents) incidents.replaceChildren(...data.incidents.map(item => {
        const row = element('li'); row.append(element('time', item.time), element('p', item.detail)); return row;
      }));
      if (incidents && !data.incidents.length) incidents.append(element('li', '現在、掲載中の障害概要はありません。', 'empty'));
      const routes = document.querySelector('.routes');
      if (routes) routes.replaceChildren(...data.routes.map(route => {
        const section = element('section', undefined, 'route');
        const header = element('div', undefined, 'route-head');
        header.append(element('h2', route.name), element('span', `${route.trains.length}列車`));
        const wrap = element('div', undefined, 'table-wrap'), table = element('table'), head = element('thead'), headRow = element('tr'), body = element('tbody');
        ['列車', '現在地', '状況'].forEach(label => headRow.append(element('th', label)));
        head.append(headRow);
        route.trains.forEach(train => {
          const row = element('tr');
          [['列車', train.service], ['現在地', train.location], ['状況', train.status]].forEach(([label, value]) => {
            const cell = element('td', value);
            if (label === '状況') cell.replaceChildren(element('span', value, `status ${/停車|運休/.test(value)?'danger':/[+遅]/.test(value)?'delay':'normal'}`));
            cell.dataset.label = label; row.append(cell);
          });
          body.append(row);
        });
        table.append(head, body); wrap.append(table); section.append(header, wrap); return section;
      }));
      if (routes && !data.routes.length) routes.append(element('div', '現在、掲載中の列車情報はありません。', 'empty-card'));
      const count = document.querySelector('.section-title span');
      if (count) count.textContent = `${data.routes.length}線区・${data.trains.length}列車`;
      const footer = document.querySelector('.footer-inner span');
      if (footer) footer.textContent = `最終取得: ${data.fetchedLabel || data.proxiedAt}`;
      const age = Date.now() - Date.parse(data.proxiedAt || '');
      const current = TayunetFreightStatus.isCurrent(bundle) && Number.isFinite(age) && age >= -300000 && age <= 2 * 60 * 60 * 1000;
      notice.hidden = current && bundle.transport === 'live';
      notice.textContent = health.reason === 'outside_service_hours'
        ? 'JR貨物公式サイトはサービス時間外です。前回取得分を表示しています。'
        : !current ? '公式情報の更新を確認できません。掲載の最終取得日時をご確認ください。'
        : bundle.transportError || '';
    } catch (error) {
      notice.hidden = false;
      notice.textContent = '取得状況を確認できません。掲載の最終取得日時をご確認ください。';
    }
  }
  await refresh();
  setInterval(refresh, 300000);
})();
