/**
 * Hanna & Nour - Success page: fills the confirmation from the Stripe session.
 * Kept as an external file (CSP script-src 'self' blocks inline scripts).
 */
(function () {
  'use strict';
  function qs(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }
  var sessionId = qs('session_id');
  if (!sessionId || typeof window.HN !== 'object' || !window.HN.api) return;

  var box = document.getElementById('orderDetails');
  var numEl = document.getElementById('successOrderNumber');
  var totalEl = document.getElementById('successOrderTotal');

  fetch(window.HN.api('orders') + '?session_id=' + encodeURIComponent(sessionId))
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var order = data.order || (data.orders && data.orders[0]) || null;
      if (!order) return;
      if (numEl) numEl.textContent = order.order_number || order.id || '-';
      if (totalEl) totalEl.textContent = window.HN.money(order.total_cents);
      if (box) box.style.display = '';
    })
    .catch(function () {});
})();