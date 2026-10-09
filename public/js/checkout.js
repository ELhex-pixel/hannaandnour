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

  var state = { method: 'standard', settings: DEFAULTS, loaded: false, quote: null, revision: 0 };

  function getPromo() {
    try { return window.sessionStorage.getItem('hn-promo') || ''; } catch (e) { return ''; }
  }
  function setPromo(code) {
    try { window.sessionStorage.setItem('hn-promo', code || ''); } catch (e) {}
  }
  function promoRate() {
    var code = getPromo();
    if (!code) return 0;
    return window.HN && typeof window.HN.promoRate === 'function' ? window.HN.promoRate(code) : (PROMO_LOCAL[code] || 0);
  }

  function localizedName(item) {
    var p = HN.getProduct(item.slug);
    return p ? HN.productName(p) : (item.name || item.slug);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function totals() {
    if (state.quote) return state.quote.totals;
    return { subtotal: 0, shipping: 0, discount: 0, tax: 0, total: 0 };
  }

  function acceptQuote(data) {
    if (!data.return_policy || typeof data.return_policy.version !== 'string' || !Number.isInteger(data.return_policy.days) || !['customer','store'].includes(data.return_policy.withdrawal_payer)) throw new Error(tr('quoteUnavailable'));
    state.quote = data;
    renderReturnPolicy();
    HN.rememberProducts(data.items);
    HN.cart.replace(data.items.map(function (item) { return Object.assign({}, item, { priceCents: item.price_cents }); }));
    renderItems();
    renderSummary();
    renderShippingMethodPrices();
    HN.loaded(document.querySelector('.checkout-items'));
    var apply = document.getElementById('applyDiscount'); if (apply) apply.disabled = false;
    var btn = document.getElementById('placeOrderBtn');
    if (btn) { btn.disabled = false; btn.textContent = tr('placeOrder') + ' • ' + formatMoney(data.totals.total); }
  }

  function formatMoney(cents) {
    return state.quote ? state.quote.currency.symbol + (cents / 100).toFixed(2) : HN.money(cents);
  }

  function renderReturnPolicy() {
    var policy = state.quote && state.quote.return_policy, box = document.getElementById('checkoutReturnPolicy');
    if (box && policy) box.textContent = tr('returnPolicyWindow').replace('{days}', policy.days) + ' ' + tr(policy.withdrawal_payer === 'store' ? 'returnPolicyStore' : 'returnPolicyCustomer') + ' ' + tr('returnPolicyFault');
  }

  function refreshQuote() {
    var revision = ++state.revision;
    state.quote = null;
    showPendingQuote();
    var btn = document.getElementById('placeOrderBtn');
    if (btn) { btn.disabled = true; btn.textContent = tr('processing'); }
    return Promise.all([HN.request(HN.api('checkout'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quote', items: HN.cart.list(), shipping_method: state.method, promo: getPromo() })
    }), state.configuration])
      .then(function (results) { if (revision === state.revision) acceptQuote(results[0]); })
      .catch(function (err) {
        if (revision !== state.revision) return;
        if (btn) { btn.textContent = tr('quoteUnavailable'); btn.disabled = true; }
        HN.loadError(document.querySelector('.checkout-items'), state.loaded ? refreshQuote : function () { init(true); }, 'quoteUnavailable');
        var apply = document.getElementById('applyDiscount'); if (apply) apply.disabled = !state.loaded;
        window.hnToast && hnToast(tr('checkoutError'), err.message || tr('quoteUnavailable'), 'error');
      });
  }

  function renderSummary() {
    if (!state.quote) return;
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
    if (subEl) subEl.textContent = formatMoney(t.subtotal);
    if (shipEl) shipEl.textContent = t.shipping === 0 && t.subtotal > 0 ? tr('free') : formatMoney(t.shipping);
    if (taxEl) taxEl.textContent = formatMoney(t.tax);
    if (discRow) discRow.style.display = t.discount > 0 ? '' : 'none';
    if (discEl) discEl.textContent = '-' + formatMoney(t.discount);
    if (totalEl) totalEl.textContent = formatMoney(t.total);

    var btn = document.getElementById('placeOrderBtn');
    if (btn && !btn.disabled) btn.textContent = tr('placeOrder') + ' \u2022 ' + formatMoney(t.total);
  }

  function setEmptyCartButton() {
    var btn = document.getElementById('placeOrderBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = tr('placeOrder');
  }

  function renderItems() {
    if (!state.quote) return;
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
        '<img src="' + esc(HN.image(it.image || 'images/hero.jpg', 160)) + '" alt="" decoding="async" style="width: 60px; height: 80px; object-fit: cover; border-radius: var(--radius-sm);">' +
        '<div style="flex: 1;"><p style="font-size: 0.9375rem; font-weight: 600;">' + esc(localizedName(it)) + '</p>' +
        (variant ? '<p style="font-size: 0.875rem; color: var(--color-gray);">' + esc(variant) + ' \u2022 Qty: ' + (it.qty || 1) + '</p>' : '') +
        '</div><span>' + formatMoney(it.priceCents) + '</span></div>';
    }
    holder.innerHTML = html;
  }

  function renderShippingMethodPrices() {
    var s = state.settings || DEFAULTS;
    var rates = {
      standard: s.standard_cents || 0,
      express: s.express_cents || 0,
      next_day: s.nextday_cents || 0,
      pickup: s.pickup_cents || 0
    };
    var subtotal = 0;
    var items = HN.cart.list();
    for (var i = 0; i < items.length; i++) subtotal += (items[i].priceCents || 0) * (items[i].qty || 1);
    document.querySelectorAll('.payment-method[data-method]').forEach(function (m) {
      var method = m.getAttribute('data-method');
      var strong = m.querySelector('strong');
      if (!strong) return;
      if (method === 'standard' && subtotal >= (s.free_threshold_cents || 0)) {
        strong.textContent = tr('free');
      } else {
        strong.textContent = HN.money(rates[method] || 0);
      }
    });
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
        refreshQuote();
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
        if (!code) { setPromo(''); refreshQuote(); return; }
        var rate = window.HN && typeof window.HN.promoRate === 'function'
          ? window.HN.promoRate(code)
          : (PROMO_LOCAL[code] || 0);
        if (rate > 0) {
          setPromo(code);
          window.hnToast && hnToast(tr('promoApplied'), tr('promoAppliedMsg', { pct: Math.round(rate * 100) }), 'success');
        } else {
          setPromo('');
          window.hnToast && hnToast(tr('invalidCode'), tr('invalidCodeMsg'), 'error');
        }
        refreshQuote();
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
      if (!state.quote) return;
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
        expected_total_cents: state.quote.totals.total,
        expected_currency: state.quote.currency.code,
        expected_policy_version: state.quote.return_policy.version
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

      if (HN.track) HN.track('checkout_attempt');

      fetch(HN.api('checkout'), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, window.HN_AUTH && HN_AUTH.isAuthed() ? { 'Authorization': 'Bearer ' + HN_AUTH.token() } : {}),
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (out) {
          if (out.status === 200 && out.data.url) {
            window.location.href = out.data.url;
          } else if (out.status === 409 && out.data.totals) {
            acceptQuote(out.data);
            window.hnToast && hnToast(tr('checkoutError'), tr('quoteChanged'), 'error');
          } else {
            throw new Error(out.data.error || 'checkout failed');
          }
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = tr('placeOrder') + ' \u2022 ' + formatMoney(totals().total);
          window.hnToast && hnToast(tr('checkoutError'), err.message || tr('demoMsg'), 'error');
        });
    });
  }

  function showPendingQuote() {
    HN.loading(document.querySelector('.checkout-items'), 'row', Math.max(1, HN.cart.list().length));
    document.querySelectorAll('[id^="checkoutSummary"]').forEach(function (el) { el.innerHTML = '<span class="live-amount" aria-hidden="true"></span>'; });
    var policy = document.getElementById('checkoutReturnPolicy'); if (policy) policy.textContent = '';
    var discount = document.getElementById('checkoutDiscountRow'); if (discount) discount.style.display = 'none';
    var apply = document.getElementById('applyDiscount'); if (apply) apply.disabled = true;
  }

  function init(force) {
    var items = HN.cart.list();
    if (!items.length) {
      setEmptyCartButton();
      window.location.href = 'cart.html';
      return;
    }

    showPendingQuote();
    state.loaded = false;
    var button = document.getElementById('placeOrderBtn'); if (button) button.disabled = true;
    state.configuration = HN.requireConfig(force)
      .then(function (data) {
        if (data && data.settings) {
          state.settings = {};
          Object.keys(DEFAULTS).forEach(function (k) {
            state.settings[k] = data.settings[k] !== undefined ? data.settings[k] : DEFAULTS[k];
          });
        } else {
          state.settings = DEFAULTS;
        }
      })
      .then(function () {
        state.loaded = true;
        if (!state.wired) {
          wireShippingMethods();
          wirePromo();
          wirePlaceOrder();
          state.wired = true;
        }
        renderShippingMethodPrices();
        updateDeliveryUI();
      });
    refreshQuote();
  }

  document.addEventListener('langchange', function () { if (state.loaded) renderShippingMethodPrices(); renderSummary(); renderReturnPolicy(); });
  init();
})();
