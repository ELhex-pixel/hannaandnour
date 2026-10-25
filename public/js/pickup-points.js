(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_PICKUP = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var countries = ['FR', 'BE', 'ES', 'NL', 'DE', 'IT'];
  var patterns = { FR: /^(?:0[1-9]|[1-8]\d|9[0-5])\d{3}$/, BE: /^[1-9]\d{3}$/, ES: /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/, NL: /^[1-9]\d{3} [A-Z]{2}$/, DE: /^(?!00000)\d{5}$/, IT: /^(?!00000)\d{5}$/ };
  function country(value) { return typeof value === 'string' && countries.indexOf(value.toUpperCase()) >= 0 ? value.toUpperCase() : ''; }
  function postal(code, value) {
    code = country(code);
    if (!code || typeof value !== 'string' || value.length > 12) return '';
    var clean = value.trim().toUpperCase();
    if (code === 'NL') clean = clean.replace(/^([1-9]\d{3})\s?([A-Z]{2})$/, '$1 $2');
    return patterns[code].test(clean) ? clean : '';
  }
  function selection(value) {
    return !!value && Number.isSafeInteger(value.id) && value.id > 0 && country(value.country_code) === value.country_code
      && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint);
  }
  function address(point) {
    var a = point.address;
    return [a.house_number, a.street, a.postal_code, a.city, a.country_code].filter(Boolean).join(' ');
  }
  return { countries: countries, country: country, postal: postal, selection: selection, address: address };
});
