/**
 * Account page: look up real orders by email and render the persisted wishlist.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  function statusText(status) {
    var key = {
      paid: 'orderPaid', pending: 'orderPending', abandoned: 'orderAbandoned', refunded: 'orderRefunded'
    }[status];
    return key ? tr(key) : status;
  }

  function shippingText(s) {
    var key = s === 'shipped' ? 'shipShipped' : s === 'delivered' ? 'shipDelivered' : null;
    return key ? tr(key) : '';
  }

  function renderOrders(orders) {
    var box = document.getElementById('accountOrders');
    if (!box) return;

    if (!orders || !orders.length) {
      box.innerHTML = '<p style="color: var(--color-gray); padding: var(--spacing-lg) 0;">' + tr('ordersEmpty') + '</p>';
      return;
    }

    var html = '';
    orders.forEach(function (o) {
      var date = o.created_at ? new Date(o.created_at).toLocaleDateString() : '';
      var items = o.order_items || [];
      var itemsHtml = '';
      items.forEach(function (it) {
        itemsHtml +=
          '<div class="order-item">' +
          '  <div class="order-item-image"><img src="' + (it.image || 'images/hero.jpg') + '" alt=""></div>' +
          '  <div class="order-item-info">' +
          '    <p class="order-item-name">' + (it.product_name || '') + '</p>' +
          '    <p class="order-item-variant">' + tr('qtyVar', { n: it.quantity || 1 }) + '</p>' +
          '  </div>' +
          '  <span class="order-item-price">' + HN.money(it.unit_price_cents) + '</span>' +
          '</div>';
      });

      html +=
        '<div class="order-card">' +
        '  <div class="order-header">' +
        '    <div><p class="order-number">' + (o.order_number || '') + '</p>' +
        '    <p class="order-date">' + tr('placedOnN', { d: date }) + '</p></div>' +
        '    <div style="text-align: right;"><span class="order-status">' + statusText(o.status) + '</span>' +
        (o.shipping_status && shippingText(o.shipping_status) ? '<span class="order-status" style="display:block; margin-top:6px;">' + shippingText(o.shipping_status) + '</span>' : '') +
        '    </div>' +
        '  </div>' +
        (o.tracking_number ? '<p style="margin: 8px 0 0; font-size: 0.875rem; color: var(--color-gray);">' + tr('trackingN', { n: o.tracking_number }) + '</p>' : '') +
        (o.delivery_type === 'pickup' && o.pickup_point ? '<p style="margin: 6px 0 0; font-size: 0.875rem; color: var(--color-gray);">' + tr('pickupPoint') + ' : ' + o.pickup_point + '</p>' : '') +
        '  <div class="order-items">' + itemsHtml +
        '    <div class="order-item">' +
        '      <div style="flex: 1;"></div>' +
        '      <div class="order-item-info" style="text-align: right; flex: none;">' +
        '        <p class="order-item-name">' + tr('orderTotal') + '</p>' +
        '      </div>' +
        '      <span class="order-item-price">' + HN.money(o.total_cents) + '</span>' +
        '    </div>' +
        '  </div>' +
        '</div>';
    });
    box.innerHTML = html;
  }

  function wireOrderLookup() {
    var form = document.getElementById('accountOrderForm');
    var emailEl = document.getElementById('accountEmail');
    if (!form || !emailEl) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = emailEl.value.trim().toLowerCase();
      if (!email) return;

      fetch(HN.api('orders') + '?email=' + encodeURIComponent(email))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.error) throw new Error(data.error);
          renderOrders(data.orders || []);
        })
        .catch(function () {
          renderOrders([]);
          window.hnToast && hnToast(tr('ordersError'), tr('demoMsg'), 'error');
        });
    });
  }

  /* ---------------- Auth-backed account ---------------- */

  function loadAccountOrders() {
    if (!window.HN_AUTH || !HN_AUTH.isAuthed()) return;
    HN_AUTH.call({ action: 'orders' }, true)
      .then(function (data) { renderOrders(data.orders || []); })
      .catch(function () {
        renderOrders([]);
        window.hnToast && hnToast(tr('ordersError'), tr('demoMsg'), 'error');
      });
  }

  function setAuthError(msg) {
    var el = document.getElementById('authError');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }

  function setBusy(form, busy) {
    var btn = form ? form.querySelector('button[type="submit"]') : null;
    if (btn) btn.disabled = busy;
  }

  function renderAuthState() {
    var user = window.HN_AUTH ? HN_AUTH.currentUser() : null;
    var authPanel = document.getElementById('authPanel');
    var accountPanel = document.getElementById('accountPanel');
    var orderForm = document.getElementById('accountOrderForm');
    var box = document.getElementById('accountOrders');

    if (user) {
      if (authPanel) authPanel.style.display = 'none';
      if (accountPanel) accountPanel.style.display = 'block';
      if (orderForm) orderForm.style.display = 'none';
      if (box) {
        var greet = document.getElementById('accountGreeting');
        if (greet) greet.textContent = tr('authWelcome').replace('{n}', user.first_name || user.email || '');
      }
      loadAccountOrders();
    } else {
      if (authPanel) authPanel.style.display = 'block';
      if (accountPanel) accountPanel.style.display = 'none';
      if (orderForm) orderForm.style.display = 'flex';
    }
  }

  function wireAuth() {
    var tabLogin = document.getElementById('authTabLogin');
    var tabSignup = document.getElementById('authTabSignup');
    var loginForm = document.getElementById('loginForm');
    var signupForm = document.getElementById('signupForm');
    var intro = document.getElementById('authIntro');
    var logoutBtn = document.getElementById('logoutBtn');

    function showTab(isSignup) {
      if (tabLogin) tabLogin.classList.toggle('is-active', !isSignup);
      if (tabSignup) tabSignup.classList.toggle('is-active', isSignup);
      if (loginForm) loginForm.style.display = isSignup ? 'none' : 'flex';
      if (signupForm) signupForm.style.display = isSignup ? 'flex' : 'none';
      if (intro) {
        intro.removeAttribute('data-i18n');
        intro.setAttribute('data-i18n', isSignup ? 'authCreateIntro' : 'authLoginIntro');
        intro.textContent = tr(isSignup ? 'authCreateIntro' : 'authLoginIntro');
      }
    }

    if (tabLogin) tabLogin.addEventListener('click', function () { setAuthError(''); showTab(false); });
    if (tabSignup) tabSignup.addEventListener('click', function () { setAuthError(''); showTab(true); });

    if (loginForm) loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      setAuthError('');
      setBusy(loginForm, true);
      HN_AUTH.login(
        document.getElementById('loginEmail').value.trim(),
        document.getElementById('loginPassword').value
      ).then(function () {
        setBusy(loginForm, false);
        setAuthError('');
        renderAuthState();
        window.hnToast && hnToast(tr('cartAdd'), tr('authWelcome').replace('{n}', '').trim(), 'success');
      }).catch(function (err) {
        setBusy(loginForm, false);
        setAuthError(err && err.code === 'bad_credentials' ? tr('authBadCredentials') : tr('authGenericError'));
      });
    });

    if (signupForm) signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      setAuthError('');
      setBusy(signupForm, true);
      HN_AUTH.signup(
        document.getElementById('signupName').value.trim(),
        document.getElementById('signupEmail').value.trim(),
        document.getElementById('signupPassword').value
      ).then(function () {
        setBusy(signupForm, false);
        setAuthError('');
        renderAuthState();
        window.hnToast && hnToast(tr('cartAdd'), tr('authGenericError'), 'success');
      }).catch(function (err) {
        setBusy(signupForm, false);
        setAuthError(
          err && err.code === 'email_taken' ? tr('authEmailTaken') : tr('authGenericError')
        );
      });
    });

    if (logoutBtn) logoutBtn.addEventListener('click', function () {
      HN_AUTH.logout().then(function () {
        renderOrders(null);
        renderAuthState();
        window.hnToast && hnToast(tr('cartAdd'), tr('authLogout'), 'success');
      });
    });

    document.addEventListener('hn:auth', renderAuthState);
  }

  function init() {
    wireOrderLookup();
    wireWishlistGrid();
    wireAuth();

    if (window.HN_AUTH && HN_AUTH.ready) {
      HN_AUTH.ready.then(function () { renderAuthState(); }).catch(function () { renderAuthState(); });
    } else {
      renderAuthState();
    }

    HN.loadProducts().then(function () {
      renderWishlist();
    }).catch(function () {
      renderWishlist();
    });
    document.addEventListener('langchange', function () { renderWishlist(); renderAuthState(); });
    // Re-render live when a heart is toggled (hex, event bubbles from store.js).
    document.addEventListener('hn:wishlist', function () { renderWishlist(); });
  }

  function wishlistCard(p) {
    var name = HN.productName(p);
    var url = 'product.html?slug=' + encodeURIComponent(p.slug);
    return '<div class="product-card" data-slug="' + p.slug + '">' +
      '  <a class="product-card-image" href="' + url + '" style="display:block; aspect-ratio: 3/4;">' +
      '    <img src="' + (p.image || 'images/hero.jpg') + '" alt="' + name.replace(/"/g, '&quot;') + '">' +
      '  </a>' +
      '  <div class="product-card-info">' +
      '    <a href="' + url + '"><h3 class="product-card-title">' + name + '</h3></a>' +
      '    <div class="product-card-price"><span class="product-price-current">' + HN.money(p.price_cents) + '</span></div>' +
      '    <button class="btn btn-primary btn-sm wishlist-add" style="width: 100%; margin-top: var(--spacing-sm);">' + tr('addToCart') + '</button>' +
      '    <button class="btn btn-secondary btn-sm wishlist-remove" style="width: 100%; margin-top: var(--spacing-xs);">' + tr('removeProduct') + '</button>' +
      '  </div>' +
      '</div>';
  }

  function wireWishlistGrid() {
    var grid = document.getElementById('wishlistGrid');
    if (!grid) return;
    grid.addEventListener('click', function (e) {
      var remove = e.target.closest('.wishlist-remove');
      var add = e.target.closest('.wishlist-add');
      var card = e.target.closest('.product-card');
      if (!card) return;
      var slug = card.getAttribute('data-slug');
      if (remove) {
        HN.wishlist.toggle(slug);
        renderWishlist();
      }
      if (add && slug) {
        var p2 = HN.getProduct(slug);
        if (p2) {
          HN.cart.add({ slug: p2.slug, name_en: p2.name_en, price_cents: p2.price_cents, image: p2.image }, {});
          window.hnToast && hnToast(tr('cartAdd'), HN.productName(p2) + ' ' + tr('cartAddMsg'), 'success');
        }
      }
    });
  }

  function renderWishlist() {
    var grid = document.getElementById('wishlistGrid');
    var countEl = document.getElementById('wishlistCount');
    if (!grid) return;

    var slugs = HN.wishlist.list();
    if (countEl) countEl.textContent = slugs.length + ' ' + tr(slugs.length <= 1 ? 'wishItem' : 'wishItems');

    var products = [];
    slugs.forEach(function (s) {
      var p = HN.getProduct(s);
      if (!p) p = { slug: s, name_en: s, image: '' };
      products.push(p);
    });

    if (!products.length) {
      grid.innerHTML = '<p style="color: var(--color-gray); grid-column: 1/-1;">' + tr('wishlistEmpty') + '</p>';
      return;
    }
    grid.innerHTML = products.map(wishlistCard).join('');
  }

  init();
})();