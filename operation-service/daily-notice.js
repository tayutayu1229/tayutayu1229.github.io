(async function () {
  'use strict';
  const U = window.OperationDailyUtils;
  const query = new URLSearchParams(location.search);
  const date = window.OperationServiceAdminUtils.normalizeDate(query.get('serviceDate'));
  const draft = query.get('draft') === '1';
  const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:5119' : 'https://secure.tayunet-traininfo.com';
  const paper = document.getElementById('main-content');
  const printButton = document.getElementById('printDaily');
  const status = document.getElementById('previewStatus');
  const sort = document.getElementById('dailyPdfSort');
  const orders = ['number','time','line','category','activity'];
  sort.value = orders.includes(query.get('sort')) ? query.get('sort') : 'number';
  let previewItems = [];
  const sortedItems = () => [...previewItems].sort((left, right) => U.compare(left, right, sort.value));
  let ready = false;
  printButton.addEventListener('click', () => { if (ready) window.print(); });
  document.getElementById('closeDaily').addEventListener('click', () => window.close());
  function markup(html, target = paper) {
    const range = document.createRange(); range.selectNodeContents(target);
    target.replaceChildren(range.createContextualFragment(html));
  }
  sort.addEventListener('change', () => {
    if (!ready) return;
    markup(U.rowsMarkup(sortedItems()) || '<tr><td colspan="10">対象列車はありません。</td></tr>', document.getElementById('dailyPreviewRows'));
  });
  function script(src) {
    return new Promise((resolve, reject) => {
      const node = document.createElement('script'); node.src = src; node.onload = resolve;
      node.onerror = () => reject(new Error('認証スクリプトを読み込めませんでした。'));
      document.head.append(node);
    });
  }
  try {
    if (!date) throw new Error('正しい施行日を指定してください。');
    const options = {cache:'no-store', credentials:'include', headers:{Accept:'application/json'}};
    let path = '/public/api/operation-notices/daily';
    if (draft) {
      // Public previews never initialize login or receive draft data.
      for (const src of ['https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js',
        'https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js',
        'https://www.gstatic.com/firebasejs/8.10.1/firebase-firestore.js',
        '/T-time/firebase-data-auth.js', '/auth_guard.js?v=2026.10.15.2']) await script(src);
      const auth = await window.TayunetAuthReady;
      if (!auth.ok) return;
      options.headers.Authorization = `Bearer ${await window.TayunetFirebaseDataAuth.getIdToken()}`;
      path = '/api/operation-service/daily';
    }
    let response = await fetch(`${origin}${path}?serviceDate=${date}`, options);
    if (draft && response.status === 401) {
      options.headers.Authorization = `Bearer ${await window.TayunetFirebaseDataAuth.getIdToken(true)}`;
      response = await fetch(`${origin}${path}?serviceDate=${date}`, options);
    }
    if (!response.ok) throw new Error(`プレビューを取得できませんでした（HTTP ${response.status}）。`);
    const day = await response.json();
    previewItems = day.items || [];
    if (!draft && day.status === 'withdrawn') throw new Error('この日の日別通達は取下げ済みです。');
    const label = draft ? '下書きプレビュー・未発表' : day.legacy ? '旧列車別データの集約一覧・日別通達は未発行' : `発表第${day.edition}版`;
    const publishedTime = day.publishedAt ? new Date(day.publishedAt).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo', hour12:false}) : '';
    const parts = date.split('-');
    document.title = `${day.noticeNumber || '未発行'} ${date} 運転活休通達${draft ? '（下書き）' : ''}`;
    markup(`<header class="daily-heading"><h1>運転活休通達</h1><span class="daily-date">${Number(parts[1])}月${Number(parts[2])}日分</span><span class="daily-number">${U.escapeHtml(day.noticeNumber || '運転活休通達第＊＊＊＊＊号')}</span></header>
      <div class="draft-label">${parts[0]}年　${U.escapeHtml(label)}${publishedTime && !draft ? `　発表 ${U.escapeHtml(publishedTime)}` : ''}</div>
      <table class="daily-grid" aria-label="その日の運転活休通達">
      <colgroup><col style="width:5mm"><col style="width:9mm"><col style="width:17mm"><col style="width:25mm"><col style="width:16mm"><col style="width:23mm"><col style="width:23mm"><col style="width:20mm"><col style="width:40mm"><col></colgroup>
      <thead><tr><th class="check" aria-label="確認欄"></th><th>No.</th><th>区分</th><th>列車番号</th><th>種別</th><th>始発駅</th><th>終着駅</th><th>活休</th><th>適用区間</th><th>手配内容・備考</th></tr></thead>
      <tbody id="dailyPreviewRows">${U.rowsMarkup(sortedItems()) || '<tr><td colspan="10">対象列車はありません。</td></tr>'}</tbody></table>
      <div class="daily-common">共通記事：${U.escapeHtml(day.commonRemarks || '―')}</div>`);
    status.textContent = `${date}　${(day.items || []).length}列車　${label}。内容を確認して「印刷・PDF保存」を押してください。印刷設定はA4横・倍率100%を推奨します。`;
    ready = true; printButton.disabled = false;
  } catch (error) {
    status.textContent = error.message;
    paper.textContent = error.message;
  }
}());
