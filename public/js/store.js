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

  function tr(key, params) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      return window.I18n.t(key, params);
    }
    return key;
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
  var CONFIG_CACHE_KEY = 'hn-config';
  var configPromise = null;

  function money(cents) {
    var v = (parseInt(cents, 10) || 0) / 100;
    return CURRENCY_SYMBOL + v.toFixed(2);
  }

  // Loads the admin-editable /api/config (currency symbol, shipping, tax) once
  // and reuses the cached copy when offline. Pages that call loadProducts are
  // gated on this so prices render with the right symbol.
  function loadConfig() {
    if (configPromise) return configPromise;
    var cachedCfg = readLS(CONFIG_CACHE_KEY) || {};
    if (cachedCfg.currency && cachedCfg.currency.symbol) {
      CURRENCY_SYMBOL = cachedCfg.currency.symbol;
    }
    configPromise = fetch(apiUrl('config'))
      .then(function (res) {
        if (!res.ok) throw new Error('config request failed');
        return res.json();
      })
      .then(function (data) {
        try {
          writeLS(CONFIG_CACHE_KEY, data);
          if (data && data.currency && data.currency.symbol) {
            CURRENCY_SYMBOL = data.currency.symbol;
          }
        } catch (e) {}
        // Refresh the "$75" announcement copy with the admin currency symbol.
        try {
          if (window.I18n && typeof window.I18n.refreshCurrency === 'function') {
            window.I18n.refreshCurrency();
          }
        } catch (e) {}
        return data || {};
      })
      .catch(function () {
        configPromise = null;
        return cachedCfg || {};
      });
    return configPromise;
  }

  function currentLang() {
    return window.I18n && typeof window.I18n.lang === 'function' ? window.I18n.lang() : 'en';
  }

  /* ---------------- Promo codes (server-driven) ---------------- */

  var PROMOS_CACHE_KEY = 'hn-promos';
  var DEMO_PROMOS = { WELCOME15: 15 };
  var promosList = [];
  var promosInit = null;

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
        try { writeLS(PROMOS_CACHE_KEY, promosList); } catch (e) {}
        refreshPromoAnnounce(promosList);
        return promosList;
      })
      .catch(function () {
        promosInit = null;
        refreshPromoAnnounce(promosList);
        return promosList;
      });
    return promosInit;
  }

  function promos() {
    return promosList.slice();
  }

  // Discount rate (0..1) for a code. Falls back to the legacy WELCOME15 demo
  // code when the API is unreachable so the offline preview still works.
  function promoRate(codeRaw) {
    var code = String(codeRaw || '').toUpperCase();
    if (!code) return 0;
    var pct = 0;
    for (var i = 0; i < promosList.length; i++) {
      if (String(promosList[i].code).toUpperCase() === code) {
        pct = parseInt(promosList[i].percent_off, 10) || 0;
        break;
      }
    }
    if (pct > 0) return pct / 100;
    return (DEMO_PROMOS[code] || 0) / 100;
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
      if (!active) return;
      var text = window.I18n.t('announcePromo', { code: active.code, pct: active.percent_off });
      document.querySelectorAll('[data-i18n="announce"]').forEach(function (el) {
        if (el && el.textContent) el.textContent = text;
      });
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
    var cfg = configPromise || loadConfig();
    productsPromise = cfg.then(function () {
      // Online: always re-fetch so admin edits (add/delete/price/featured)
      // appear immediately. The localStorage cache is only an offline fallback.
      return fetch(apiUrl('products'))
        .then(function (res) {
          if (!res.ok) throw new Error('products request failed');
          return res.json();
        })
        .then(function (data) {
          productsList = data.products || [];
          try {
            // Bound the cache so an oversized catalog never fills localStorage.
            if (JSON.stringify(productsList).length < 1500000) {
              writeLS(PROD_CACHE_KEY, productsList);
            }
          } catch (e) { /* oversized payload: keep in-memory only */ }
          return productsList;
        });
    }).catch(function (err) {
      // Offline / API down: fall back to the last known catalog, then rethrow.
      var cached = readLS(PROD_CACHE_KEY);
      if (cached && Array.isArray(cached) && cached.length) {
        productsList = cached;
        return cached;
      }
      productsPromise = null;
      throw err;
    });
    return productsPromise;
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
    return { hijab: 'catHijabs', abaya: 'catAbayas', dress: 'catDresses', prayer: 'catPrayerWear', accessory: 'catAccessories' }[cat] || 'catHijabs';
  }

  function badgeFor(p) {
    if (p && p.is_bestseller) return 'Bestseller';
    var b = p && p.badge;
    if (b && String(b).toLowerCase() === 'bestseller') return 'Bestseller';
    return b || null;
  }

  // Canonical product card used by shop.js, the home page feeds and anywhere
  // else the API catalog is rendered. Keep markup in sync with shop static cards.
  function buildCard(p) {
    var link = 'product.html?slug=' + encodeURIComponent(p.slug);
    var name = productName(p);
    var price = money(p.price_cents);
    var original = p.compare_at_price_cents ? money(p.compare_at_price_cents) : null;
    var badge = badgeFor(p);
    var stars = Math.round(parseFloat(p.rating) || 0);
    if (stars < 1) stars = 0;
    var starStr = '';
    for (var s = 0; s < stars; s++) starStr += '\u2605';
    for (var e = stars; e < 5; e++) starStr += '\u2606';
    var count = p.review_count || 0;

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
      '    <div class="product-card-rating"><span class="stars">' + starStr + '</span><span class="rating-count">(' + count + ')</span></div>' +
      '  </div>' +
      '</div>';
  }

  /* ---------------- Cart ---------------- */

  function getCart() {
    var cart = readLS(CART_KEY);
    return Array.isArray(cart) ? cart : [];
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
      emit('hn:wishlist');
      return { active: false };
    }
    w.push(slug);
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
    var product = slug ? getProduct(slug) : null;

    if (!product && card) {
      // Fallback when the catalog is unavailable: build from card data attributes.
      var name = (card.querySelector('.product-card-title') || {}).textContent || tr('productFallback');
      var price = parseInt(card.getAttribute('data-price-cents') || card.getAttribute('data-price'), 10) || 100;
      product = {
        slug: slug || 'product',
        name_en: name,
        price_cents: card.getAttribute('data-price-cents') ? price : (price * 100),
        image: (card.querySelector('img') || {}).getAttribute ? card.querySelector('img').getAttribute('src') : ''
      };
    } else if (!product && slug) {
      product = { slug: slug, name_en: slug, price_cents: 1, image: '' };
    }

    if (!product) return;
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
    // Load promo codes so the header announce and cart preview use live codes.
    loadPromos();
    // Re-announce the promo after a language switch (i18n resets [data-i18n]).
    document.addEventListener('langchange', function () { refreshPromoAnnounce(promosList); });
    // Load the catalog in the background (rendering scripts call it too).
    if (!window.HN_CONFIG_SUPPRESS_AUTOLOAD) {
      loadProducts().catch(function () { /* offline preview: static content remains */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HN = {
    config: CONFIG,
    api: apiUrl,
    tr: tr,
    money: money,
    lang: currentLang,
    productName: productName,
    loadProducts: loadProducts,
    getProduct: getProduct,
    card: buildCard,
    catKey: catKey,
    products: function () { return productsList; },
    cart: {
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
    loadConfig: loadConfig,
    loadPromos: loadPromos,
    promos: promos,
    promoRate: promoRate,
    isAuthConfigured: isAuthConfigured
  };
})();