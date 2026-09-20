/**
 * Checkout page: builds the cart summary, collects shipping details and
 * redirects to the Stripe Checkout Session created by /api/checkout.
 * Credit-card entry happens on Stripe's hosted page.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var TAX_RATE = 0.07;
  var FREE_SHIPPING_CENTS = 7500;
  var SHIP_RATES = { standard: 699, express: 1200, next_day: 2500 };
  var PROMO_LOCAL = { WELCOME15: 0.15 };

  var state = { method: 'standard' };

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
    var items = HN.cart.list();
    var subtotal = 0;
    for (var i = 0; i < items.length; i++) subtotal += (items[i].priceCents || 0) * (items[i].qty || 1);
    var rate = PROMO_LOCAL[getPromo()] || 0;
    var discount = Math.round(subtotal * rate);
    var shipping = state.method === 'standard' && subtotal >= FREE_SHIPPING_CENTS ? 0 : SHIP_RATES[state.method];
    var tax = Math.round((subtotal - discount) * TAX_RATE);
    var total = subtotal + shipping + tax - discount;
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

  function wireShippingMethods() {
    var methods = document.querySelectorAll('.payment-method[data-method]');
    methods.forEach(function (m) {
      m.addEventListener('click', function () {
        methods.forEach(function (x) { x.classList.remove('selected'); });
        m.classList.add('selected');
        state.method = m.getAttribute('data-method');
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
      var payload = {
        items: items.map(function (it) {
          return { slug: it.slug, qty: it.qty || 1, color: it.color || '', size: it.size || '' };
        }),
        email: email,
        customer_name: name,
        phone: val('contactPhone'),
        address1: val('address1'),
        address2: val('address2'),
        city: val('city'),
        state: val('state'),
        postal_code: val('postalCode'),
        country: val('country'),
        shipping_method: state.method,
        promo: getPromo()
      };

      if (!email || !name || !payload.address1 || !payload.city || !payload.postal_code) {
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
    renderSummary();
    wireShippingMethods();
    wirePromo();
    wirePlaceOrder();

    document.addEventListener('langchange', function () { renderSummary(); });
  }

  init();
})();