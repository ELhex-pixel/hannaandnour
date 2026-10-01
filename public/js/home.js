/**
 * Home page: renders the "Bestsellers" grid, the "Achetez par collection"
 * cards and the testimonials section from admin-curated data (/api/config
 * key `home` + the active demo reviews) when the API is available.
 * Offline, the static markup stays as-is.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fiveStars() {
    var s = '';
    for (var i = 0; i < 5; i++) {
      s += '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
    }
    return s;
  }

  // Bestsellers: admin order first (settings `home.bestsellers`), then the
  // `is_bestseller` flag as a fallback. max is bestsellers_count (default 4).
  function renderFeed(products, home) {
    var grid = document.querySelector('[data-feed="bestsellers"]');
    if (!grid) return;

    var list = [];
    if (home && Array.isArray(home.bestsellers) && home.bestsellers.length) {
      var n = Math.max(1, parseInt(home.bestsellers_count, 10) || 4);
      home.bestsellers.forEach(function (slug) {
        for (var i = 0; i < products.length; i++) {
          if (products[i].slug === slug && products[i].active !== false) {
            list.push(products[i]);
            break;
          }
        }
      });
      list = list.slice(0, n);
    }
    if (!list.length) {
      list = (products || []).filter(function (p) { return p.active !== false && p.is_bestseller; });
    }
    if (!list.length) return; // keep the static markup as a fallback

    var html = '';
    for (var j = 0; j < list.length; j++) html += HN.card(list[j]);
    grid.innerHTML = html || grid.innerHTML;
    if (HN.updateWishlistHearts) HN.updateWishlistHearts();
  }

  // Collection cards: admin-managed (title / image / link / order).
  function renderCollections(home) {
    var grid = document.querySelector('[data-feed="collections"]');
    if (!grid) return;
    if (!home || !Array.isArray(home.collections) || !home.collections.length) return;
    var html = home.collections.map(function (c) {
      return '<a href="' + esc(c.url || 'collections.html') + '" class="collection-card">' +
        '<img src="' + esc(c.image || 'images/hero.jpg') + '" alt="">' +
        '<div class="collection-card-overlay">' +
        '<h3 class="collection-card-title">' + esc(c.title || '') + '</h3>' +
        '<p class="collection-card-desc">' + esc(c.subtitle || '') + '</p>' +
        '<span class="collection-card-more">Voir plus</span>' +
        '</div></a>';
    }).join('');
    grid.innerHTML = html;
  }

  // Testimonials: fed by the admin demo reviews (only when the illustration is ON).
  function renderTestimonials(demoReviews) {
    var grid = document.querySelector('[data-feed="testimonials"]');
    if (!grid) return;
    if (!demoReviews || !demoReviews.length) return; // keep static fallback
    var html = demoReviews.slice(0, 3).map(function (r) {
      return '<div class="testimonial-card">' +
        '<div class="testimonial-stars">' + fiveStars() + '</div>' +
        '<p class="testimonial-text">' + esc(r.body) + '</p>' +
        '<div class="testimonial-author">' +
        '<div class="testimonial-avatar">' + esc((r.author_name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div><p class="testimonial-name">' + esc(r.author_name) + '</p>' +
        '<p class="testimonial-location">' + esc(r.location || '') + '</p></div></div></div>';
    }).join('');
    grid.innerHTML = html || grid.innerHTML;
  }

  function init() {
    HN.loadConfig()
      .then(function (cfg) {
        cfg = cfg || {};
        var slugs = cfg.home && cfg.home.bestsellers;
        var products = Array.isArray(slugs) && slugs.length ? HN.loadProductSlugs(slugs) : HN.fetchProducts({ bestseller: true, limit: 48 });
        return products.then(function (items) { return { products: items, cfg: cfg }; });
      })
      .then(function (res) {
        var cfg = res.cfg;
        var home = cfg.home || null;
        renderFeed(res.products, home);
        renderCollections(home);
        if (cfg.reviews && cfg.reviews.show_demo) {
          return fetch(HN.api('reviews') + '?demo=true')
            .then(function (r) { return r.json(); })
            .then(function (d) { renderTestimonials(d.reviews || []); })
            .catch(function () { /* offline: keep static testimonials */ });
        }
        return null;
      })
      .catch(function () { /* offline: static content remains */ });
  }

  init();
})();
