(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_SHIPPING = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var countries = ['FR', 'BE', 'NL', 'DE', 'ES', 'IT', 'DZ'];
  var pickupCountries = ['FR', 'BE', 'NL', 'DE', 'ES', 'IT'];
  var methods = ['standard', 'pickup', 'express', 'next_day'];
  var fields = { standard: 'standard_cents', pickup: 'pickup_cents', express: 'express_cents', next_day: 'nextday_cents' };
  function country(value) { return typeof value === 'string' && countries.indexOf(value.toUpperCase()) >= 0 ? value.toUpperCase() : ''; }
  function amount(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 100000000; }
  function clean(value) {
    if (!value || value.version !== 1 || !value.countries || typeof value.countries !== 'object' || Array.isArray(value.countries) || Object.keys(value.countries).length !== countries.length) throw new Error('Invalid shipping rules');
    var result = { version: 1, countries: {} };
    countries.forEach(function (code) {
      var row = value.countries[code];
      if (!row || typeof row.enabled !== 'boolean') throw new Error('Invalid shipping country');
      var entry = { enabled: row.enabled };
      methods.forEach(function (method) {
        var option = row[method];
        if (!option || typeof option.enabled !== 'boolean' || (option.fee_cents !== null && !amount(option.fee_cents)) || (option.enabled && !(option.fee_cents > 0))) throw new Error('Invalid shipping fee');
        if (method === 'pickup' && code === 'DZ' && option.enabled) throw new Error('Pickup unavailable');
        entry[method] = { enabled: option.enabled, fee_cents: option.fee_cents };
        if (method === 'pickup') {
          if (typeof option.free_enabled !== 'boolean' || !amount(option.free_threshold_cents) || option.free_threshold_cents < 1 || (code === 'DZ' && option.free_enabled)) throw new Error('Invalid pickup free threshold');
          entry[method].free_enabled = option.free_enabled;
          entry[method].free_threshold_cents = option.free_threshold_cents;
        }
      });
      result.countries[code] = entry;
    });
    return result;
  }
  function initial(legacy) {
    legacy = legacy || {};
    var fallback = { standard: 699, pickup: 0, express: 1200, next_day: 2500 };
    var value = { version: 1, countries: {} };
    countries.forEach(function (code) {
      var existing = ['FR', 'BE', 'NL', 'ES'].indexOf(code) >= 0;
      var row = { enabled: existing };
      methods.forEach(function (method) {
        var fee = existing ? (legacy[fields[method]] === undefined ? fallback[method] : legacy[fields[method]]) : null;
        if (!amount(fee)) fee = null;
        row[method] = { enabled: existing && fee > 0 && (method !== 'pickup' || legacy.pickup_enabled !== false), fee_cents: fee };
        if (method === 'pickup') { row[method].free_enabled = code !== 'DZ'; row[method].free_threshold_cents = 8000; }
      });
      value.countries[code] = row;
    });
    return clean(value);
  }
  function resolve(value, legacy) { return value == null ? initial(legacy) : clean(value); }
  function enabled(rules, code, method) {
    code = country(code);
    var row = rules && rules.countries && rules.countries[code];
    return !!(row && row.enabled && methods.indexOf(method) >= 0 && row[method] && row[method].enabled && amount(row[method].fee_cents) && row[method].fee_cents > 0 && (method !== 'pickup' || pickupCountries.indexOf(code) >= 0));
  }
  function price(rules, code, method, subtotal) {
    if (!Number.isSafeInteger(subtotal) || subtotal < 0 || !enabled(rules, code, method)) throw new Error('Shipping unavailable');
    var row = rules.countries[country(code)][method];
    return method === 'pickup' && row.free_enabled && subtotal >= row.free_threshold_cents ? 0 : row.fee_cents;
  }
  function destinations(rules, method) {
    return countries.filter(function (code) { return method ? enabled(rules, code, method) : rules.countries[code].enabled && methods.some(function (m) { return enabled(rules, code, m); }); });
  }
  return { countries: countries, pickupCountries: pickupCountries, methods: methods, country: country, clean: clean, initial: initial, resolve: resolve, enabled: enabled, price: price, destinations: destinations };
});
