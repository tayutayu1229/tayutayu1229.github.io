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

    entries.forEach(entry => {
      const canonical = clean(entry?.canonical);
      if (!canonical) return;
      [canonical, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].forEach(name => {
        const lookup = key(name);
        if (lookup) names.set(lookup, canonical);
      });
      const ids = [...new Set((Array.isArray(entry.odpt) ? entry.odpt : []).map(clean).filter(Boolean))];
      canonicalToOdpt.set(canonical, ids);
      ids.forEach(id => odptToCanonical.set(id, canonical));
    });

    function canonical(value) {
      const original = clean(value);
      if (!original) return "";
      return odptToCanonical.get(original) || names.get(key(original)) || original;
    }

    function odptIds(value) {
      return [...(canonicalToOdpt.get(canonical(value)) || [])];
    }

    function matches(left, right) {
      const leftName = canonical(left);
      const rightName = canonical(right);
      return Boolean(leftName && rightName && key(leftName) === key(rightName));
    }

    function canonicalOptions(trains) {
      return [...new Set((Array.isArray(trains) ? trains : [])
        .map(train => canonical(train?.line))
        .filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja"));
    }

    return Object.freeze({ canonical, odptIds, matches, canonicalOptions });
  }

  return Object.freeze({ create, normalize: key });
});
