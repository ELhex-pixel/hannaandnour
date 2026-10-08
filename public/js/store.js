/**
 * Hanna & Nour - Store (data layer)
 * Product catalog, persistent cart & wishlist (localStorage), badge sync.
 * Loaded on every page after config.js and before main.js.
 */
(function () {
  'use strict';

  var CONFIG = window.HN_CONFIG || { API_BASE: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };
  var CART_KEY = 'hn-cart';
  var WISH_KEY = 'hn-wishlist';
  var PROD_CACHE_KEY = 'hn-products';
  var API_BASE = CONFIG.API_BASE || '/.netlify/functions';

  function apiUrl(name) {
    return API_BASE + '/' + name;
  }

  function request(url, options) {
    var controller = new AbortController();
    var timer;
    return new Promise(function (resolve, reject) {
      timer = setTimeout(function () { controller.abort(); reject(new Error(tr('liveLoadError'))); }, 12000);
      fetch(url, Object.assign({ cache: 'no-store' }, options || {}, { signal: controller.signal }))
        .then(function (res) { return res.json().then(function (data) { if (!res.ok) throw new Error(data.error || tr('liveLoadError')); return data; }); })
        .then(resolve, reject);
    }).finally(function () { clearTimeout(timer); });
  }

  function loadingMarkup(layout, count) {
    var html = '<span class="live-status" role="status" data-i18n="liveLoading">' + tr('liveLoading') + '</span>';
    for (var i = 0; i < (count || 1); i++) {
      html += '<div class="live-skeleton-' + (layout === 'row' ? 'row' : 'card') + '" aria-hidden="true"><div class="live-skeleton-image"></div><div class="live-skeleton-copy"><div class="live-skeleton-line"></div><div class="live-skeleton-line live-skeleton-short"></div></div></div>';
    }
    return html;
  }

  function loading(target, layout, count) {
    if (!target) return;
    target.setAttribute('aria-busy', 'true');
    target.innerHTML = loadingMarkup(layout, count);
  }

  function loaded(target) {
    if (target) target.setAttribute('aria-busy', 'false');
  }

  function loadError(target, retry, key) {
    if (!target) return;
    loaded(target);
    target.textContent = '';
    var box = document.createElement('div'); box.className = 'live-status';
    var text = document.createElement('p'); text.setAttribute('role', 'status'); text.setAttribute('data-i18n', key || 'liveLoadError'); text.textContent = tr(key || 'liveLoadError');
    var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.setAttribute('data-i18n', 'liveRetry'); button.textContent = tr('liveRetry'); button.addEventListener('click', retry);
    box.appendChild(text); box.appendChild(button); target.appendChild(box);
  }

  function tr(key, params) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      return window.I18n.t(key, params);
    }
    return key;
  }

  function track(type, slug) {
    try {
      if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
        var payload = JSON.stringify({ type: type, product_slug: slug || null, path: window.location.pathname + window.location.search });
        window.navigator.sendBeacon(apiUrl('track'), new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(apiUrl('track'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: type, product_slug: slug || null, path: window.location.pathname + window.location.search }),
          keepalive: true
        }).catch(function () {});
      }
    } catch (e) { /* tracking is best-effort */ }
  }

  function readLS(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLS(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable */ }
  }

  function emit(name) {
    try { document.dispatchEvent(new CustomEvent(name)); } catch (e) {}
  }

  var CURRENCY_SYMBOL = '$';
  var CURRENCY_CODE = '';
  var CONFIG_CACHE_KEY = 'hn-config';
  var CONFIG_DATA = {};
  var RETURN_DAYS = null;
  var configPending = false;
  var REVIEW_DEMO = false;
  var DEMO_COUNT = 3;
  var DEMO_SUM = 15;
  var configPromise = null;
  var configOnline = false;

  function money(cents) {
    var v = (parseInt(cents, 10) || 0) / 100;
    return CURRENCY_SYMBOL + v.toFixed(2);
  }

  // Loads the admin-editable /api/config (currency symbol, shipping, tax) once
  // and reuses the cached copy when offline. Pages that call loadProducts are
  // gated on this so prices render with the right symbol.
  function loadConfig(force) {
    if (configPromise && (!force || configPending)) return configPromise;
    configPending = true;
    var cachedCfg = readLS(CONFIG_CACHE_KEY) || {};
    if (cachedCfg.currency && cachedCfg.currency.symbol) {
      CURRENCY_SYMBOL = cachedCfg.currency.symbol;
    }
    if (cachedCfg.currency && cachedCfg.currency.code) {
      CURRENCY_CODE = cachedCfg.currency.code;
    }
    configPromise = request(apiUrl('config'))
      .then(function (data) {
        configOnline = true;
        if (window.HN_COLORS && window.HN_COLORS.setSwatches) window.HN_COLORS.setSwatches(data.color_swatches || []);
        try {
          writeLS(CONFIG_CACHE_KEY, data);
          if (data && data.currency && data.currency.symbol) {
            CURRENCY_SYMBOL = data.currency.symbol;
          }
          if (data && data.currency && data.currency.code) {
            CURRENCY_CODE = data.currency.code;
          }
        } catch (e) {}
        applyConfigCopy(data || {});
        return data || {};
      })
      .catch(function () {
        configOnline = false;
        configPromise = null;
        if (window.HN_COLORS && window.HN_COLORS.setSwatches) window.HN_COLORS.setSwatches(cachedCfg.color_swatches || []);
        applyConfigCopy(cachedCfg || {});
        return cachedCfg || {};
      }).finally(function () { configPending = false; });
    return configPromise;
  }

  function requireConfig(force) {
    return loadConfig(force).then(function (data) {
      if (!configOnline || !data.currency || !/^[a-z]{3}$/i.test(data.currency.code || '') || typeof data.currency.symbol !== 'string' || !data.currency.symbol.trim() || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error(tr('liveLoadError'));
      return data;
    });
  }

  function isAuthed() {
    try {
      return !!(window.localStorage && window.localStorage.getItem('hn-auth'));
    } catch (e) {
      return false;
    }
  }

  function applyConfigCopy(cfg) {
    try {
      CONFIG_DATA = (cfg && cfg.settings) || {};
      var days = cfg && cfg.return_policy ? cfg.return_policy.days : CONFIG_DATA.returns_days;
      RETURN_DAYS = Number.isInteger(days) && days >= 14 && days <= 365 ? days : null;
      REVIEW_DEMO = !!(cfg && cfg.reviews && cfg.reviews.show_demo);
      if (cfg && cfg.reviews && cfg.reviews.demo && typeof cfg.reviews.demo === 'object') {
        DEMO_COUNT = parseInt(cfg.reviews.demo.count, 10) || 0;
        DEMO_SUM = parseInt(cfg.reviews.demo.sum, 10) || 0;
      }
      if (window.I18n && typeof window.I18n.setShipThreshold === 'function' &&
          typeof CONFIG_DATA.free_threshold_cents === 'number') {
        window.I18n.setShipThreshold(CONFIG_DATA.free_threshold_cents);
      }
      if (window.I18n && typeof window.I18n.refreshCurrency === 'function') {
        window.I18n.refreshCurrency();
        if (typeof refreshPromoAnnounce === 'function') refreshPromoAnnounce();
      }
      var tSec = document.getElementById('testimonialsSection');
      if (tSec) {
        tSec.style.display = cfg && cfg.reviews && cfg.reviews.show_demo ? '' : 'none';
      }
    } catch (e) {}
    refreshFooterTrust();
    document.dispatchEvent(new CustomEvent('hn:config', { detail: cfg }));
  }

  function currentLang() {
    return window.I18n && typeof window.I18n.lang === 'function' ? window.I18n.lang() : 'en';
  }

  /* ---------------- Promo codes (server-driven) ---------------- */

  var PROMOS_CACHE_KEY = 'hn-promos';
  var DEMO_PROMOS = { WELCOME15: 15 };
  var promosList = [];
  var promosInit = null;
  var promosFromServer = false;

  // Expose active promos (code -> %) from /api/promos, cached for offline.
  function loadPromos() {
    if (promosInit) return promosInit;
    var cached = readLS(PROMOS_CACHE_KEY);
    if (cached && Array.isArray(cached) && cached.length) promosList = cached;
    promosInit = fetch(apiUrl('promos'))
      .then(function (res) {
        if (!res.ok) throw new Error('promos request failed');
        return res.json();
      })
      .then(function (data) {
        promosList = Array.isArray(data.promos) ? data.promos : [];
        promosFromServer = true;
        try { writeLS(PROMOS_CACHE_KEY, promosList); } catch (e) {}
        refreshPromoAnnounce(promosList);
        refreshFooterTrust();
        return promosList;
      })
      .catch(function () {
        promosInit = null;
        refreshPromoAnnounce(promosList);
        refreshFooterTrust();
        return promosList;
      });
    return promosInit;
  }

  function promos() {
    return promosList.slice();
  }

  // Discount rate (0..1) for a code. The server list is authoritative: a
  // deleted/unknown code is rejected. The legacy WELCOME15 demo rate only
  // applies when the API is unreachable (offline preview).
  function promoRate(codeRaw) {
    var code = String(codeRaw || '').toUpperCase();
    if (!code) return 0;
    var pct = 0;
    for (var i = 0; i < promosList.length; i++) {
      if (String(promosList[i].code).toUpperCase() === code) {
        var expires = promosList[i].expires_at;
        if (!expires || new Date(expires).getTime() > Date.now()) {
          pct = parseInt(promosList[i].percent_off, 10) || 0;
        }
        break;
      }
    }
    if (pct > 0) return pct / 100;
    if (!promosFromServer) return (DEMO_PROMOS[code] || 0) / 100;
    return 0;
  }

  // Announces the first active promo in the header bar instead of a hardcoded
  // code, so promo changes are visible everywhere without touching i18n.
  function refreshPromoAnnounce(list) {
    try {
      if (!window.I18n || typeof window.I18n.t !== 'function') return;
      var active = null;
      (list || promosList).forEach(function (p) {
        if (active) return;
        if (p && p.percent_off && (!p.expires_at || new Date(p.expires_at).getTime() > Date.now())) active = p;
      });
      var text = active
        ? window.I18n.t('announcePromo', { code: active.code, pct: active.percent_off })
        : window.I18n.t('announce');
      document.querySelectorAll('[data-i18n="announce"]').forEach(function (el) {
        if (el && el.textContent) el.textContent = text;
      });
    } catch (e) {}
  }

  // Fills the footer trust row: admin-editable returns window (returns_days from
  // /api/config) and the active promo code, refreshed on config/promo changes and
  // language switches. The free-shipping text is handled by i18n 'trustFree'.
  function refreshFooterTrust() {
    try {
      if (!window.I18n || typeof window.I18n.t !== 'function') return;
      var el = document.getElementById('footerTrustReturns');
      if (el) {
        el.textContent = RETURN_DAYS === null ? window.I18n.t('returnPolicyLink') : window.I18n.t('trustReturns', { n: RETURN_DAYS });
      }
      el = document.getElementById('footerTrustPromo');
      if (el) {
        var active = null;
        for (var i = 0; i < promosList.length; i++) {
          var p = promosList[i];
          if (p && p.percent_off && (!p.expires_at || new Date(p.expires_at).getTime() > Date.now())) {
            active = p;
            break;
          }
        }
        var chip = el.closest('.footer-trust-item');
        if (active) {
          el.textContent = window.I18n.t('trustPromo', { code: String(active.code).toUpperCase(), pct: parseInt(active.percent_off, 10) || 0 });
          if (chip) chip.style.display = '';
        } else {
          if (chip) chip.style.display = 'none';
        }
      }
    } catch (e) {}
  }

  function productName(p) {
    if (!p) return '';
    var lang = currentLang();
    if (lang === 'fr' && p.name_fr) return p.name_fr;
    if (lang === 'ar' && p.name_ar) return p.name_ar;
    return p.name_en || p.name || '';
  }

  /* ---------------- Catalog ---------------- */

  var productsPromise = null;
  var productsList = [];

  function loadProducts(force) {
    if (!force && productsPromise) return productsPromise;
    var cfg = requireConfig();
    productsPromise = cfg.then(function () {
      return request(apiUrl('products'))
        .then(function (data) {
          if (!Array.isArray(data.products)) throw new Error(tr('liveLoadError'));
          productsList = data.products;
          try {
            // Bound the cache so an oversized catalog never fills localStorage.
            if (JSON.stringify(productsList).length < 1500000) {
              writeLS(PROD_CACHE_KEY, productsList);
            }
          } catch (e) { /* oversized payload: keep in-memory only */ }
          return productsList;
        });
    }).catch(function (err) {
      productsPromise = null;
      throw err;
    });
    return productsPromise;
  }

  function fetchProducts(params) {
    return request(apiUrl('products') + '?' + new URLSearchParams(params || {}).toString()).then(function (data) {
      if (!Array.isArray(data.products)) throw new Error(tr('liveLoadError'));
      window.HN.rememberProducts(data.products); return data.products;
    });
  }

  function loadProductSlugs(slugs) {
    var batches = [];
    for (var i = 0; i < slugs.length; i += 20) batches.push(slugs.slice(i, i + 20));
    return Promise.all(batches.map(function (batch) { return fetchProducts({ slug: batch.join(','), limit: 48 }); })).then(function (results) { return [].concat.apply([], results); });
  }

  function getProduct(slug) {
    for (var i = 0; i < productsList.length; i++) {
      if (productsList[i].slug === slug) return productsList[i];
    }
    // Try the localStorage cache even if the fetch failed (survives tabs).
    try {
      var cached = readLS(PROD_CACHE_KEY);
      if (cached && Array.isArray(cached)) {
        for (var j = 0; j < cached.length; j++) {
          if (cached[j].slug === slug) return cached[j];
        }
      }
    } catch (e) {}
    return null;
  }

  /* ---------------- Shared product card ---------------- */

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function catKey(cat) {
    return { hijab: 'catHijabs', abaya: 'catAbayas', dress: 'catDresses', prayer: 'catPrayerWear', accessory: 'catAccessories', knitwear: 'catKnitwear', jacket: 'catJackets', skirt: 'catSkirts', top: 'catTops', trousers: 'catTrousers' }[cat] || 'allProducts';
  }

  function badgeFor(p) {
    if (p && p.is_bestseller) return 'Bestseller';
    var b = p && p.badge;
    if (b && String(b).toLowerCase() === 'bestseller') return 'Bestseller';
    return b || null;
  }

  // Card review display, synced with the admin:
  // - No real approved reviews: keep the catalog seed (rating/review_count).
  // - Real approved reviews: show the real count (or real+3 when the demo
  //   illustration is ON, rating combined with the 3 demos at 5) so the card
  //   matches the product page.
  // - No reviews at all: returns null so the block is hidden.
  function cardReviewInfo(p) {
    var real = parseInt(p && p.approved_count, 10) || 0;
    var count, rating;
    if (real > 0) {
      var realRating = parseFloat(p && p.approved_rating) || 0;
      rating = realRating || parseFloat(p && p.rating) || 0;
      if (REVIEW_DEMO && DEMO_COUNT > 0) {
        count = real + DEMO_COUNT;
        rating = (realRating * real + DEMO_SUM) / count;
      } else {
        count = real;
      }
    } else {
      count = parseInt(p && p.review_count, 10) || 0;
      rating = parseFloat(p && p.rating) || 0;
    }
    if (!count) return null;
    return { count: count, rating: rating };
  }

  // Canonical product card used by shop.js, the home page feeds and anywhere
  // else the API catalog is rendered. Keep markup in sync with shop static cards.
  function buildCard(p) {
    var link = 'product.html?slug=' + encodeURIComponent(p.slug);
    var name = productName(p);
    var price = money(p.price_cents);
    var original = p.compare_at_price_cents ? money(p.compare_at_price_cents) : null;
    var badge = badgeFor(p);
    var info = cardReviewInfo(p);
    var stars = info ? Math.round(info.rating) : 0;
    if (stars < 1) stars = 0;
    var starStr = '';
    for (var s = 0; s < stars; s++) starStr += '\u2605';
    for (var e = stars; e < 5; e++) starStr += '\u2606';
    var ratingHtml = info
      ? '    <div class="product-card-rating"><span class="stars">' + starStr + '</span><span class="rating-count">(' + info.count + ')</span></div>'
      : '';

    return '' +
      '<div class="product-card" data-slug="' + escAttr(p.slug) + '" data-category="' + escAttr(p.category) + '" data-price-cents="' + (p.price_cents || 0) + '" data-rating="' + (p.rating || 0) + '">' +
      '  <a href="' + link + '" class="product-card-image" style="display:block;">' +
      '    <img src="' + escAttr(p.image || 'images/hero.jpg') + '" alt="' + escAttr(name) + '" loading="lazy">' +
      (badge ? '    <span class="product-badge">' + escAttr(badge) + '</span>' : '') +
      '  </a>' +
      '  <button class="product-wishlist" aria-label="' + escAttr(tr('wishAdd')) + '"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg></button>' +
      '  <div class="product-card-quick-add"><button class="btn btn-primary btn-sm">' + escAttr(tr('quickAdd')) + '</button></div>' +
      '  <div class="product-card-info">' +
      '    <span class="product-card-category">' + escAttr(tr(catKey(p.category))) + '</span>' +
      '    <a href="' + link + '"><h3 class="product-card-title">' + escAttr(name) + '</h3></a>' +
      '    <div class="product-card-price">' +
      '      <span class="product-price-current">' + price + '</span>' +
      (original ? '<span class="product-price-original">' + original + '</span>' : '') +
      '    </div>' +
      ratingHtml +
      '  </div>' +
      '</div>';
  }

  /* ---------------- Cart ---------------- */

  function getCart() {
    var cart = readLS(CART_KEY);
    if (!Array.isArray(cart)) return [];
    return cart.filter(function (item) { return item && typeof item.slug === 'string'; }).map(function (item) {
      var product = productsList.filter(function (p) { return p.slug === item.slug; })[0];
      return Object.assign({}, item, { priceCents: product ? product.price_cents : Math.max(1, parseInt(item.priceCents, 10) || 1), qty: Math.min(10, Math.max(1, parseInt(item.qty, 10) || 1)) });
    });
  }

  function saveCart(cart) {
    writeLS(CART_KEY, cart);
  }

  function cartKey(item) {
    return item.slug + '|' + (item.color || '') + '|' + (item.size || '');
  }

  function addToCart(product, opts) {
    var o = opts || {};
    var maxQty = o.stock != null ? Math.max(0, parseInt(o.stock, 10) || 0) : 10;
    var qty = Math.min(maxQty || 1, 10, Math.max(1, parseInt(o.qty, 10) || 1));
    if (maxQty === 0) return getCart();
    var cart = getCart();
    var found = null;
    for (var i = 0; i < cart.length; i++) {
      if (cartKey(cart[i]) === cartKey({
        slug: product.slug,
        color: o.color || '',
        size: o.size || ''
      })) {
        found = cart[i];
        break;
      }
    }
    if (found) {
      found.qty = Math.min(found.maxQty != null ? found.maxQty : 10, 10, found.qty + qty || qty);
    } else {
      cart.push({
        slug: product.slug,
        name: product.name_en || product.name || '',
        priceCents: parseInt(product.price_cents, 10) || 0,
        image: product.image || '',
        color: o.color || '',
        size: o.size || '',
        variantId: o.variantId || null,
        maxQty: o.stock != null ? maxQty : null,
        qty: qty
      });
    }
    saveCart(cart);
    refreshBadge();
    emit('hn:cart');
    track('add_to_cart', product.slug);
    return cart;
  }

  function updateQty(index, qty) {
    var cart = getCart();
    if (cart[index]) {
      var cap = cart[index].maxQty != null ? cart[index].maxQty : 10;
      cart[index].qty = Math.min(cap || 1, 10, Math.max(1, parseInt(qty, 10) || 1));
      saveCart(cart);
      refreshBadge();
      emit('hn:cart');
    }
    return cart;
  }

  function removeFromCart(index) {
    var cart = getCart();
    if (cart[index]) cart.splice(index, 1);
    saveCart(cart);
    refreshBadge();
    emit('hn:cart');
    return cart;
  }

  function clearCart() {
    saveCart([]);
    refreshBadge();
    emit('hn:cart');
  }

  function cartCount() {
    var cart = getCart();
    var n = 0;
    for (var i = 0; i < cart.length; i++) n += cart[i].qty || 0;
    return n;
  }

  function refreshBadge() {
    var count = cartCount();
    var badges = document.querySelectorAll('.cart-count');
    for (var i = 0; i < badges.length; i++) {
      badges[i].textContent = count;
      badges[i].style.display = count > 0 ? '' : 'none';
    }
  }

  /* ---------------- Wishlist ---------------- */

  function getWishlist() {
    var w = readLS(WISH_KEY);
    return Array.isArray(w) ? w : [];
  }

  function toggleWishlist(slug) {
    var w = getWishlist();
    var idx = w.indexOf(slug);
    if (idx >= 0) {
      w.splice(idx, 1);
      writeLS(WISH_KEY, w);
      emit('hn:wishlist');
      return { active: false };
    }
    w.push(slug);
    writeLS(WISH_KEY, w);
    emit('hn:wishlist');
    return { active: true };
  }

  function wishlistCount() {
    return getWishlist().length;
  }

  /* ---------------- Helpers used by other scripts ---------------- */

  function quickAdd(btn) {
    var card = btn && btn.closest ? btn.closest('.product-card, [data-slug]') : null;
    var slug = card ? card.getAttribute('data-slug') : (btn ? btn.getAttribute('data-slug') : null);
    var product = productsList.filter(function (p) { return p.slug === slug && p.active !== false; })[0];
    if (!product) {
      if (slug) window.location.href = 'product.html?slug=' + encodeURIComponent(slug);
      return;
    }

    // Products with managed variant stock need a color/size selection: the
    // one-tap button cannot pick a valid variant, so open the product page.
    if (product.product_variants && product.product_variants.length) {
      window.location.href = 'product.html?slug=' + encodeURIComponent(product.slug);
      return;
    }

    addToCart(product, { qty: 1 });
    showToastSafe(tr('cartAdd'), productName(product) + ' ' + tr('cartAddMsg'), 'success');
    updateWishlistHearts();
  }

  function showToastSafe(title, message, type) {
    // main.js defines showToast internally; expose it for helpers.
    if (typeof window.hnToast === 'function') window.hnToast(title, message, type);
  }

  function updateWishlistHearts() {
    var slugs = getWishlist();
    var nodes = document.querySelectorAll('.product-wishlist');
    for (var i = 0; i < nodes.length; i++) {
      var card = nodes[i].closest('.product-card, [data-slug]');
      var slug = card ? card.getAttribute('data-slug') : null;
      if (slug && slugs.indexOf(slug) >= 0) nodes[i].classList.add('active');
    }
  }

  /* ---------------- Sign-in state (optional) ---------------- */

  function isAuthConfigured() {
    return !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
  }

  function getConfig() { return CONFIG; }

  /* ---------------- Init ---------------- */

  function init() {
    refreshBadge();
    updateWishlistHearts();
    // Load admin config first (currency symbol) so prices render correctly.
    loadConfig();
    function refreshCurrentConfig() { if (!document.hidden) loadConfig(true); }
    window.addEventListener('focus', refreshCurrentConfig);
    window.addEventListener('pageshow', refreshCurrentConfig);
    window.addEventListener('storage', function (event) { if (event.key === 'hn-return-policy-version') refreshCurrentConfig(); });
    document.addEventListener('visibilitychange', refreshCurrentConfig);
    // Load promo codes so the header announce and cart preview use live codes.
    loadPromos();
    // Re-announce the promo after a language switch (i18n resets [data-i18n]).
    document.addEventListener('langchange', function () { refreshPromoAnnounce(promosList); refreshFooterTrust(); });
    // Load the catalog in the background (rendering scripts call it too).
    if (!window.HN_CONFIG_SUPPRESS_AUTOLOAD && !document.body.hasAttribute('data-live-page')) {
      loadProducts().catch(function () { /* offline preview: static content remains */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HN = {
    returnDays: function () { return RETURN_DAYS; },
    config: CONFIG,
    api: apiUrl,
    request: request,
    loading: loading,
    loaded: loaded,
    loadError: loadError,
    tr: tr,
    money: money,
    lang: currentLang,
    productName: productName,
    loadProducts: loadProducts,
    fetchProducts: fetchProducts,
    loadProductSlugs: loadProductSlugs,
    rememberProducts: function (products) { products.forEach(function (p) { var index = productsList.findIndex(function (existing) { return existing.slug === p.slug; }); if (index >= 0) productsList[index] = Object.assign({}, productsList[index], p); else productsList.push(p); }); },
    getProduct: getProduct,
    card: buildCard,
    catKey: catKey,
    products: function () { return productsList; },
    cart: {
      replace: function (items) { saveCart(items); refreshBadge(); },
      list: getCart,
      add: addToCart,
      update: updateQty,
      remove: removeFromCart,
      clear: clearCart,
      count: cartCount,
      key: cartKey
    },
    wishlist: {
      list: getWishlist,
      toggle: toggleWishlist,
      has: function (slug) { return getWishlist().indexOf(slug) >= 0; },
      count: wishlistCount
    },
    quickAdd: quickAdd,
    refreshBadge: refreshBadge,
    updateWishlistHearts: updateWishlistHearts,
    moneyCents: money,
    symbol: function () { return CURRENCY_SYMBOL; },
    currency: function () { return CURRENCY_CODE; },
    loadConfig: loadConfig,
    requireConfig: requireConfig,
    loadPromos: loadPromos,
    promos: promos,
    promoRate: promoRate,
    refreshFooterTrust: refreshFooterTrust,
    track: track,
    isAuthed: isAuthed,
    isAuthConfigured: isAuthConfigured
  };
})();
