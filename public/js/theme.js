/* Applies the persisted admin theme before the page paints (CSP-safe: external
   file, no inline script). The toggle itself lives in admin.js. */
(function () {
  'use strict';
  try {
    if (localStorage.getItem('hn-admin-theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}
})();