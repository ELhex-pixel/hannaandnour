/**
 * Home page: renders the "Bestsellers" grid from the live catalog
 * (admin `is_bestseller` flag) when the API is available.
 * Offline, the static markup stays as-is.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;

  function renderFeed() {
    var grid = document.querySelector('[data-feed="bestsellers"]');
    if (!grid) return;

    HN.loadProducts()
      .then(function (products) {
        var list = (products || []).filter(function (p) {
          return p.active !== false && p.is_bestseller;
        });
        if (!list.length) return; // keep the static markup as a fallback
        var html = '';
        for (var i = 0; i < Math.min(list.length, 4); i++) {
          html += HN.card(list[i]);
        }
        grid.innerHTML = html || grid.innerHTML;
        if (HN.updateWishlistHearts) HN.updateWishlistHearts();
      })
      .catch(function () { /* offline: static markup remains */ });
  }

  renderFeed();
})();