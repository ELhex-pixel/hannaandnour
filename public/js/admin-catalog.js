(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_ADMIN_CATALOG = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function normalize(value) {
    var text = String(value == null ? '' : value).toLowerCase();
    return text.normalize ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
  }
  function name(product) { return product.name_fr || product.name_en || product.slug || ''; }
  function validStock(value) { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000000; }
  function stock(product) {
    var variants = product.variants || [];
    var enabled = variants.filter(function (v) { return v.active !== false; });
    var invalid = variants.some(function (v) { return !validStock(v.stock); });
    var total = enabled.reduce(function (n, v) { return n + (validStock(v.stock) ? v.stock : 0); }, 0);
    var state = !variants.length ? 'unconfigured' : invalid ? 'invalid' : !enabled.length ? 'disabled' : total === 0 ? 'empty' : 'available';
    return { state: state, total: total, count: variants.length, enabled: enabled.length, low: enabled.some(function (v) { return validStock(v.stock) && v.stock > 0 && v.stock <= 5; }) };
  }
  function matchesStock(product, filter) {
    if (!filter || filter === 'all') return true;
    var summary = stock(product);
    if (filter === 'configured') return summary.count > 0;
    if (filter === 'low') return summary.state === 'available' && summary.low;
    return summary.state === filter;
  }
  function stockLabel(summary) {
    return { unconfigured: 'Stock non configuré', invalid: 'Stock à vérifier', disabled: 'Variantes désactivées', empty: 'Épuisé' }[summary.state] || summary.total + ' disponibles';
  }
  function stockBadge(summary) { return { unconfigured: 'badge-warn', invalid: 'badge-warn', disabled: 'badge-gray', empty: 'badge-red' }[summary.state] || 'badge-green'; }
  function matchesProduct(product, options) {
    if (options.visibility === 'active' && product.active === false) return false;
    if (options.visibility === 'inactive' && product.active !== false) return false;
    if (options.category && product.category !== options.category) return false;
    if (!matchesStock(product, options.stock)) return false;
    var query = normalize(options.query).trim();
    return !query || normalize([product.name_fr, product.name_en, product.name_ar, product.slug, product.sku, product.category].join(' ')).indexOf(query) >= 0;
  }
  function sort(products, order) {
    return products.slice().sort(function (a, b) {
      var delta = 0;
      if (order === 'price-asc' || order === 'price-desc') delta = (a.price_cents || 0) - (b.price_cents || 0);
      if (order === 'stock-asc' || order === 'stock-desc') {
        var sa = stock(a), sb = stock(b);
        var knownA = sa.state === 'empty' || sa.state === 'available', knownB = sb.state === 'empty' || sb.state === 'available';
        if (knownA !== knownB) return knownA ? -1 : 1;
        delta = sa.total - sb.total;
      }
      if (order === 'recent') delta = (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
      if (order === 'price-desc' || order === 'stock-desc') delta = -delta;
      return delta || normalize(name(a)).localeCompare(normalize(name(b)), 'fr', { numeric: true }) || String(a.id || '').localeCompare(String(b.id || ''));
    });
  }
  function page(list, number, size) {
    size = [10, 25, 50].indexOf(Number(size)) >= 0 ? Number(size) : 10;
    var pages = Math.max(1, Math.ceil(list.length / size));
    number = Math.max(1, Math.min(pages, Math.floor(Number(number) || 1)));
    var start = (number - 1) * size;
    return { items: list.slice(start, start + size), number: number, pages: pages, total: list.length, first: list.length ? start + 1 : 0, last: Math.min(start + size, list.length) };
  }
  function updatePager(doc, prefix, result) {
    doc.getElementById(prefix + 'Results').textContent = result.first + '–' + result.last + ' sur ' + result.total + ' produit(s)';
    doc.getElementById(prefix + 'Page').textContent = 'Page ' + result.number + ' / ' + result.pages;
    doc.getElementById(prefix + 'Previous').disabled = result.number === 1;
    doc.getElementById(prefix + 'Next').disabled = result.number === result.pages;
  }
  return { normalize: normalize, name: name, validStock: validStock, stock: stock, matchesStock: matchesStock, stockLabel: stockLabel, stockBadge: stockBadge, matchesProduct: matchesProduct, sort: sort, page: page, updatePager: updatePager };
});
