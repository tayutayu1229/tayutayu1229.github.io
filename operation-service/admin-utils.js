(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OperationServiceAdminUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeDate(value) {
    const match = String(value || '').trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return '';
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function dateSelectionResult(selection) {
    const mode = String(selection?.mode || 'single');
    if (mode === 'multiple') {
      const serviceDates = [...new Set((selection?.dates || []).map(normalizeDate).filter(Boolean))].sort();
      if (!(selection?.dates || []).length) {
        return {ok: false, message: '複数日は「日付追加」で1日以上追加してください。'};
      }
      if (serviceDates.length !== selection.dates.length) {
        return {ok: false, message: '複数日の一覧に正しくない日付または重複があります。削除して追加し直してください。'};
      }
      return {ok: true, spec: {serviceDateMode: mode, serviceDate: serviceDates[0], serviceDates}};
    }
    if (mode === 'range') {
      const serviceDateStart = normalizeDate(selection?.start);
      const serviceDateEnd = normalizeDate(selection?.end);
      if (!serviceDateStart || !serviceDateEnd) {
        return {ok: false, message: '期間の開始日・終了日をYYYY/MM/DD形式で入力してください。'};
      }
      if (serviceDateStart > serviceDateEnd) {
        return {ok: false, message: '期間は開始日が終了日以前になるように指定してください。'};
      }
      return {ok: true, spec: {serviceDateMode: mode, serviceDate: serviceDateStart, serviceDateStart, serviceDateEnd}};
    }
    const serviceDate = normalizeDate(selection?.single);
    if (!serviceDate) return {ok: false, message: '単日の運転日をYYYY/MM/DD形式で入力してください。'};
    return {ok: true, spec: {serviceDateMode: 'single', serviceDate, serviceDates: [serviceDate]}};
  }

  function bulkResultModel(actionLabel, succeeded, failures, total) {
    return {
      actionLabel: String(actionLabel || '一括処理'),
      total: Number(total) || 0,
      succeeded: Number(succeeded) || 0,
      failed: (failures || []).map(item => ({
        trainNumber: String(item?.trainNumber || '不明'),
        reason: String(item?.reason || '理由不明'),
      })),
    };
  }

  return {normalizeDate, dateSelectionResult, bulkResultModel};
}));
