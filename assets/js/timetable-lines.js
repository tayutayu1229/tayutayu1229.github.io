(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TayunetTimetableLines = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function clean(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function key(value) {
    return clean(value).toLocaleLowerCase("ja").replace(/[\s　・･()（）\-]/g, "");
  }

  function create(payload) {
    const entries = Array.isArray(payload?.lines) ? payload.lines : [];
    const names = new Map();
    const odptToCanonical = new Map();
    const canonicalToOdpt = new Map();
    const canonicalToRelated = new Map();

    entries.forEach(entry => {
      const canonical = clean(entry?.canonical);
      if (!canonical) return;
      [canonical, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].forEach(name => {
        const lookup = key(name);
        if (lookup) names.set(lookup, canonical);
      });
      const ids = [...new Set((Array.isArray(entry.odpt) ? entry.odpt : []).map(clean).filter(Boolean))];
      canonicalToOdpt.set(canonical, ids);
      canonicalToRelated.set(canonical,
        [...new Set((Array.isArray(entry.related) ? entry.related : []).map(clean).filter(Boolean))]);
      ids.forEach(id => odptToCanonical.set(id, canonical));
    });

    function canonical(value) {
      const original = clean(value);
      if (!original) return "";
      return odptToCanonical.get(original) || names.get(key(original)) || original;
    }

    function searchCanonicals(value) {
      const first = canonical(value);
      if (!first) return [];
      const result = [];
      const pending = [first];
      const visited = new Set();
      while (pending.length) {
        const current = canonical(pending.shift());
        if (!current || visited.has(current)) continue;
        visited.add(current);
        result.push(current);
        (canonicalToRelated.get(current) || []).forEach(name => pending.push(name));
      }
      return result;
    }

    function odptIds(value) {
      return [...new Set(searchCanonicals(value).flatMap(name => canonicalToOdpt.get(name) || []))];
    }

    function matches(left, right) {
      const leftName = canonical(left);
      const rightName = canonical(right);
      return Boolean(leftName && rightName && key(leftName) === key(rightName));
    }

    function matchesForSearch(candidate, selected) {
      const candidateName = canonical(candidate);
      return Boolean(candidateName && searchCanonicals(selected).some(name => key(name) === key(candidateName)));
    }

    function canonicalOptions(trains) {
      return [...new Set((Array.isArray(trains) ? trains : [])
        .map(train => canonical(train?.line))
        .filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja"));
    }

    return Object.freeze({ canonical, searchCanonicals, odptIds, matches, matchesForSearch, canonicalOptions });
  }

  return Object.freeze({ create, normalize: key });
});
