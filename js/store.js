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

  function money(cents) {
    var v = (parseInt(cents, 10) || 0) / 100;
    return '$' + v.toFixed(2);
  }

  function currentLang() {
    return window.I18n && typeof window.I18n.lang === 'function' ? window.I18n.lang() : 'en';
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
    var cached = !force ? readLS(PROD_CACHE_KEY) : null;
    if (cached && Array.isArray(cached) && cached.length) {
      productsList = cached;
      return Promise.resolve(cached);
    }
    productsPromise = fetch(apiUrl('products'))
      .then(function (res) {
        if (!res.ok) throw new Error('products request failed');
        return res.json();
      })
      .then(function (data) {
        productsList = data.products || [];
        try { window.sessionStorage.setItem(PROD_CACHE_KEY, JSON.stringify(productsList)); } catch (e) {}
        return productsList;
      })
      .catch(function (err) {
        productsPromise = null;
        throw err;
      });
    return productsPromise;
  }

  function getProduct(slug) {
    for (var i = 0; i < productsList.length; i++) {
      if (productsList[i].slug === slug) return productsList[i];
    }
    // Try the sessionStorage cache even if the fetch failed.
    try {
      var cached = window.sessionStorage.getItem(PROD_CACHE_KEY);
      if (cached) {
        var arr = JSON.parse(cached);
        for (var j = 0; j < arr.length; j++) {
          if (arr[j].slug === slug) return arr[j];
        }
      }
    } catch (e) {}
    return null;
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
    isAuthConfigured: isAuthConfigured
  };
})();