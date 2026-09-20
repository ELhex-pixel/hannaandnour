/**
 * Shop page: renders the real product catalog (from store.js),
 * handles filters, sorting and pagination.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var PAGE_SIZE = 8;
  var state = {
    items: [],
    source: 'api', // 'api' | 'static'
    categories: [],
    colors: [],
    sizes: [],
    fabrics: [],
    occasions: [],
    minCents: null,
    maxCents: null,
    sort: 'featured',
    page: 1,
    filtersOpen: false
  };

  var grid = document.getElementById('productsGrid');
  var loadMoreBtn = document.getElementById('loadMore');
  var resultsEl = document.querySelector('.shop-results');
  var activeFiltersEl = document.getElementById('activeFilters');

  function normalizeCategory(cat) {
    var m = { hijabs: 'hijab', hijab: 'hijab', abayas: 'abaya', abaya: 'abaya', dresses: 'dress', dress: 'dress', prayer: 'prayer', prayerwear: 'prayer', accessories: 'accessory', accessory: 'accessory' };
    return m[String(cat || '').toLowerCase().replace(/[\s_-]/g, '')] || String(cat || '').toLowerCase();
  }

  function catKey(cat) {
    return { hijab: 'catHijabs', abaya: 'catAbayas', dress: 'catDresses', prayer: 'catPrayerWear', accessory: 'catAccessories' }[cat] || 'catHijabs';
  }

  function readValue(list, value) {
    if (!list) return false;
    if (typeof list === 'string') list = [list];
    if (!Array.isArray(list)) return false;
    return list.some(function (v) {
      return String(v || '').toLowerCase() === String(value || '').toLowerCase();
    });
  }

  function buildCard(p) {
    var link = 'product.html?slug=' + encodeURIComponent(p.slug);
    var name = HN.productName(p);
    var price = HN.money(p.price_cents);
    var original = p.compare_at_price_cents ? HN.money(p.compare_at_price_cents) : null;
    var badge = p.badge ? (p.badge.toLowerCase() === 'bestseller' ? 'Bestseller' : p.badge) : null;
    var stars = Math.round(parseFloat(p.rating) || 0);
    if (stars < 1) stars = 0;
    var starStr = '';
    for (var s = 0; s < stars; s++) starStr += '\u2605';
    for (var e = stars; e < 5; e++) starStr += '\u2606';
    var count = p.review_count || 0;

    return '' +
      '<div class="product-card" data-slug="' + p.slug + '" data-category="' + p.category + '" data-price-cents="' + p.price_cents + '" data-rating="' + (p.rating || 0) + '">' +
      '  <a href="' + link + '" class="product-card-image" style="display:block;">' +
      '    <img src="' + (p.image || 'images/hero.jpg') + '" alt="' + name.replace(/"/g, '&quot;') + '" loading="lazy">' +
      (badge ? '    <span class="product-badge">' + badge + '</span>' : '') +
      '  </a>' +
      '  <button class="product-wishlist" aria-label="Wishlist"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg></button>' +
      '  <div class="product-card-quick-add"><button class="btn btn-primary btn-sm">' + tr('quickAdd') + '</button></div>' +
      '  <div class="product-card-info">' +
      '    <span class="product-card-category">' + tr(catKey(p.category)) + '</span>' +
      '    <a href="' + link + '"><h3 class="product-card-title">' + name + '</h3></a>' +
      '    <div class="product-card-price">' +
      '      <span class="product-price-current">' + price + '</span>' +
      (original ? '<span class="product-price-original">' + original + '</span>' : '') +
      '    </div>' +
      '    <div class="product-card-rating"><span class="stars">' + starStr + '</span><span class="rating-count">(' + count + ')</span></div>' +
      '  </div>' +
      '</div>';
  }

  /* ---- Load items: API first, static cards as fallback ---- */

  function itemsFromStaticCards() {
    var cards = grid ? grid.querySelectorAll('.product-card') : [];
    var items = [];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      items.push({
        slug: c.getAttribute('data-slug') || c.getAttribute('data-category'),
        category: normalizeCategory(c.getAttribute('data-category')),
        price_cents: parseInt(c.getAttribute('data-price-cents'), 10) ||
          (parseInt(c.getAttribute('data-price'), 10) || 0) * 100,
        name_en: c.getAttribute('data-name') || tr('productFallback'),
        image: c.getAttribute('data-image') || '',
        rating: parseFloat(c.getAttribute('data-rating')) || 0,
        review_count: 0,
        colors: [], sizes: [], fabrics: [], occasions: [],
        compare_at_price_cents: null, badge: null
      });
    }
    return items;
  }

  function loadItems() {
    return HN.loadProducts().then(function (products) {
      state.items = (products || []).filter(function (p) { return p.active !== false; });
      state.source = 'api';
    }).catch(function () {
      state.items = itemsFromStaticCards();
      state.source = 'static';
    });
  }

  /* ---- Filter / sort ---- */

  function applyFilters() {
    var minCents = state.minCents, maxCents = state.maxCents;
    var list = state.items.filter(function (p) {
      if (state.categories.length && state.categories.indexOf(p.category) === -1) return false;
      if (state.colors.length && !state.colors.some(function (c) { return readValue(p.colors, c); })) return false;
      if (state.sizes.length && !state.sizes.some(function (s) { return readValue(p.sizes, s); })) return false;
      if (state.fabrics.length && !state.fabrics.some(function (f) { return readValue(p.fabrics, f); })) return false;
      if (state.occasions.length && !state.occasions.some(function (o) { return readValue(p.occasions, o); })) return false;
      if (minCents !== null && (p.price_cents || 0) < minCents) return false;
      if (maxCents !== null && (p.price_cents || 0) > maxCents) return false;
      return true;
    });

    list.sort(function (a, b) {
      switch (state.sort) {
        case 'price-asc': return (a.price_cents || 0) - (b.price_cents || 0);
        case 'price-desc': return (b.price_cents || 0) - (a.price_cents || 0);
        case 'rating': return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
        case 'newest': return String(b.created_at || '').localeCompare(String(a.created_at || ''));
        default: return 0;
      }
    });
    return list;
  }

  function render() {
    if (!grid) return;
    var list = applyFilters();
    var start = 0;
    var end = Math.min(list.length, state.page * PAGE_SIZE);
    var visible = list.slice(start, end);

    var html = '';
    for (var i = 0; i < visible.length; i++) html += buildCard(visible[i]);

    grid.innerHTML = html || '<p class="text-center" style="grid-column:1/-1; padding: var(--spacing-2xl) 0;">' + tr('emptyCatalog') + '</p>';
    if (HN) HN.updateWishlistHearts();

    if (resultsEl) {
      resultsEl.textContent = tr('showingResults', { visible: visible.length, total: list.length });
    }
    if (loadMoreBtn) {
      var more = list.length > end;
      loadMoreBtn.style.display = more ? '' : 'none';
    }
    updateActiveFilters();
  }

  /* ---- Active filter tags ---- */

  function updateActiveFilters() {
    if (!activeFiltersEl) return;
    var tags = [];
    state.categories.forEach(function (c) {
      tags.push({ text: tr(catKey(c)), remove: function () { state.categories = []; setFilterControls(); render(); } });
    });
    state.fabrics.forEach(function (f) { tags.push({ text: f, remove: function () { state.fabrics = []; setFilterControls(); render(); } }); });
    state.occasions.forEach(function (o) { tags.push({ text: o, remove: function () { state.occasions = []; setFilterControls(); render(); } }); });

    activeFiltersEl.textContent = '';
    if (!tags.length) {
      var tag = document.createElement('span');
      tag.className = 'filter-tag';
      tag.textContent = tr('allProducts') + ' ';
      activeFiltersEl.appendChild(tag);
      return;
    }
    tags.forEach(function (item) {
      var t = document.createElement('span');
      t.className = 'filter-tag';
      t.textContent = item.text + ' ';
      var rm = document.createElement('button');
      rm.className = 'filter-tag-remove';
      rm.setAttribute('aria-label', 'Remove');
      rm.textContent = '\u00d7';
      rm.addEventListener('click', item.remove);
      t.appendChild(rm);
      activeFiltersEl.appendChild(t);
    });
  }

  /* ---- Filter controls ---- */

  function toggleIn(arr, value) {
    var idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
  }

  function setFilterControls() {
    document.querySelectorAll('.filter-option').forEach(function (opt) {
      var val = opt.getAttribute('data-value');
      var group = opt.getAttribute('data-group');
      var active = false;
      if (group === 'category') active = state.categories.indexOf(val) >= 0;
      if (group === 'size') active = state.sizes.indexOf(val) >= 0;
      if (group === 'fabric') active = state.fabrics.indexOf(val) >= 0;
      if (group === 'occasion') active = state.occasions.indexOf(val) >= 0;
      opt.classList.toggle('active', active);
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function wireFilters() {
    document.querySelectorAll('.filter-title').forEach(function (title) {
      title.addEventListener('click', function () {
        this.classList.toggle('collapsed');
        var options = this.nextElementSibling;
        if (options) options.style.display = options.style.display === 'none' ? '' : 'none';
      });
    });

    document.querySelectorAll('.filter-option[data-group]').forEach(function (opt) {
      opt.addEventListener('click', function () {
        var group = this.getAttribute('data-group');
        var val = this.getAttribute('data-value') || '';
        if (group === 'category' && val === '') {
          state.categories = [];
          this.classList.add('active');
        } else if (group === 'category') {
          toggleIn(state.categories, val);
        } else if (group === 'size') { toggleIn(state.sizes, val); }
        else if (group === 'fabric') { toggleIn(state.fabrics, val); }
        else if (group === 'occasion') { toggleIn(state.occasions, val); }
        state.page = 1;
        setFilterControls();
        render();
      });
    });

    document.querySelectorAll('.color-swatch[data-color]').forEach(function (sw) {
      sw.addEventListener('click', function () {
        var val = this.getAttribute('data-color');
        toggleIn(state.colors, val);
        this.classList.toggle('active', state.colors.indexOf(val) >= 0);
        state.page = 1;
        render();
      });
    });

    var inputs = document.querySelectorAll('.price-input');
    var debounced = debounce(function () {
      var min = parseInt(inputs[0].value, 10);
      var max = parseInt(inputs[1].value, 10);
      state.minCents = isNaN(min) ? null : min * 100;
      state.maxCents = isNaN(max) ? null : max * 100;
      state.page = 1;
      render();
    }, 400);
    inputs.forEach(function (input) { input.addEventListener('input', debounced); });

    var filterToggle = document.getElementById('filterToggle');
    var shopSidebar = document.getElementById('shopSidebar');
    if (filterToggle && shopSidebar) {
      filterToggle.addEventListener('click', function () {
        shopSidebar.classList.toggle('active');
      });
    }

    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        state.sort = this.value;
        state.page = 1;
        render();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        state.page += 1;
        render();
        if ((state.page * PAGE_SIZE) >= state.items.length) {
          loadMoreBtn.style.display = 'none';
        }
      });
    }

    document.addEventListener('langchange', function () {
      render();
    });
  }

  /* ---- Init ---- */

  function init() {
    wireFilters();
    loadItems()
      .then(function () {
        if (state.source === 'api') render();
        else {
          // Static markup already present; just compute counts & results.
          var cards = grid ? grid.querySelectorAll('.product-card').length : 0;
          if (resultsEl) resultsEl.textContent = tr('showingResults', { visible: cards, total: cards });
          if (loadMoreBtn) loadMoreBtn.style.display = 'none';
          updateActiveFilters();
        }
      })
      .catch(function () {
        var cards = itemsFromStaticCards();
        state.items = cards;
        render();
      });
  }

  init();
})();