/**
 * Account page: look up real orders by email and render the persisted wishlist.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;
  var orderRequest = 0;

  function emptyState(message) {
    return '<div class="account-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v10"/></svg><p>' + esc(message) + '</p><a class="btn btn-secondary" href="shop.html">' + tr('accountDiscover') + '</a></div>';
  }

  function statusText(status) {
    var key = {
      paid: 'orderPaid', pending: 'orderPending', abandoned: 'orderAbandoned', refunded: 'orderRefunded',
      cancelled: 'orderCancelled', payment_failed: 'orderPaymentFailed'
    }[status];
    return key ? tr(key) : status;
  }

  function shippingText(s) {
    var key = s === 'new' ? 'shipPending' : s === 'shipped' ? 'shipShipped' : s === 'delivered' ? 'shipDelivered' : null;
    return key ? tr(key) : '';
  }

  function renderOrders(orders) {
    var box = document.getElementById('accountOrders');
    if (!box) return;

    if (!orders || !orders.length) {
      box.innerHTML = emptyState(tr('ordersEmpty'));
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
          '  <div class="order-item-image"><img src="' + esc(it.image || 'images/hero.jpg') + '" alt=""></div>' +
          '  <div class="order-item-info">' +
          '    <p class="order-item-name">' + esc(it.product_name || '') + '</p>' +
          '    <p class="order-item-variant">' + tr('qtyVar', { n: it.quantity || 1 }) + '</p>' +
          '  </div>' +
          '  <span class="order-item-price">' + orderMoney(it.unit_price_cents, o.currency) + '</span>' +
          '</div>';
      });

      html +=
        '<div class="order-card">' +
        '  <div class="order-header">' +
        '    <div><p class="order-number">' + esc(o.order_number || '') + '</p>' +
        '    <p class="order-date">' + tr('placedOnN', { d: date }) + '</p></div>' +
        '    <div style="text-align: right;"><span class="order-status">' + statusText(o.status) + '</span>' +
        (o.shipping_status && shippingText(o.shipping_status) ? '<span class="order-status" style="display:block; margin-top:6px;">' + shippingText(o.shipping_status) + '</span>' : '') +
        '    </div>' +
        '  </div>' +
        (o.tracking_number ? '<p style="margin: 8px 0 0; font-size: 0.875rem; color: var(--color-gray);">' + tr('trackingN', { n: esc(o.tracking_number) }) + '</p>' : '') +
        (o.delivery_type === 'pickup' && o.pickup_point ? '<p style="margin: 6px 0 0; font-size: 0.875rem; color: var(--color-gray);">' + tr('pickupPoint') + ' : ' + esc(o.pickup_point) + '</p>' : '') +
        '  <div class="order-items">' + itemsHtml +
        '    <div class="order-item">' +
        '      <div style="flex: 1;"></div>' +
        '      <div class="order-item-info" style="text-align: right; flex: none;">' +
        '        <p class="order-item-name">' + tr('orderTotal') + '</p>' +
        '      </div>' +
        '      <span class="order-item-price">' + orderMoney(o.total_cents, o.currency) + '</span>' +
        '    </div>' +
        '  </div>' +
        '</div>';
    });
    box.innerHTML = html;
  }

  /* ---------------- Auth-backed account ---------------- */

  function dateVal(id) {
    var el = document.getElementById(id);
    return el && el.value ? el.value.trim() : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function orderMoney(cents, currency) { return (currency === 'eur' ? '€' : '$') + (cents / 100).toFixed(2); }

  function loadAccountOrders() {
    if (!window.HN_AUTH) return;
    var requestId = ++orderRequest;
    var box = document.getElementById('accountOrders');
    if (box) {
      box.innerHTML = '<p class="account-feedback" role="status">' + tr('ordersLoading') + '</p>';
      box.setAttribute('aria-busy', 'true');
    }
    var payload = { action: 'orders' };
    var from = dateVal('orderFilterFrom');
    var to = dateVal('orderFilterTo');
    if (from) payload.from = from;
    if (to) payload.to = to;
    HN_AUTH.call(payload, true)
      .then(function (data) {
        if (requestId !== orderRequest) return;
        if (box) box.setAttribute('aria-busy', 'false');
        renderOrders(data.orders || []);
      })
      .catch(function (err) {
        if (requestId !== orderRequest) return;
        var msg = (err && err.message) || tr('ordersError');
        if (box) {
          box.setAttribute('aria-busy', 'false');
          box.innerHTML = '<p class="account-feedback is-error" role="alert">' + tr('ordersError') + '</p>';
        }
        window.hnToast && hnToast(tr('ordersError'), msg, 'error');
      });
  }

  function wireOrderFilter() {
    var apply = document.getElementById('orderFilterApply');
    var reset = document.getElementById('orderFilterReset');
    if (apply) apply.addEventListener('click', function () { loadAccountOrders(); });
    if (reset) reset.addEventListener('click', function () {
      var from = document.getElementById('orderFilterFrom');
      var to = document.getElementById('orderFilterTo');
      if (from) from.value = '';
      if (to) to.value = '';
      loadAccountOrders();
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
    var box = document.getElementById('accountOrders');
    var wishSection = document.getElementById('wishlist');
    var privateLinks = document.querySelectorAll('[data-account-private]');
    var ordersSection = document.getElementById('orders');
    var sidebarName = document.getElementById('accountSidebarName');
    var avatar = document.getElementById('accountAvatar');
    var navigation = document.querySelector('.account-nav');
    var sidebar = document.querySelector('.account-sidebar');
    var orderFilter = document.getElementById('orderFilter');
    Array.prototype.forEach.call(privateLinks, function (link) { link.style.display = user ? '' : 'none'; });
    if (navigation) navigation.hidden = !user;
    if (sidebar) sidebar.classList.toggle('is-guest', !user);
    if (ordersSection) ordersSection.style.display = user ? 'block' : 'none';
    if (orderFilter) orderFilter.style.display = user ? 'grid' : 'none';
    if (sidebarName) {
      sidebarName.removeAttribute('data-i18n');
      sidebarName.textContent = user ? (user.first_name || tr('accountMember')) : tr('accountSpace');
    }
    if (avatar) avatar.textContent = user && user.first_name ? user.first_name.trim().slice(0, 2).toUpperCase() : 'HN';

    if (user) {
      if (authPanel) authPanel.style.display = 'none';
      if (accountPanel) accountPanel.style.display = 'block';
      if (box) {
        var greet = document.getElementById('accountGreeting');
        if (greet) greet.textContent = tr('authWelcome').replace('{n}', user.first_name || tr('accountMember'));
      }
      if (wishSection) wishSection.style.display = 'block';
      loadAccountOrders();
    } else {
      orderRequest++;
      if (authPanel) authPanel.style.display = 'block';
      if (accountPanel) accountPanel.style.display = 'none';
      if (box) {
        box.innerHTML = '';
        box.setAttribute('aria-busy', 'false');
      }
      if (wishSection) wishSection.style.display = 'none';
    }
  }

  function wireAccountNavigation() {
    var links = document.querySelectorAll('.account-nav-link');
    function update() {
      var target = window.location.hash || '#orders';
      Array.prototype.forEach.call(links, function (link) {
        var href = link.getAttribute('href');
        var active = href.slice(href.indexOf('#')) === target;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }
    window.addEventListener('hashchange', update);
    update();
  }

  function wireAuth() {
    var tabLogin = document.getElementById('authTabLogin');
    var tabSignup = document.getElementById('authTabSignup');
    var loginForm = document.getElementById('loginForm');
    var signupForm = document.getElementById('signupForm');
    var forgotForm = document.getElementById('forgotForm');
    var forgotToggle = document.getElementById('forgotToggle');
    var intro = document.getElementById('authIntro');
    var logoutBtn = document.getElementById('logoutBtn');

    function showTab(isSignup) {
      if (tabLogin) tabLogin.classList.toggle('is-active', !isSignup);
      if (tabSignup) tabSignup.classList.toggle('is-active', isSignup);
      if (tabLogin) tabLogin.setAttribute('aria-pressed', String(!isSignup));
      if (tabSignup) tabSignup.setAttribute('aria-pressed', String(isSignup));
      if (loginForm) loginForm.style.display = isSignup ? 'none' : 'flex';
      if (signupForm) signupForm.style.display = isSignup ? 'flex' : 'none';
      if (forgotToggle) forgotToggle.style.display = isSignup ? 'none' : '';
      if (forgotForm) forgotForm.style.display = 'none';
      if (intro) {
        intro.removeAttribute('data-i18n');
        intro.setAttribute('data-i18n', isSignup ? 'authCreateIntro' : 'authLoginIntro');
        intro.textContent = tr(isSignup ? 'authCreateIntro' : 'authLoginIntro');
      }
    }

    // Retour automatique après connexion (lien « next » relatif, même site),
    // utilisé par la page d'avis (« Votre avis nous intéresse »).
    function redirectAfterAuth() {
      var m = window.location.search.match(/[?&]next=([^&]+)/);
      if (!m) return;
      var next = decodeURIComponent(m[1]);
      if (next && next.indexOf('http') !== 0 && next.indexOf('/') !== 0) {
        window.location.href = next;
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
        redirectAfterAuth();
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
      ).then(function (result) {
        setBusy(signupForm, false);
        if (result && result.confirmation_required) {
          setAuthError(tr('authConfirmationSent'));
          return;
        }
        setAuthError('');
        renderAuthState();
        redirectAfterAuth();
        window.hnToast && hnToast(tr('cartAdd'), tr('authGenericError'), 'success');
      }).catch(function (err) {
        setBusy(signupForm, false);
        setAuthError(
          err && err.code === 'email_taken' ? tr('authEmailTaken') : tr('authGenericError')
        );
      });
    });

    if (forgotToggle && forgotForm) {
      var fEmail = document.getElementById('forgotEmail');
      var fSubmit = document.getElementById('forgotSubmit');
      var fMsg = document.getElementById('forgotMsg');
      var fBack = document.getElementById('forgotBack');

      function resetForgot() {
        if (fSubmit) fSubmit.disabled = false;
        if (fMsg) { fMsg.style.display = 'none'; fMsg.classList.remove('auth-msg-error'); }
      }

      forgotToggle.addEventListener('click', function () {
        setAuthError('');
        resetForgot();
        if (loginForm) loginForm.style.display = 'none';
        forgotForm.style.display = 'flex';
      });
      if (fBack) fBack.addEventListener('click', function () {
        resetForgot();
        forgotForm.style.display = 'none';
        if (loginForm) loginForm.style.display = 'flex';
      });
      forgotForm.addEventListener('submit', function (e) {
        e.preventDefault();
        resetForgot();
        if (!fEmail || !fSubmit) return;
        setBusy(forgotForm, true);
        window.HN_AUTH.forgotPassword(fEmail.value.trim())
          .then(function () {
            setBusy(forgotForm, false);
            fEmail.value = '';
            fSubmit.disabled = true;
            if (fMsg) { fMsg.textContent = tr('forgotSent'); fMsg.style.display = 'block'; }
          })
          .catch(function (err) {
            setBusy(forgotForm, false);
            if (!fMsg) return;
            fMsg.classList.add('auth-msg-error');
            fMsg.textContent = (err && err.code === 'rate_limited') ? tr('forgotRateLimit') : tr('forgotError');
            fMsg.style.display = 'block';
          });
      });
    }

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
    wireAccountNavigation();
    wireWishlistGrid();
    wireOrderFilter();
    wireAuth();

    // Render immediately from the stored session (auth.js already loaded it
    // into memory), then re-render once the network restore (me/refresh) settles.
    renderAuthState();
    if (window.HN_AUTH && HN_AUTH.ready) {
      HN_AUTH.ready.then(function () { renderAuthState(); }).catch(function () { renderAuthState(); });
    }

    HN.loadProductSlugs(HN.wishlist.list()).then(function () {
      renderWishlist();
    }).catch(function () {
      renderWishlist();
    });
    document.addEventListener('langchange', function () { renderWishlist(); renderAuthState(); });
    // Re-render live when a heart is toggled (hex, event bubbles from store.js).
    document.addEventListener('hn:wishlist', function () {
      renderWishlist();
      var missing = HN.wishlist.list().filter(function (slug) { return !HN.getProduct(slug); });
      if (missing.length) HN.loadProductSlugs(missing).then(renderWishlist).catch(function () {});
    });
  }

  function wishlistCard(p) {
    var name = HN.productName(p);
    var url = 'product.html?slug=' + encodeURIComponent(p.slug);
    return '<div class="product-card" data-slug="' + p.slug + '">' +
      '  <a class="product-card-image" href="' + url + '" style="display:block; aspect-ratio: 3/4;">' +
      '    <img src="' + esc(p.image || 'images/hero.jpg') + '" alt="' + esc(name) + '">' +
      '  </a>' +
      '  <div class="product-card-info">' +
      '    <a href="' + url + '"><h3 class="product-card-title">' + esc(name) + '</h3></a>' +
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
      grid.innerHTML = emptyState(tr('wishlistEmpty'));
      return;
    }
    grid.innerHTML = products.map(wishlistCard).join('');
  }

  init();
})();
