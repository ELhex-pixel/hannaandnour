(function () {
  'use strict';
  var HN = window.HN, rules = window.HN_PICKUP;
  if (!HN || !rules) return;
  window.HN_PICKUP_SELECTOR = function (root, onChange) {
    var selected = null, revision = 0, active = false, locked = false, busy = false, fixedCountry = false;
    root.className = 'pickup-selector';
    root.innerHTML = '<form id="pickupSearchForm"><div class="form-row"><div class="form-group"><label class="form-label" for="pickupCountry" data-i18n="countryLabel"></label><select class="form-select" id="pickupCountry"></select></div>' +
      '<div class="form-group"><label class="form-label" for="pickupPostalCode" data-i18n="postalLabel"></label><input class="form-input" id="pickupPostalCode" autocomplete="postal-code" maxlength="12" dir="ltr" required></div></div>' +
      '<button type="submit" class="btn btn-secondary" id="pickupSearchButton" data-i18n="pickupSearch"></button></form>' +
      '<p id="pickupSearchStatus" role="status" aria-live="polite"></p><fieldset id="pickupResults"><legend data-i18n="pickupChoose"></legend><div id="pickupOptions"></div></fieldset>';
    var country = root.querySelector('#pickupCountry'), postal = root.querySelector('#pickupPostalCode');
    var button = root.querySelector('#pickupSearchButton'), status = root.querySelector('#pickupSearchStatus');
    var results = root.querySelector('#pickupResults'), options = root.querySelector('#pickupOptions');
    rules.countries.forEach(function (code) { var option = document.createElement('option'); option.value = code; option.setAttribute('data-i18n', 'pickupCountry' + code); country.appendChild(option); });
    function translate() {
      root.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = HN.tr(el.getAttribute('data-i18n')); });
      postal.placeholder = { FR: '75001', BE: '1000', ES: '28001', NL: '1234 AB', DE: '10115', IT: '00118' }[country.value] || '';
      postal.inputMode = country.value === 'NL' ? 'text' : 'numeric';
    }
    function controls() {
      country.disabled = locked || fixedCountry; postal.disabled = locked; button.disabled = locked || busy || !active || !rules.country(country.value);
      options.querySelectorAll('input').forEach(function (input) { input.disabled = locked; });
      results.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    function clear(message) {
      revision++; selected = null; busy = false; options.textContent = ''; results.hidden = true;
      status.textContent = message ? HN.tr(message) : ''; controls(); onChange();
    }
    function validPoint(point) {
      return point && point.address && point.address.country_code === country.value && typeof point.name === 'string'
        && typeof point.address.street === 'string' && typeof point.address.city === 'string' && !!rules.postal(country.value, point.address.postal_code)
        && rules.selection({ id: point.id, country_code: country.value, fingerprint: point.fingerprint }) && ['servicepoint','locker'].indexOf(point.type) >= 0;
    }
    function showPoints(points) {
      points.forEach(function (point, index) {
        var label = document.createElement('label'), radio = document.createElement('input'), copy = document.createElement('span');
        var name = document.createElement('strong'), address = document.createElement('span'), type = document.createElement('span');
        label.className = 'pickup-option'; radio.type = 'radio'; radio.name = 'pickupPointChoice'; radio.id = 'pickupChoice' + index; radio.value = String(point.id);
        name.textContent = point.name; address.textContent = rules.address(point); type.textContent = HN.tr(point.type === 'locker' ? 'pickupLocker' : 'pickupShop');
        type.setAttribute('data-i18n', point.type === 'locker' ? 'pickupLocker' : 'pickupShop');
        copy.appendChild(name); copy.appendChild(address); copy.appendChild(type); label.appendChild(radio); label.appendChild(copy); options.appendChild(label);
        radio.addEventListener('change', function () {
          if (locked || !active || !radio.checked) return;
          selected = { id: point.id, country_code: point.address.country_code, fingerprint: point.fingerprint };
          status.textContent = HN.tr('pickupSelected') + ' ' + point.name; onChange();
        });
      });
      results.hidden = !points.length;
    }
    country.addEventListener('change', function () { if (!locked) { postal.value = ''; clear(); translate(); } });
    postal.addEventListener('input', function () { if (!locked) clear(); });
    root.querySelector('form').addEventListener('submit', function (event) {
      event.preventDefault(); if (locked || busy || !active) return;
      clear();
      var code = country.value, value = rules.postal(code, postal.value);
      if (!value) { status.textContent = HN.tr('pickupInvalidPostal'); postal.focus(); return; }
      postal.value = value; var request = revision; busy = true; controls(); status.textContent = HN.tr('pickupSearching');
      HN.request(HN.api('service-points') + '?country_code=' + encodeURIComponent(code) + '&postal_code=' + encodeURIComponent(value))
        .then(function (data) {
          if (request !== revision || !active) return;
          if (!data || !Array.isArray(data.points) || data.points.length > 20 || !data.points.every(validPoint)) throw new Error('Invalid service points');
          showPoints(data.points); status.textContent = HN.tr(data.points.length ? 'pickupChoose' : 'pickupEmpty');
        }).catch(function () { if (request === revision && active) { selected = null; options.textContent = ''; results.hidden = true; status.textContent = HN.tr('pickupUnavailable'); onChange(); } })
        .then(function () { if (request === revision) { busy = false; controls(); } });
    });
    document.addEventListener('langchange', function () { translate(); status.textContent = HN.tr(busy ? 'pickupSearching' : selected ? 'pickupSelected' : 'pickupChoose'); });
    translate(); results.hidden = true; controls();
    return {
      value: function () { return active ? selected : null; },
      setCountry: function (code) { fixedCountry = true; if (country.value !== code) { country.value = rules.country(code); postal.value = ''; clear(); translate(); } controls(); },
      setActive: function (value) { var next = !!value; root.hidden = !next; if (active !== next) { active = next; clear(); } },
      lock: function (value) { locked = !!value; controls(); },
      invalidate: function (message) { clear(message || 'pickupChoose'); },
      focus: function () { (options.querySelector('input') || postal).focus(); }
    };
  };
})();
