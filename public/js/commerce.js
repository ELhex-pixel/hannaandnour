(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_COMMERCE = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var defaults = { standard_cents: 699, express_cents: 1200, nextday_cents: 2500, pickup_cents: 0, free_threshold_cents: 7500, tax_rate: 0.07, pickup_enabled: true };

  function normalize(items) {
    if (!Array.isArray(items) || !items.length || items.length > 50) throw new Error('Invalid cart');
    var grouped = Object.create(null);
    items.forEach(function (item) {
      if (!item || typeof item.slug !== 'string' || !/^[a-z0-9-]{1,100}$/.test(item.slug)) throw new Error('Invalid cart item');
      var color = String(item.color || '').trim().slice(0, 80);
      var size = String(item.size || '').trim().slice(0, 80);
      var key = JSON.stringify([item.slug, color.toLowerCase(), size.toLowerCase()]);
      var qty = Math.min(10, Math.max(1, parseInt(item.qty, 10) || 1));
      if (!grouped[key]) grouped[key] = { slug: item.slug, color: color, size: size, qty: 0 };
      grouped[key].qty = Math.min(10, grouped[key].qty + qty);
    });
    return Object.keys(grouped).map(function (key) { return grouped[key]; });
  }

  function calculate(items, settings, method, percent) {
    var s = Object.assign({}, defaults, settings || {});
    var subtotal = items.reduce(function (sum, item) {
      if (!Number.isSafeInteger(item.price_cents) || item.price_cents < 1 || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 10) throw new Error('Invalid price or quantity');
      return sum + item.price_cents * item.qty;
    }, 0);
    var pct = Math.min(100, Math.max(0, Number(percent) || 0));
    var discount = Math.round(subtotal * pct / 100);
    var fees = { standard: s.standard_cents, express: s.express_cents, next_day: s.nextday_cents, pickup: s.pickup_cents };
    if (!Object.prototype.hasOwnProperty.call(fees, method)) throw new Error('Invalid shipping method');
    if (method === 'pickup' && !s.pickup_enabled) throw new Error('Pickup unavailable');
    var shipping = method === 'standard' && subtotal >= s.free_threshold_cents ? 0 : fees[method];
    var taxRate = Number(s.tax_rate);
    if (!Number.isSafeInteger(shipping) || shipping < 0 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) throw new Error('Invalid shipping settings');
    var tax = Math.round((subtotal - discount) * taxRate);
    var total = subtotal - discount + shipping + tax;
    if (!Number.isSafeInteger(total)) throw new Error('Invalid total');
    return { subtotal: subtotal, discount: discount, shipping: shipping, tax: tax, total: total };
  }

  function discountedLines(items, discount) {
    var sum = items.reduce(function (n, item) { return n + item.price_cents * item.qty; }, 0);
    if (!Number.isSafeInteger(discount) || discount < 0 || discount > sum) throw new Error('Invalid discount');
    var alloc = items.map(function (item) { return Math.floor(item.price_cents * item.qty * discount / sum); });
    var ranked = items.map(function (item, i) { return { i: i, fraction: item.price_cents * item.qty * discount / sum - alloc[i] }; });
    ranked.sort(function (a, b) { return b.fraction - a.fraction || a.i - b.i; });
    var remainder = discount - alloc.reduce(function (a, b) { return a + b; }, 0);
    for (var i = 0; i < remainder; i++) alloc[ranked[i].i]++;
    var lines = [];
    items.forEach(function (item, index) {
      var net = item.price_cents * item.qty - alloc[index];
      var unit = Math.floor(net / item.qty);
      var extra = net % item.qty;
      if (extra) lines.push({ item: item, quantity: extra, unit_amount: unit + 1 });
      if (item.qty > extra) lines.push({ item: item, quantity: item.qty - extra, unit_amount: unit });
    });
    return lines;
  }

  return { defaults: defaults, normalize: normalize, calculate: calculate, discountedLines: discountedLines };
});
