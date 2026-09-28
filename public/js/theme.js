/* Theme partagé admin + site : applique le thème persisté avant la peinture
   (CSP-safe : fichier externe, aucun script inline). Clé localStorage : hn-theme
   (migration automatique depuis l'ancienne clé admin hn-admin-theme).
   La bascule des boutons est assurée par js/theme-toggle.js (bas de page). */
(function () {
  'use strict';
  var KEY = 'hn-theme';
  var LEGACY_KEY = 'hn-admin-theme';
  var MOON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
  var SUN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';

  function readTheme() {
    var t = null;
    try {
      t = localStorage.getItem(KEY);
      if (t === null) {
        var legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy !== null) {
          t = legacy;
          localStorage.setItem(KEY, legacy);
          localStorage.removeItem(LEGACY_KEY);
        }
      }
    } catch (e) {}
    return t === 'dark' ? 'dark' : 'light';
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    var dark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    document.querySelectorAll('.theme-toggle').forEach(function (b) {
      b.innerHTML = dark ? SUN_SVG : MOON_SVG;
      b.title = dark ? 'Passer en mode clair' : 'Passer en mode sombre';
      b.setAttribute('aria-label', b.title);
    });
  }

  function wire() {
    applyTheme(currentTheme());
    document.querySelectorAll('.theme-toggle').forEach(function (b) {
      b.addEventListener('click', function () {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    });
  }

  try {
    if (readTheme() === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {}

  window.HNTheme = {
    currentTheme: currentTheme,
    applyTheme: applyTheme,
    wire: wire
  };
})();