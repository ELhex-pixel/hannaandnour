/**
 * Cart page: renders the persisted cart (localStorage via store.js),
 * updates quantities, applies promo preview and totals.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var TAX_RATE = 0.07;
  var FREE_SHIPPING_CENTS = 7500;
  var STD_SHIPPING_CENTS = 699;
  var EXPRESS_SHIPPING_CENTS = 1200;
  var NEXTDAY_SHIPPING_CENTS = 2500;
  var PICKUP_SHIPPING_CENTS = 0;
  var PROMO_LOCAL = { WELCOME15: 0.15 };
  var PROMO_KEY = 'hn-promo';

  function applyConfig(cfg) {
    if (!cfg || !cfg.settings) return;
    var s = cfg.settings;
    if (typeof s.tax_rate === 'number') TAX_RATE = s.tax_rate;
    if (typeof s.free_threshold_cents === 'number') FREE_SHIPPING_CENTS = s.free_threshold_cents;
    if (typeof s.standard_cents === 'number') STD_SHIPPING_CENTS = s.standard_cents;
    if (typeof s.express_cents === 'number') EXPRESS_SHIPPING_CENTS = s.express_cents;
    if (typeof s.nextday_cents === 'number') NEXTDAY_SHIPPING_CENTS = s.nextday_cents;
    if (typeof s.pickup_cents === 'number') PICKUP_SHIPPING_CENTS = s.pickup_cents;
  }

  var itemsEl = document.querySelector('.cart-items');
  var summaryBox = document.querySelector('.cart-summary');

  function localizedName(item) {
    var p = HN.getProduct(item.slug);
    if (p) return HN.productName(p);
    return item.name || item.slug;
  }

  function variantText(item) {
    var parts = [];
    if (item.color) parts.push(tr('colorVar', { v: item.color }));
    if (item.size) parts.push(tr('sizeVar', { v: item.size }));
    return parts.join(' \u2022 ') || item.slug;
  }

  function getPromo() {
    try { return window.sessionStorage.getItem(PROMO_KEY) || ''; } catch (e) { return ''; }
  }

  function setPromo(code) {
    try { window.sessionStorage.setItem(PROMO_KEY, code || ''); } catch (e) {}
  }

  function clearPromo() {
    try { window.sessionStorage.removeItem(PROMO_KEY); } catch (e) {}
  }

  function promoRate() {
    var code = getPromo();
    if (!code) return 0;
    return window.HN && typeof window.HN.promoRate === 'function' ? window.HN.promoRate(code) : (PROMO_LOCAL[code] || 0);
  }

  function totals() {
    var items = HN.cart.list();
    var subtotal = 0;
    for (var i = 0; i < items.length; i++) subtotal += (items[i].priceCents || 0) * (items[i].qty || 1);
    var shipping = (subtotal >= FREE_SHIPPING_CENTS || subtotal === 0) ? 0 : STD_SHIPPING_CENTS;
    var discount = Math.round(subtotal * promoRate());
    var tax = Math.round((subtotal - discount) * TAX_RATE);
    var total = subtotal + shipping + tax - discount;
    return { subtotal: subtotal, shipping: shipping, discount: discount, tax: tax, total: total };
  }

  function renderItems() {
    if (!itemsEl) return;
    var items = HN.cart.list();

    if (!items.length) {
      itemsEl.innerHTML =
        '<div class="text-center" style="padding: var(--spacing-2xl) 0;">' +
        '<h2 style="font-size: 1.75rem; margin-bottom: var(--spacing-sm);">' + tr('cartEmptyTitle') + '</h2>' +
        '<p style="color: var(--color-gray); margin-bottom: var(--spacing-xl);">' + tr('cartEmptyDesc') + '</p>' +
        '<a href="shop.html" class="btn btn-primary btn-lg">' + tr('startShopping') + '</a>' +
        '</div>';
      renderSummary();
      return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      html +=
        '<div class="cart-item" data-index="' + i + '">' +
        '  <div class="cart-item-image"><img src="' + (it.image || 'images/hero.jpg') + '" alt="' + localizedName(it) + '"></div>' +
        '  <div class="cart-item-info">' +
        '    <a href="product.html?slug=' + encodeURIComponent(it.slug) + '"><h2 class="cart-item-title">' + localizedName(it) + '</h2></a>' +
        '    <span class="cart-item-variant">' + variantText(it) + '</span>' +
        '    <span class="cart-item-price">' + HN.money(it.priceCents) + '</span>' +
        '  </div>' +
        '  <div class="cart-item-actions">' +
        '    <div class="quantity-selector">' +
        '      <button class="quantity-btn cart-qty-minus" aria-label="' + tr('a11yQtyDec') + '">&minus;</button>' +
        '      <input type="number" class="quantity-input cart-qty-input" name="qty" value="' + (it.qty || 1) + '" min="1" max="10" aria-label="' + tr('a11yQty') + '">' +
        '      <button class="quantity-btn cart-qty-plus" aria-label="' + tr('a11yQtyInc') + '">+</button>' +
        '    </div>' +
        '    <button class="cart-item-remove" data-remove-cart>' + tr('remove') + '</button>' +
        '  </div>' +
        '</div>';
    }
    html += '<div style="margin-top: var(--spacing-lg);"><a href="shop.html" class="btn btn-outline">' + tr('continueShopping') + '</a></div>';
    itemsEl.innerHTML = html;
    renderSummary();
  }

  function renderSummary() {
    if (!summaryBox) return;
    var items = HN.cart.list();
    var t = totals();
    var count = items.reduce(function (n, it) { return n + (it.qty || 1); }, 0);

    var subEl = document.getElementById('cartSummarySubtotal');
    var shipEl = document.getElementById('cartSummaryShipping');
    var taxEl = document.getElementById('cartSummaryTax');
    var discEl = document.getElementById('cartSummaryDiscount');
    var totalEl = document.getElementById('cartSummaryTotal');
    var labelEl = document.getElementById('sumSubtotalLabel');

    if (labelEl) labelEl.textContent = tr('sumSubtotal') + (count ? ' (' + count + ')' : '');
    if (subEl) subEl.textContent = HN.money(t.subtotal);
    if (shipEl) shipEl.textContent = t.shipping === 0 && t.subtotal > 0 ? tr('free') : HN.money(t.shipping);
    if (taxEl) taxEl.textContent = HN.money(t.tax);

    var discRow = document.getElementById('cartDiscountRow');
    if (discRow) discRow.style.display = t.discount > 0 ? '' : 'none';
    if (discEl) discEl.textContent = '-' + HN.money(t.discount);

    if (totalEl) totalEl.textContent = HN.money(t.total);

    var checkoutLink = summaryBox ? summaryBox.querySelector('a[href="checkout.html"]') : null;
    if (checkoutLink) {
      checkoutLink.style.pointerEvents = items.length ? '' : 'none';
      checkoutLink.style.opacity = items.length ? '' : '0.5';
    }
  }

  function wireEvents() {
    if (!itemsEl) return;

    itemsEl.addEventListener('click', function (e) {
      var minus = e.target.closest('.cart-qty-minus');
      var plus = e.target.closest('.cart-qty-plus');
      var removeBtn = e.target.closest('[data-remove-cart]');
      var row = (minus || plus || removeBtn) ? e.target.closest('.cart-item') : null;
      if (!row) return;
      var idx = parseInt(row.getAttribute('data-index'), 10);

      if (minus) {
        var v = parseInt(row.querySelector('.cart-qty-input').value, 10) || 1;
        if (v > 1) { HN.cart.update(idx, v - 1); showToast(tr('cartUpdated'), tr('qtyDecreased'), 'success'); }
      } else if (plus) {
        var v2 = parseInt(row.querySelector('.cart-qty-input').value, 10) || 1;
        if (v2 < 10) { HN.cart.update(idx, v2 + 1); showToast(tr('cartUpdated'), tr('qtyIncreased'), 'success'); }
      } else if (removeBtn) {
        HN.cart.remove(idx);
        showToast(tr('cartRemove'), tr('cartRemoveMsg'), 'success');
      }
    });

    itemsEl.addEventListener('change', function (e) {
      if (!e.target.classList.contains('cart-qty-input')) return;
      var row = e.target.closest('.cart-item');
      var idx = parseInt(row.getAttribute('data-index'), 10);
      var v = parseInt(e.target.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 10) v = 10;
      HN.cart.update(idx, v);
    });

    var applyBtn = document.getElementById('applyPromo');
    var promoInput = document.getElementById('promoInput');
    if (applyBtn && promoInput) {
      applyBtn.addEventListener('click', function () {
        var code = promoInput.value.trim().toUpperCase();
        if (!code) {
          showToast(tr('noCode'), tr('noCodeMsg'), 'error');
          return;
        }
        if (promoRate() > 0) {
          setPromo(code);
          showToast(tr('promoApplied'), tr('promoAppliedMsg', { pct: Math.round(promoRate() * 100) }), 'success');
          renderSummary();
        } else {
          clearPromo();
          showToast(tr('invalidCode'), tr('invalidCodeMsg'), 'error');
          renderSummary();
        }
      });
    }

    document.addEventListener('hn:cart', renderItems);
    document.addEventListener('langchange', renderItems);
  }

  function showToast(t, m, type) {
    if (typeof window.hnToast === 'function') window.hnToast(t, m, type);
  }

  /* Seed the promo field from session on first visit */
  function seedPromoInput() {
    var promoInput = document.getElementById('promoInput');
    if (promoInput && getPromo()) promoInput.value = getPromo();
  }

  /* Abandoned-cart recovery: `?restore=<cart_token>` re-adds the exact items. */
  function restoreFromUrl() {
    var m = (window.location.search || '').match(/[?&]restore=([0-9a-f]{40,64})/);
    if (!m) return;
    fetch(HN.api('orders') + '?cart_token=' + encodeURIComponent(m[1]))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.items || !res.items.length) return;
        res.items.forEach(function (it) {
          HN.cart.add({ slug: it.slug, name: '', price_cents: it.price_cents, image: '' }, { qty: it.qty, variantId: it.variant_id });
        });
        showToast(tr('cartRestored'), tr('cartRestoredMsg'), 'success');
        try {
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        } catch (e) { /* ignore */ }
        renderItems();
      })
      .catch(function () { /* invalid/expired token: ignore */ });
  }

  /* The static demo rows are replaced on load by renderItems(). */
  HN.loadConfig()
    .then(applyConfig)
    .catch(function () { /* offline: defaults */ })
    .finally(function () {
      restoreFromUrl();
      renderItems();
      wireEvents();
      seedPromoInput();
    });
  document.addEventListener('hn:cart', HN.refreshBadge, false);
})();