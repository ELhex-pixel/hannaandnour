/* Return from Stripe: expire the unpaid session before releasing its reservation. */
(function () {
  'use strict';
  var HN = window.HN;
  if (!HN) return;
  var key = 'hn-checkout-cancel', pending = null, active = null, notice, text, retry;
  function valid(value) { return value && /^[a-f0-9-]{36}$/i.test(value.order_id || '') && /^[a-f0-9]{64}$/.test(value.cancel_token || ''); }
  function remember(id, token) {
    var value = { order_id: id, cancel_token: token };
    if (!valid(value)) return false;
    pending = value;
    try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { return false; }
  }
  function show(message, failed) {
    if (!notice) {
      var holder = document.querySelector('main .container') || document.querySelector('main');
      if (!holder) return;
      notice = document.createElement('section'); notice.id = 'checkoutCancelNotice'; notice.className = 'checkout-cancel-notice';
      notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
      notice.style.cssText = 'padding:16px;margin:16px 0;border:1px solid var(--color-gold);border-radius:12px;';
      text = document.createElement('p'); retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-secondary';
      retry.addEventListener('click', run); notice.appendChild(text); notice.appendChild(retry); holder.insertBefore(notice, holder.firstChild);
    }
    text.textContent = HN.tr(message); retry.textContent = HN.tr('checkoutCancelRetry'); retry.hidden = !failed;
  }
  function clear() { pending = null; try { sessionStorage.removeItem(key); } catch (error) {} }
  function run() {
    if (active) return active;
    if (!pending) return Promise.resolve(true);
    show('checkoutCancelChecking', false);
    active = HN.request(HN.api('checkout'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', order_id: pending.order_id, cancel_token: pending.cancel_token }) })
      .then(function (data) {
        if (data.cancelled !== true) throw new Error();
        clear(); show('checkoutCancelDone', false); document.dispatchEvent(new CustomEvent('hn:checkout-cancelled')); return true;
      }).catch(function (error) {
        if (error.message === 'checkout_cancel_completed') {
          clear(); show('checkoutCancelCompleted', false); document.dispatchEvent(new CustomEvent('hn:checkout-cancelled')); return true;
        }
        show('checkoutCancelUnconfirmed', true); return false;
      }).finally(function () { active = null; });
    return active;
  }
  try {
    var url = new URL(window.location.href), id = url.searchParams.get('checkout_cancel'), token = url.searchParams.get('checkout_cancel_token');
    if (valid({ order_id: id, cancel_token: token })) {
      if (remember(id, token)) { url.searchParams.delete('checkout_cancel'); url.searchParams.delete('checkout_cancel_token'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
    } else {
      var saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (valid(saved)) pending = saved;
    }
  } catch (error) { /* URL-based cancellation remains available without storage. */ }
  window.HN_CHECKOUT_CANCEL = { remember: remember, run: run, pending: function () { return !!pending; } };
  window.HN_CHECKOUT_CANCEL.ready = run();
  window.addEventListener('pageshow', function (event) { if (event.persisted) run(); });
})();
