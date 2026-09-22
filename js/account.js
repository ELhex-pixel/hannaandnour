/**
 * Account page: look up real orders by email and render the persisted wishlist.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  function statusText(status) {
    var map = { paid: 'Delivered', pending: 'Processing', abandoned: 'Abandoned', refunded: 'Refunded' };
    var key = {
      paid: 'orderPaid', pending: 'orderPending', abandoned: 'orderAbandoned', refunded: 'orderRefunded'
    }[status];
    return key ? tr(key) : (map[status] || status);
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

  function wishlistCard(p) {
    var name = HN.productName(p);
    return '<div class="product-card" data-slug="' + p.slug + '">' +
      '  <div class="product-card-image" style="aspect-ratio: 3/4;">' +
      '    <img src="' + (p.image || 'images/hero.jpg') + '" alt="' + name.replace(/"/g, '&quot;') + '">' +
      '  </div>' +
      '  <div class="product-card-info">' +
      '    <h3 class="product-card-title">' + name + '</h3>' +
      '    <div class="product-card-price"><span class="product-price-current">' + HN.money(p.price_cents) + '</span></div>' +
      '    <button class="btn btn-primary btn-sm wishlist-add btn-sm" style="width: 100%; margin-top: var(--spacing-sm);">' + tr('addToCart') + '</button>' +
      '    <button class="btn btn-secondary btn-sm wishlist-remove btn-sm" style="width: 100%; margin-top: var(--spacing-xs);">' + tr('removeProduct') + '</button>' +
      '  </div>' +
      '</div>';
  }

  function renderWishlist() {
    var grid = document.getElementById('wishlistGrid');
    var countEl = document.getElementById('wishlistCount');
    if (!grid) return;

    var slugs = HN.wishlist.list();
    if (countEl) countEl.textContent = slugs.length + ' ' + (slugs.length <= 1 ? 'item' : 'items');

    var products = [];
    slugs.forEach(function (s) {
      var p = HN.getProduct(s);
      if (p) products.push(p);
    });

    if (!products.length) {
      grid.innerHTML = '<p style="color: var(--color-gray); grid-column: 1/-1;">' + tr('wishlistEmpty') + '</p>';
      return;
    }
    grid.innerHTML = products.map(wishlistCard).join('');

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

  function init() {
    wireOrderLookup();
    HN.loadProducts().then(function () {
      renderWishlist();
    }).catch(function () {
      renderWishlist();
    });
    document.addEventListener('langchange', function () { renderWishlist(); });
  }

  init();
})();