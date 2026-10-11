(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_SIZES = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function canonical(value) {
    var text = String(value == null ? '' : value).trim();
    return /^(one[\s-]*size|taille[\s-]*unique)$/i.test(text) ? 'Taille unique' : text;
  }
  function key(value) { return canonical(value).toLowerCase(); }
  function unique(list) {
    var seen = Object.create(null);
    return (Array.isArray(list) ? list : []).map(canonical).filter(function (size) {
      var normalized = key(size);
      if (!size || seen[normalized]) return false;
      seen[normalized] = true; return true;
    });
  }
  function combination(color, size) { return JSON.stringify([String(color || '').trim().toLowerCase(), key(size)]); }
  function matches(row, color, size) { return combination(row.color, row.size) === combination(color, size); }
  function find(rows, color, size) {
    var list = (rows || []).filter(function (row) { return matches(row, color, size); });
    return list.filter(function (row) { return row.active !== false; })[0] || list[0] || null;
  }
  return { canonical: canonical, key: key, unique: unique, combination: combination, matches: matches, find: find };
});
