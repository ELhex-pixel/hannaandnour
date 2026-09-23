/**
 * Checkout page: builds the cart summary, collects shipping details and
 * redirects to the Stripe Checkout Session created by /api/checkout.
 * Shipping rates / tax / free threshold come from /api/config (admin-editable),
 * falling back to local defaults offline.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var DEFAULTS = {
    standard_cents: 699, express_cents: 1200, nextday_cents: 2500, pickup_cents: 0,
    free_threshold_cents: 7500, tax_rate: 0.07, pickup_enabled: true
  };
  var PROMO_LOCAL = { WELCOME15: 0.15 };

  var state = { method: 'standard', settings: DEFAULTS, loaded: false };

  function getPromo() {
    try { return window.sessionStorage.getItem('hn-promo') || ''; } catch (e) { return ''; }
  }
  function setPromo(code) {
    try { window.sessionStorage.setItem('hn-promo', code || ''); } catch (e) {}
  }

  function localizedName(item) {
    var p = HN.getProduct(item.slug);
    return p ? HN.productName(p) : (item.name || item.slug);
  }

  function totals() {
    var s = state.settings;
    var items = HN.cart.list();
    var subtotal = 0;
    for (var i = 0; i < items.length; i++) subtotal += (items[i].priceCents || 0) * (items[i].qty || 1);
    var rate = PROMO_LOCAL[getPromo()] || 0;
    var discount = Math.round(subtotal * rate);
    var shipping;
    if (state.method === 'pickup') {
      shipping = s.pickup_cents || 0;
    } else if (state.method === 'standard' && subtotal >= s.free_threshold_cents) {
      shipping = 0;
    } else {
      shipping = state.method === 'express' ? s.express_cents : state.method === 'next_day' ? s.nextday_cents : s.standard_cents;
    }
    var tax = subtotal > 0 ? Math.round((subtotal - discount) * (s.tax_rate || 0)) : 0;
    var total = Math.max(0, subtotal + shipping + tax - discount);
    return { subtotal: subtotal, shipping: shipping, discount: discount, tax: tax, total: total };
  }

  function renderSummary() {
    var items = HN.cart.list();
    var t = totals();
    var count = items.reduce(function (n, it) { return n + (it.qty || 1); }, 0);

    var subEl = document.getElementById('checkoutSummarySubtotal');
    var shipEl = document.getElementById('checkoutSummaryShipping');
    var taxEl = document.getElementById('checkoutSummaryTax');
    var discEl = document.getElementById('checkoutSummaryDiscount');
    var discRow = document.getElementById('checkoutDiscountRow');
    var totalEl = document.getElementById('checkoutSummaryTotal');
    var labelEl = document.getElementById('sumSubtotalLabel');

    if (labelEl) labelEl.textContent = tr('sumSubtotal') + (count ? ' (' + count + ')' : '');
    if (subEl) subEl.textContent = HN.money(t.subtotal);
    if (shipEl) shipEl.textContent = t.shipping === 0 && t.subtotal > 0 ? tr('free') : HN.money(t.shipping);
    if (taxEl) taxEl.textContent = HN.money(t.tax);
    if (discRow) discRow.style.display = t.discount > 0 ? '' : 'none';
    if (discEl) discEl.textContent = '-' + HN.money(t.discount);
    if (totalEl) totalEl.textContent = HN.money(t.total);

    var btn = document.getElementById('placeOrderBtn');
    if (btn && !btn.disabled) btn.textContent = tr('placeOrder') + ' \u2022 ' + HN.money(t.total);
  }

  function setEmptyCartButton() {
    var btn = document.getElementById('placeOrderBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = tr('placeOrder');
  }

  function renderItems() {
    var box = document.querySelector('.cart-summary');
    if (!box) return;
    var items = HN.cart.list();
    var holder = box.querySelector('.checkout-items');
    if (!holder) return;

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var variant = [it.color, it.size].filter(Boolean).join(' \u2022 ');
      html += '<div style="display: flex; gap: var(--spacing-md); align-items: center;">' +
        '<img src="' + (it.image || 'images/hero.jpg') + '" alt="" style="width: 60px; height: 80px; object-fit: cover; border-radius: var(--radius-sm);">' +
        '<div style="flex: 1;"><p style="font-size: 0.9375rem; font-weight: 600;">' + localizedName(it) + '</p>' +
        (variant ? '<p style="font-size: 0.875rem; color: var(--color-gray);">' + variant + ' \u2022 Qty: ' + (it.qty || 1) + '</p>' : '') +
        '</div><span>' + HN.money(it.priceCents) + '</span></div>';
    }
    holder.innerHTML = html;
  }

  function injectPickupMethod() {
    if (!state.settings.pickup_enabled) return;
    var container = document.querySelector('.payment-methods');
    if (!container) return;
    if (document.querySelector('.payment-method[data-method="pickup"]')) return;
    var fee = state.settings.pickup_cents || 0;
    var div = document.createElement('div');
    div.className = 'payment-method';
    div.setAttribute('data-method', 'pickup');
    div.innerHTML =
      '<span class="payment-radio"></span>' +
      '<div class="payment-details">' +
      '<p class="payment-name">' + tr('shipPickup') + '</p>' +
      '<p class="payment-desc">' + tr('shipPickupD') + '</p>' +
      '</div>' +
      '<strong>' + (fee === 0 ? tr('free') : HN.money(fee)) + '</strong>';
    container.appendChild(div);
  }

  function ensurePickupField() {
    var box = document.getElementById('pickupField');
    if (box) return box;
    var step2 = document.querySelector('.checkout-section .payment-methods');
    var shipSection = step2 ? step2.closest('.checkout-section') : null;
    if (!shipSection) return null;
    var wrap = document.createElement('div');
    wrap.id = 'pickupField';
    wrap.style.cssText = 'margin-top: var(--spacing-lg); display: none;';
    wrap.innerHTML =
      '<div class="form-group">' +
      '<label class="form-label" for="pickupPoint">' + tr('pickupPoint') + ' *</label>' +
      '<input type="text" class="form-input" id="pickupPoint" placeholder="Adresse / relais / boutiques choisi(e)s">' +
      '</div>';
    shipSection.appendChild(wrap);
    return wrap;
  }

  function wireShippingMethods() {
    injectPickupMethod();
    var methods = document.querySelectorAll('.payment-method[data-method]');
    methods.forEach(function (m) {
      m.addEventListener('click', function () {
        methods.forEach(function (x) { x.classList.remove('selected'); });
        m.classList.add('selected');
        state.method = m.getAttribute('data-method');
        updateDeliveryUI();
        renderSummary();
      });
    });

    // Keep payment-step methods purely visual.
    document.querySelectorAll('.checkout-section').forEach(function (section) {
      var title = section.querySelector('.checkout-section-title');
      if (title && title.getAttribute('data-i18n') === 'step4') {
        section.querySelectorAll('.payment-method').forEach(function (m) {
          m.addEventListener('click', function () {
            section.querySelectorAll('.payment-method').forEach(function (x) { x.classList.remove('selected'); });
            m.classList.add('selected');
          });
        });
      }
    });
  }

  function updateDeliveryUI() {
    var box = ensurePickupField();
    if (!box) return;
    box.style.display = state.method === 'pickup' ? '' : 'none';
  }

  function wirePromo() {
    var applyBtn = document.getElementById('applyDiscount');
    var input = document.getElementById('discountInput');
    if (applyBtn && input) {
      applyBtn.addEventListener('click', function () {
        var code = input.value.trim().toUpperCase();
        if (!code) { window.hnToast && hnToast(tr('noCode'), tr('noCodeMsg'), 'error'); return; }
        if (PROMO_LOCAL[code]) {
          setPromo(code);
          window.hnToast && hnToast(tr('promoApplied'), tr('promoAppliedMsg'), 'success');
        } else {
          setPromo('');
          window.hnToast && hnToast(tr('invalidCode'), tr('invalidCodeMsg'), 'error');
        }
        renderSummary();
      });
    }
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function wirePlaceOrder() {
    var btn = document.getElementById('placeOrderBtn');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var items = HN.cart.list();
      if (!items.length) {
        window.location.href = 'cart.html';
        return;
      }

      var email = val('contactEmail');
      var name = val('fullName');
      var isPickup = state.method === 'pickup';
      var pickupPoint = val('pickupPoint');

      var payload = {
        items: items.map(function (it) {
          return {
            slug: it.slug,
            qty: it.qty || 1,
            color: it.color || '',
            size: it.size || '',
            variantId: it.variantId || null
          };
        }),
        email: email,
        customer_name: name,
        phone: val('contactPhone'),
        address1: isPickup ? 'Retrait' : val('address1'),
        address2: isPickup ? '' : val('address2'),
        city: isPickup ? 'Retrait' : val('city'),
        state: isPickup ? '' : val('state'),
        postal_code: isPickup ? '' : val('postalCode'),
        country: isPickup ? 'FR' : val('country'),
        shipping_method: isPickup ? 'pickup' : state.method,
        pickup_point: isPickup ? pickupPoint : '',
        delivery_type: isPickup ? 'pickup' : 'home',
        promo: getPromo(),
        auth_token: window.HN_AUTH && HN_AUTH.isAuthed() ? HN_AUTH.token() : ''
      };

      if (!email || !name) {
        window.hnToast && hnToast(tr('checkoutError'), tr('checkoutErrorMsg'), 'error');
        return;
      }
      if (isPickup) {
        if (!pickupPoint) {
          window.hnToast && hnToast(tr('checkoutError'), tr('pickupPoint') + ' *', 'error');
          return;
        }
      } else if (!payload.address1 || !payload.city || !payload.postal_code) {
        window.hnToast && hnToast(tr('checkoutError'), tr('checkoutErrorMsg'), 'error');
        return;
      }

      btn.disabled = true;
      btn.textContent = tr('processing');

      fetch(HN.api('checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (out) {
          if (out.status === 200 && out.data.url) {
            window.location.href = out.data.url;
          } else {
            throw new Error(out.data.error || 'checkout failed');
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = tr('placeOrder') + ' \u2022 ' + HN.money(totals().total);
          window.hnToast && hnToast(tr('checkoutError'), err.message || tr('demoMsg'), 'error');
        });
    });
  }

  function init() {
    var items = HN.cart.list();
    if (!items.length) {
      setEmptyCartButton();
      window.location.href = 'cart.html';
      return;
    }

    renderItems();

    // Load admin-editable shipping settings (fallback to defaults offline).
    HN.loadConfig()
      .then(function (data) {
        if (data && data.settings) {
          Object.keys(DEFAULTS).forEach(function (k) {
            if (data.settings[k] !== undefined) DEFAULTS[k] = data.settings[k];
          });
          state.settings = DEFAULTS;
        }
      })
      .catch(function () { /* offline: defaults */ })
      .finally(function () {
        state.loaded = true;
        wireShippingMethods();
        updateDeliveryUI();
        renderSummary();
        wirePromo();
        wirePlaceOrder();
      });

    document.addEventListener('langchange', function () { renderSummary(); });
  }

  init();
})();