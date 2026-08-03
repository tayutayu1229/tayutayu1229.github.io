(() => {
  'use strict';

  if (window.TayunetCalendar) return;
  const cache = new Map();
  const pad = value => String(value).padStart(2, '0');
  const key = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dateAt = (year, month, day) => new Date(year, month - 1, day, 12, 0, 0);
  const addDays = (date, amount) => {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  };
  const nthMonday = (year, month, nth) => {
    const first = dateAt(year, month, 1);
    return 1 + ((8 - first.getDay()) % 7) + (nth - 1) * 7;
  };
  const vernalEquinox = year => Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumnEquinox = year => Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));

  function holidaysForYear(year) {
    if (cache.has(year)) return cache.get(year);
    const holidays = new Set();
    const add = (month, day) => holidays.add(key(dateAt(year, month, day)));

    add(1, 1);
    add(1, nthMonday(year, 1, 2));
    add(2, 11);
    if (year >= 2020) add(2, 23);
    add(3, vernalEquinox(year));
    add(4, 29);
    add(5, 3); add(5, 4); add(5, 5);
    add(7, nthMonday(year, 7, 3));
    if (year >= 2016) add(8, 11);
    add(9, nthMonday(year, 9, 3));
    add(9, autumnEquinox(year));
    add(10, nthMonday(year, 10, 2));
    add(11, 3); add(11, 23);

    // 国民の祝日に挟まれた平日を「国民の休日」にする。
    for (let date = dateAt(year, 1, 2); date.getFullYear() === year; date = addDays(date, 1)) {
      const current = key(date);
      if (!holidays.has(current) && holidays.has(key(addDays(date, -1))) && holidays.has(key(addDays(date, 1)))) holidays.add(current);
    }

    // 日曜の祝日は、次の祝日ではない日を振替休日にする。
    [...holidays].forEach(holidayKey => {
      const holiday = new Date(`${holidayKey}T12:00:00`);
      if (holiday.getDay() !== 0) return;
      let substitute = addDays(holiday, 1);
      while (holidays.has(key(substitute))) substitute = addDays(substitute, 1);
      holidays.add(key(substitute));
    });

    cache.set(year, holidays);
    return holidays;
  }

  function isHoliday(date = new Date()) {
    return holidaysForYear(date.getFullYear()).has(key(date));
  }

  window.TayunetCalendar = Object.freeze({
    dateKey: key,
    isHoliday,
    odptCalendar(date = new Date()) {
      return date.getDay() === 0 || date.getDay() === 6 || isHoliday(date) ? 'SaturdayHoliday' : 'Weekday';
    },
    dayType(date = new Date()) {
      return date.getDay() === 0 || date.getDay() === 6 || isHoliday(date) ? '土休日' : '平日';
    }
  });
})();
