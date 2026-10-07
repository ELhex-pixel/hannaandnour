(function () {
  'use strict';
  var HN = window.HN;
  var auth = window.HN_AUTH;
  var orders = [];
  var requests = [];
  function tr(key) { return HN.tr(key); }
  function el(tag, text, parent) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function request(endpoint, data) {
    return fetch(HN.api(endpoint), {
      method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token() },
      body: data ? JSON.stringify(data) : undefined
    }).then(function (res) { return res.json().then(function (body) { if (!res.ok) throw new Error(body.error); return body; }); });
  }
  var portal = document.getElementById('accountServices');
  var claim = document.getElementById('accountClaimContent');
  var returns = document.getElementById('accountReturnsContent');
  var message = document.getElementById('accountServicesMessage');
  var version = 0;
  var owner = null;
  if (!portal || !claim || !returns || !message) return;

  function notify(node, key, failed) {
    node.textContent = tr(key);
    node.hidden = false;
    node.classList.toggle('is-error', !!failed);
    node.setAttribute('role', failed ? 'alert' : 'status');
  }

  function render() {
    claim.textContent = '';
    returns.textContent = '';
    el('p', tr('claimGuestHelp'), claim).className = 'account-service-description';
    var send = el('button', tr('claimGuestSend'), claim);
    send.className = 'btn btn-secondary btn-sm';
    send.type = 'button';
    var claimForm = el('form', '', claim);
    claimForm.className = 'account-claim-form';
    var codeLabel = el('label', '', claimForm);
    codeLabel.className = 'account-field';
    el('span', tr('claimGuestCode'), codeLabel);
    var code = el('input', '', codeLabel);
    code.className = 'form-input';
    code.type = 'text';
    code.required = true;
    code.pattern = '[0-9]{6}';
    code.maxLength = 6;
    code.inputMode = 'numeric';
    code.autocomplete = 'one-time-code';
    code.setAttribute('aria-label', tr('claimGuestCode'));
    code.placeholder = tr('claimGuestCode');
    var confirm = el('button', tr('claimGuestConfirm'), claimForm);
    confirm.type = 'submit';
    confirm.className = 'btn btn-primary btn-sm';
    var claimMessage = el('p', '', claim);
    claimMessage.className = 'account-feedback account-service-message';
    claimMessage.setAttribute('role', 'status');
    send.addEventListener('click', function () {
      send.disabled = true;
      auth.call({ action: 'requestOrderClaim' }, true).then(function () { notify(claimMessage, 'claimGuestSent'); code.focus(); })
        .catch(function () { notify(claimMessage, 'accountServiceError', true); }).finally(function () { send.disabled = false; });
    });
    claimForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!/^[0-9]{6}$/.test(code.value)) { notify(claimMessage, 'accountCodeInvalid', true); return; }
      confirm.disabled = true;
      auth.call({ action: 'confirmOrderClaim', code: code.value }, true).then(function () { notify(message, 'claimGuestDone'); document.dispatchEvent(new CustomEvent('hn:auth')); })
        .catch(function () { notify(claimMessage, 'accountCodeError', true); }).finally(function () { confirm.disabled = false; });
    });

    el('p', tr('returnPortalHelp'), returns).className = 'account-service-description';
    var returnMessage = el('p', '', returns);
    returnMessage.className = 'account-feedback account-service-message';
    returnMessage.setAttribute('role', 'status');
    var paid = orders.filter(function (order) { return order.status === 'paid'; });
    if (!paid.length && !requests.length) el('p', tr('accountReturnsEmpty'), returns).className = 'account-empty';
    paid.forEach(function (order) {
      var card = el('div', '', returns);
      card.className = 'account-return-order';
      el('h3', order.order_number, card);
      var track = el('button', tr('trackOrder'), card);
      track.className = 'btn btn-secondary btn-sm';
      var status = el('p', '', card);
      status.className = 'account-tracking-status';
      status.setAttribute('role', 'status');
      track.addEventListener('click', function () {
        track.disabled = true;
        request('tracking?order_id=' + encodeURIComponent(order.id)).then(function (data) {
          var o = data.order;
          status.textContent = [tr(o.shipping_status === 'delivered' ? 'shipDelivered' : o.shipping_status === 'shipped' ? 'shipShipped' : 'shipPending'), o.shipped_at ? new Date(o.shipped_at).toLocaleDateString() : '', o.tracking_number || ''].filter(Boolean).join(' — ');
          if (data.tracking_url) {
            var link = el('a', tr('trackCarrier'), status);
            link.href = data.tracking_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
        }).catch(function () { notify(status, 'accountServiceError', true); }).finally(function () { track.disabled = false; });
      });
      if (order.shipping_status !== 'delivered') return;
      (order.order_items || []).forEach(function (item) {
        var form = el('form', '', card);
        form.className = 'account-return-form';
        var label = el('p', item.product_name, form);
        label.className = 'order-item-name';
        var qty = el('input', '', form);
        qty.type = 'number'; qty.min = 1; qty.max = item.quantity; qty.value = 1;
        qty.className = 'form-input'; qty.setAttribute('aria-label', tr('a11yQty'));
        var reason = el('textarea', '', form);
        reason.className = 'form-input'; reason.required = true; reason.minLength = 3; reason.maxLength = 1000;
        reason.placeholder = tr('returnReason'); reason.setAttribute('aria-label', tr('returnReason'));
        var photo = el('input', '', form);
        photo.type = 'file'; photo.accept = 'image/jpeg,image/png,image/webp'; photo.setAttribute('aria-label', tr('returnPhoto'));
        el('p', tr('returnPhoto'), form);
        var button = el('button', tr('returnSubmit'), form);
        button.type = 'submit'; button.className = 'btn btn-secondary btn-sm';
        form.addEventListener('submit', function (event) {
          event.preventDefault(); button.disabled = true;
          var file = photo.files && photo.files[0];
          if (file && file.size > 2 * 1024 * 1024) { notify(returnMessage, 'returnPhoto', true); button.disabled = false; return; }
          var image = file ? new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result).split(',')[1]); }; reader.onerror = reject; reader.readAsDataURL(file); }) : Promise.resolve(null);
          image.then(function (base64) { return request('returns', { order_id: order.id, order_item_id: item.id, quantity: Number(qty.value), reason: reason.value, photo_base64: base64 }); }).then(function (data) {
            notify(message, data.evidence_saved ? 'returnSent' : 'returnPhotoFailed'); load();
          }).catch(function () { notify(returnMessage, 'accountServiceError', true); button.disabled = false; });
        });
      });
    });
    requests.forEach(function (r) { el('p', tr('returnPortalTitle') + ' — ' + r.quantity + ' — ' + tr('returnStatus_' + r.status) + ' — ' + r.reason, returns).className = 'account-return-request'; });
  }
  function load() {
    var current = ++version;
    var user = auth.currentUser();
    if (!user || user.id !== owner) {
      owner = user ? user.id : null;
      orders = []; requests = [];
      claim.textContent = ''; returns.textContent = ''; message.textContent = ''; message.hidden = true;
    }
    if (!user || !auth.isAuthed()) { portal.hidden = true; return; }
    portal.hidden = false;
    portal.setAttribute('aria-busy', 'true');
    Promise.all([auth.call({ action: 'orders' }, true), request('returns')]).then(function (data) {
      if (current !== version) return;
      orders = data[0].orders || []; requests = data[1].requests || []; render();
    }).catch(function () { if (current === version) notify(message, 'accountServiceError', true); })
      .finally(function () { if (current === version) portal.setAttribute('aria-busy', 'false'); });
  }
  document.addEventListener('hn:auth', load);
  document.addEventListener('langchange', function () { if (auth.currentUser()) render(); });
  auth.ready.then(load);
})();
