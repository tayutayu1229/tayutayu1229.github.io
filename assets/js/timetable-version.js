(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TayunetTimetableVersion = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function normalizedDate(value) {
    const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(String(value || '').trim());
    return match ? `${match[1]}/${match[2]}/${match[3]}` : '';
  }

  function versionsForDate(candidates, dateValue, dayType) {
    const target = normalizedDate(dateValue);
    if (!target) return [];
    const rows = (Array.isArray(candidates) ? candidates : []).filter(item => item && typeof item === 'object');
    const preferDayType = items => items.sort((a, b) => Number(b.dayType === dayType) - Number(a.dayType === dayType));
    const exact = preferDayType(rows.filter(item => normalizedDate(item.startDate) === target && (!item.dayType || item.dayType === dayType)));
    if (exact.length) return exact;
    const applicable = rows.filter(item => {
      const start = normalizedDate(item.startDate);
      return start && start <= target && (!item.dayType || item.dayType === dayType);
    });
    if (!applicable.length) return [];
    const newest = applicable.map(item => normalizedDate(item.startDate)).sort().at(-1);
    return preferDayType(applicable.filter(item => normalizedDate(item.startDate) === newest));
  }

  function selectForDate(candidates, dateValue, dayType) {
    return versionsForDate(candidates, dateValue, dayType)[0] || null;
  }

  return { normalizedDate, versionsForDate, selectForDate };
});
