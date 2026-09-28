/**
 * Reset password page: consumes the recovery token from the Supabase reset
 * email (hash fragment) and asks for a new password. Uses HN_AUTH.updatePassword
 * which talks to /api/auth (updatePassword).
 */
(function () {
  'use strict';

  function tr(key) {
    return window.I18n && typeof window.I18n.t === 'function' ? window.I18n.t(key) : key;
  }

  function show(el, block) {
    if (el) el.style.display = block ? 'block' : '';
  }

  function parseHash() {
    var h = window.location.hash || '';
    if (!h) return {};
    var out = {};
    h.replace(/^#/, '').split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) {
        try { out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }
        catch (e) { out[p[0]] = p[1] || ''; }
      }
    });
    return out;
  }

  var form = document.getElementById('resetForm');
  var doneEl = document.getElementById('resetDone');
  var invalidEl = document.getElementById('resetInvalid');
  var errEl = document.getElementById('resetError');
  var passInput = document.getElementById('resetPassword');
  var submitBtn = document.getElementById('resetSubmit');

  function showInvalid() {
    if (form) show(form, false);
    show(doneEl, false);
    show(invalidEl, true);
  }

  var params = parseHash();
  var token = params.access_token || '';
  var type = params.type || '';

  if (!form || !token || type !== 'recovery') {
    showInvalid();
  } else {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (errEl) errEl.style.display = 'none';
      var password = passInput ? passInput.value : '';
      if (password.length < 6) {
        if (errEl) {
          errEl.textContent = tr('resetMin');
          errEl.style.display = 'block';
          errEl.classList.add('auth-msg-error');
        }
        return;
      }
      if (submitBtn) submitBtn.disabled = true;
      window.HN_AUTH.updatePassword(token, password)
        .then(function () {
          show(form, false);
          show(doneEl, true);
        })
        .catch(function () {
          if (submitBtn) submitBtn.disabled = false;
          if (errEl) {
            errEl.textContent = tr('authGenericError');
            errEl.style.display = 'block';
            errEl.classList.add('auth-msg-error');
          }
        });
    });
  }
})();