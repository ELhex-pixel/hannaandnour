/* A Stripe return is not proof of capture: wait for server confirmation. */
(function () {
  'use strict';
  var HN = window.HN, sessionId = new URLSearchParams(window.location.search).get('session_id');
  if (!HN) return;
  var timer, busy = false, attempts = 0, settled = false, cleared = false;
  var refresh = document.getElementById('paymentRefresh');
  function show(title, description) {
    document.querySelectorAll('[data-payment-title]').forEach(function (node) { node.setAttribute('data-i18n', title); node.textContent = HN.tr(title); });
    var text = document.getElementById('paymentResultDescription'); text.setAttribute('data-i18n', description); text.textContent = HN.tr(description);
  }
  function check() {
    if (busy || settled || !sessionId) return;
    clearTimeout(timer); busy = true; refresh.disabled = true; attempts++;
    HN.request(HN.api('orders') + '?session_id=' + encodeURIComponent(sessionId)).then(function (data) {
      var order = data.order;
      if (!order) return;
      document.getElementById('successOrderNumber').textContent = order.order_number;
      document.getElementById('successOrderTotal').textContent = (order.total_cents / 100).toFixed(2) + ' ' + String(order.currency || '').toUpperCase();
      document.getElementById('orderDetails').style.display = '';
      if (order.status === 'paid') {
        settled = true; show('successTitle', 'successDesc');
        var icon = document.getElementById('paymentConfirmedIcon'); icon.hidden = false; icon.style.display = 'flex'; refresh.hidden = true;
        if (!cleared && HN.cart) { cleared = true; HN.cart.clear(); try { sessionStorage.removeItem('hn-promo'); } catch (error) {} if (HN.refreshBadge) HN.refreshBadge(); }
      } else if (['abandoned','payment_failed','cancelled','refunded'].indexOf(order.status) >= 0) {
        settled = true; show(order.status === 'refunded' ? 'orderRefunded' : 'paymentNotCompletedTitle', 'paymentNotCompletedDescription'); refresh.hidden = true;
      }
    }).catch(function () { show('paymentCheckingTitle', 'paymentVerificationUnavailable'); }).finally(function () {
      busy = false; refresh.disabled = false;
      if (!settled && attempts < 15 && !document.hidden) timer = setTimeout(check, 2000);
    });
  }
  refresh.addEventListener('click', function () { attempts = 0; check(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) clearTimeout(timer); else if (!settled && attempts < 15) check(); });
  if (!sessionId) { show('paymentNotCompletedTitle', 'paymentVerificationUnavailable'); refresh.hidden = true; }
  else check();
})();
