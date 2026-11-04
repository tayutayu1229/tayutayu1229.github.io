(async function () {
  'use strict';
  try {
    const response = await fetch('/JRF_status/JRF-gtfs/data/fetch-health.json', {cache: 'no-store'});
    if (!response.ok) throw new Error('取得結果を確認できません');
    const health = await response.json();
    if (health.ok && health.available !== false) return;
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'padding:16px;margin:0;background:#fff4ce;color:#594100;text-align:center;font-weight:bold';
    const lastSuccess = new Date(health.lastSuccessAt);
    const label = Number.isFinite(lastSuccess.getTime()) ? lastSuccess.toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'}) : '不明';
    notice.textContent = `${health.reason === 'outside_service_hours' ? 'JR貨物公式サイトはサービス時間外です。' : '公式情報の更新を確認できません。'}前回取得分を表示しています。最終取得成功: ${label}`;
    document.body.prepend(notice);
  } catch (error) {
    const notice = document.createElement('p');
    notice.setAttribute('role', 'status');
    notice.textContent = '取得状況を確認できません。掲載の最終取得日時をご確認ください。';
    document.body.prepend(notice);
  }
})();
