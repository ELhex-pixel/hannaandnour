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
  var parent = document.getElementById('accountPanel');
  if (!parent) return;
  var portal = el('section', '', parent);
  portal.className = 'order-card';
  portal.id = 'accountServices';
  var message = el('p', '', portal);
  message.setAttribute('role', 'status');
  var claim = el('div', '', portal);
  var returns = el('div', '', portal);

  function render() {
    claim.textContent = '';
    returns.textContent = '';
    el('h2', tr('claimGuestTitle'), claim);
    el('p', tr('claimGuestHelp'), claim);
    var send = el('button', tr('claimGuestSend'), claim);
    send.className = 'btn btn-secondary btn-sm';
    var code = el('input', '', claim);
    code.className = 'form-input';
    code.maxLength = 6;
    code.inputMode = 'numeric';
    code.setAttribute('aria-label', tr('claimGuestCode'));
    code.placeholder = tr('claimGuestCode');
    var confirm = el('button', tr('claimGuestConfirm'), claim);
    confirm.className = 'btn btn-primary btn-sm';
    send.addEventListener('click', function () {
      send.disabled = true;
      auth.call({ action: 'requestOrderClaim' }, true).then(function () { message.textContent = tr('claimGuestSent'); })
        .catch(function (error) { message.textContent = error.message; }).finally(function () { send.disabled = false; });
    });
    confirm.addEventListener('click', function () {
      confirm.disabled = true;
      auth.call({ action: 'confirmOrderClaim', code: code.value }, true).then(function () { message.textContent = tr('claimGuestDone'); document.dispatchEvent(new CustomEvent('hn:auth')); })
        .catch(function (error) { message.textContent = error.message; }).finally(function () { confirm.disabled = false; });
    });

    el('h2', tr('returnPortalTitle'), returns);
    el('p', tr('returnPortalHelp'), returns);
    orders.filter(function (order) { return order.status === 'paid'; }).forEach(function (order) {
      var card = el('div', '', returns);
      card.className = 'order-card';
      el('h3', order.order_number, card);
      var track = el('button', tr('trackOrder'), card);
      track.className = 'btn btn-secondary btn-sm';
      var status = el('p', '', card);
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
        }).catch(function (error) { status.textContent = error.message; }).finally(function () { track.disabled = false; });
      });
      if (order.shipping_status !== 'delivered') return;
      (order.order_items || []).forEach(function (item) {
        var form = el('form', '', card);
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
          if (file && file.size > 2 * 1024 * 1024) { message.textContent = tr('returnPhoto'); button.disabled = false; return; }
          var image = file ? new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result).split(',')[1]); }; reader.onerror = reject; reader.readAsDataURL(file); }) : Promise.resolve(null);
          image.then(function (base64) { return request('returns', { order_id: order.id, order_item_id: item.id, quantity: Number(qty.value), reason: reason.value, photo_base64: base64 }); }).then(function (data) {
            message.textContent = data.evidence_saved ? tr('returnSent') : tr('returnPhotoFailed'); load();
          }).catch(function (error) { message.textContent = error.message; button.disabled = false; });
        });
      });
    });
    requests.forEach(function (r) { el('p', tr('returnPortalTitle') + ' — ' + r.quantity + ' — ' + tr('returnStatus_' + r.status) + ' — ' + r.reason, returns); });
  }
  function load() {
    if (!auth.isAuthed()) { portal.hidden = true; return; }
    portal.hidden = false;
    Promise.all([auth.call({ action: 'orders' }, true), request('returns')]).then(function (data) { orders = data[0].orders || []; requests = data[1].requests || []; render(); })
      .catch(function (error) { message.textContent = error.message; });
  }
  document.addEventListener('hn:auth', load);
  document.addEventListener('langchange', render);
  auth.ready.then(load);
})();
