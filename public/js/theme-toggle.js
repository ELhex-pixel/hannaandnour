/* Câble les boutons .theme-toggle (admin + site). Chargé en bas de page,
   après theme.js (qui expose window.HNTheme). */
(function () {
  'use strict';
  if (window.HNTheme && typeof window.HNTheme.wire === 'function') {
    window.HNTheme.wire();
  }
})();