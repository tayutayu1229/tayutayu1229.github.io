(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TayunetTimetableFields = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function text(value) {
    return String(value ?? '').trim();
  }

  function explicitType(stop) {
    return text(stop?.trainType ?? stop?.typeChange ?? '');
  }

  function typeAtStop(train, index) {
    let current = text(train?.type);
    const stops = Array.isArray(train?.stops) ? train.stops : [];
    for (let position = 0; position <= index && position < stops.length; position += 1) {
      const changed = explicitType(stops[position]);
      if (changed) current = changed;
    }
    return current;
  }

  function displayedType(train, stop, index) {
    const changed = explicitType(stop);
    if (changed) return changed;
    return index === 0 ? text(train?.type) : '';
  }

  function footnotes(train) {
    const values = Array.isArray(train?.footnotes)
      ? train.footnotes
      : typeof train?.footnote === 'string' ? train.footnote.split(/\r?\n/) : [];
    return values.map(text).filter(Boolean);
  }

  return { explicitType, typeAtStop, displayedType, footnotes };
});
