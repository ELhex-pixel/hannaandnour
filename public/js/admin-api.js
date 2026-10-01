(function () {
  'use strict';
  var api = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';
  function token() { try { return sessionStorage.getItem('hn-admin-token') || ''; } catch (e) { return ''; } }
  function call(action, data) {
    return fetch(api + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify(Object.assign({ action: action }, data || {})) })
      .then(function (res) { return res.json().then(function (body) { if (!res.ok) throw new Error(body.error || 'Erreur serveur'); return body; }); });
  }
  window.HN_ADMIN = { token: token, call: call };
})();
