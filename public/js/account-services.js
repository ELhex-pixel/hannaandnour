(function () {
  'use strict';
  var HN = window.HN;
  var auth = window.HN_AUTH;
  var orders = [];
  var requests = [];
  var listState = { query: '', scope: 'all', page: 1, limit: 5, total: 0 };
  var renderVersion = 0, authVersion = 0, serviceBusy = false, drafts = {}, pending = {};
  function tr(key, values) { return HN.tr(key, values); }
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

  function current(epoch, userId) { var user = auth.currentUser(); return epoch === authVersion && user && user.id === userId && auth.isAuthed(); }
  function pendingKey() { return 'hn-customer-return-pending-' + owner; }
  function savePending() { try { window.sessionStorage.setItem(pendingKey(), JSON.stringify(pending)); return true; } catch (error) { return false; } }
  function renderClaim() {
    var epoch = authVersion, userId = owner;
    claim.textContent = '';
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
      if (!current(epoch, userId)) return;
      send.disabled = true;
      auth.call({ action: 'requestOrderClaim' }, true).then(function () { if (current(epoch, userId)) { notify(claimMessage, 'claimGuestSent'); code.focus(); } })
        .catch(function () { if (current(epoch, userId)) notify(claimMessage, 'accountServiceError', true); }).finally(function () { send.disabled = false; });
    });
    claimForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!current(epoch, userId)) return;
      if (!/^[0-9]{6}$/.test(code.value)) { notify(claimMessage, 'accountCodeInvalid', true); return; }
      confirm.disabled = true;
      auth.call({ action: 'confirmOrderClaim', code: code.value }, true).then(function () { if (current(epoch, userId)) { notify(message, 'claimGuestDone'); document.dispatchEvent(new CustomEvent('hn:auth')); } })
        .catch(function () { if (current(epoch, userId)) notify(claimMessage, 'accountCodeError', true); }).finally(function () { confirm.disabled = false; });
    });
  }
  function renderReturns() {
    var epoch = authVersion, userId = owner, rendered = ++renderVersion;
    returns.textContent = '';
    el('p', tr('returnPortalHelp'), returns).className = 'account-service-description';
    var controls = el('div', '', returns); controls.className = 'account-return-controls';
    var search = el('input', '', controls); search.type = 'search'; search.className = 'form-input'; search.value = listState.query; search.maxLength = 100; search.placeholder = tr('returnSearch'); search.setAttribute('aria-label', tr('returnSearch'));
    var scope = el('select', '', controls); scope.className = 'form-input'; scope.setAttribute('aria-label', tr('returnFilter'));
    [['all','returnAllOrders'],['available','returnAvailableOrders'],['open','returnOpenOrders'],['closed','returnClosedOrders']].forEach(function (entry) { var option = el('option', tr(entry[1]), scope); option.value = entry[0]; }); scope.value = listState.scope;
    var apply = el('button', tr('searchButton'), controls); apply.type = 'button'; apply.className = 'btn btn-secondary btn-sm';
    function filter() { if (serviceBusy) return; listState.query = search.value.trim(); listState.scope = scope.value; listState.page = 1; load(); }
    apply.addEventListener('click', filter); scope.addEventListener('change', filter);
    search.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); filter(); } });
    var returnMessage = el('p', '', returns);
    returnMessage.className = 'account-feedback account-service-message';
    returnMessage.setAttribute('role', 'status');
    var pager = el('div', '', returns); pager.className = 'account-return-controls';
    var previous = el('button', tr('listPrevious'), pager); previous.type = 'button'; previous.className = 'btn btn-secondary btn-sm'; previous.disabled = listState.page <= 1;
    var pages = Math.max(1, Math.ceil(listState.total / listState.limit));
    el('span', tr('returnListCount', { first: listState.total ? (listState.page-1)*listState.limit+1 : 0, last: Math.min(listState.page*listState.limit,listState.total), total: listState.total, page: listState.page, pages: pages }), pager).setAttribute('role','status');
    var next = el('button', tr('listNext'), pager); next.type = 'button'; next.className = 'btn btn-secondary btn-sm'; next.disabled = listState.page >= pages;
    previous.addEventListener('click', function () { if (!serviceBusy && listState.page > 1) { listState.page--; load(); } });
    next.addEventListener('click', function () { if (!serviceBusy && listState.page < pages) { listState.page++; load(); } });
    function navigation(on) { search.disabled = scope.disabled = apply.disabled = on; previous.disabled = on || listState.page <= 1; next.disabled = on || listState.page >= pages; }
    if (!orders.length) el('p', tr('accountReturnsEmpty'), returns).className = 'account-empty';
    orders.forEach(function (order) {
      var card = el('details', '', returns);
      card.className = 'account-return-order';
      var summary = el('summary', '', card);
      el('strong', order.order_number, summary);
      var related = Array.isArray(order.return_requests) ? order.return_requests : requests.filter(function (r) { return r.order_id === order.id; });
      el('span', [order.created_at ? new Date(order.created_at).toLocaleDateString() : '', tr(order.shipping_status === 'delivered' ? 'shipDelivered' : order.shipping_status === 'shipped' ? 'shipShipped' : 'shipPending'), tr('returnRequestCount', { n: related.length })].filter(Boolean).join(' · '), summary);
      var body = el('div', '', card); body.className = 'account-return-body';
      if (order.return_policy) el('p', tr('returnPolicyWindow').replace('{days}', order.return_policy.days) + ' ' + tr(order.return_policy.withdrawal_payer === 'store' ? 'returnPolicyStore' : 'returnPolicyCustomer') + ' ' + tr('returnPolicyFault'), body);
      related.forEach(function (r) { el('p', tr('returnStatus_' + r.status) + ' · ' + r.quantity + ' · ' + r.reason, body).className = 'account-return-request'; });
      var track = el('button', tr('trackOrder'), body); track.type = 'button';
      track.className = 'btn btn-secondary btn-sm';
      var status = el('p', '', body);
      status.className = 'account-tracking-status';
      status.setAttribute('role', 'status');
      track.addEventListener('click', function () {
        if (!current(epoch,userId) || rendered !== renderVersion) return;
        track.disabled = true;
        request('tracking?order_id=' + encodeURIComponent(order.id)).then(function (data) {
          if (!current(epoch,userId) || rendered !== renderVersion) return;
          var o = data.order;
          status.textContent = [tr(o.shipping_status === 'delivered' ? 'shipDelivered' : o.shipping_status === 'shipped' ? 'shipShipped' : 'shipPending'), o.shipped_at ? new Date(o.shipped_at).toLocaleDateString() : '', o.tracking_number || ''].filter(Boolean).join(' — ');
          if (data.tracking_url) {
            var link = el('a', tr('trackCarrier'), status);
            link.href = data.tracking_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
        }).catch(function () { if (current(epoch,userId) && rendered === renderVersion) notify(status, 'accountServiceError', true); }).finally(function () { track.disabled = false; });
      });
      if (order.shipping_status !== 'delivered') return;
      (order.order_items || []).forEach(function (item) {
        var frozen = pending[item.id];
        var used = related.filter(function (r) { return r.order_item_id === item.id && r.status !== 'rejected'; }).reduce(function (n,r) { return n+r.quantity; },0);
        var available = Number.isInteger(item.return_available_quantity) ? item.return_available_quantity : Math.max(0,item.quantity-used);
        if (!frozen && (item.stock_debited === false || available <= 0)) return;
        var draft = drafts[item.id] || (drafts[item.id] = {});
        var days = order.return_policy && order.return_policy.days || 14;
        var expired = order.delivered_at && Date.now()-new Date(order.delivered_at).getTime() > days*86400000;
        var form = el('form', '', body);
        form.className = 'account-return-form';
        var label = el('p', item.product_name, form);
        label.className = 'order-item-name';
        var category = el('select', '', form); category.className = 'form-input'; category.setAttribute('aria-label', tr('returnCategory'));
        if (expired && !frozen) { var placeholder = el('option', tr('returnChooseCategory'), category); placeholder.value = ''; }
        [['withdrawal','returnWithdrawal'],['seller_error','returnSellerError'],['nonconforming','returnNonconforming']].forEach(function (entry) { var option = el('option', tr(entry[1]), category); option.value = entry[0]; option.disabled = expired && !frozen && entry[0] === 'withdrawal'; });
        category.value = frozen ? frozen.category : draft.category || (expired ? '' : 'withdrawal'); category.required = true;
        var qty = el('input', '', form);
        qty.type = 'number'; qty.min = 1; qty.max = frozen ? frozen.quantity : available; qty.value = frozen ? frozen.quantity : draft.quantity || 1;
        qty.className = 'form-input'; qty.setAttribute('aria-label', tr('a11yQty'));
        var reason = el('textarea', '', form);
        reason.className = 'form-input'; reason.required = true; reason.minLength = 3; reason.maxLength = 1000;
        reason.placeholder = tr('returnReason'); reason.setAttribute('aria-label', tr('returnReason'));
        reason.value = frozen ? frozen.reason : draft.reason || '';
        var photo = el('input', '', form);
        photo.type = 'file'; photo.accept = 'image/jpeg,image/png,image/webp'; photo.setAttribute('aria-label', tr('returnPhoto'));
        el('p', tr('returnPhoto'), form);
        var photoNotice = el('p', frozen && frozen.had_photo && !draft.file ? tr('returnPhotoAgain') : draft.file ? tr('returnPhotoSelected', { name: draft.file.name }) : '', form);
        function keep() { draft.category = category.value; draft.quantity = qty.value; draft.reason = reason.value; var file = photo.files && photo.files[0]; if (file) { draft.file = file; photoNotice.textContent = tr('returnPhotoSelected', { name: file.name }); } }
        form.addEventListener('input', keep); form.addEventListener('change', keep);
        var button = el('button', tr(frozen ? 'returnRetry' : 'returnSubmit'), form);
        button.type = 'submit'; button.className = 'btn btn-secondary btn-sm';
        form.addEventListener('submit', function (event) {
          event.preventDefault(); if (serviceBusy || !current(epoch,userId)) return;
          keep(); var file = draft.file;
          if (file && (file.size > 2*1024*1024 || !/^image\/(jpeg|png|webp)$/.test(file.type))) { notify(returnMessage,'returnPhoto',true); return; }
          if (!frozen && (!Number.isInteger(Number(qty.value)) || Number(qty.value)<1 || Number(qty.value)>available || reason.value.trim().length<3 || !['withdrawal','seller_error','nonconforming'].includes(category.value) || (expired && category.value === 'withdrawal'))) { notify(returnMessage,'accountServiceError',true); return; }
          if (!frozen) {
            if (!window.crypto || !window.crypto.randomUUID) { notify(returnMessage,'accountServiceError',true); return; }
            frozen = { operation_id: window.crypto.randomUUID(), order_id: order.id, order_item_id: item.id, quantity: Number(qty.value), category: category.value, reason: reason.value.trim(), had_photo: !!file };
            pending[item.id] = frozen;
            if (!savePending()) { delete pending[item.id]; frozen = null; notify(returnMessage,'accountServiceError',true); return; }
          }
          if (frozen.had_photo && !file) { notify(returnMessage,'returnPhotoAgain',true); return; }
          serviceBusy = true; navigation(true); button.disabled = true;
          [category,qty,reason,photo].forEach(function (control) { control.disabled = true; });
          var image = file ? new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onload = function () { resolve(String(reader.result).split(',')[1]); }; reader.onerror = reject; reader.readAsDataURL(file); }) : Promise.resolve(null);
          image.then(function (base64) { if (!current(epoch,userId)) throw new Error('Session changed'); return request('returns', Object.assign({},frozen,{ photo_base64: base64 })); }).then(function (data) {
            if (!current(epoch,userId)) return;
            if (!data || data.id !== frozen.operation_id) throw new Error('Unconfirmed return');
            notify(message, data.evidence_saved ? 'returnSent' : 'returnPhotoFailed');
            if (data.evidence_saved) { delete pending[item.id]; delete drafts[item.id]; savePending(); }
            serviceBusy = false; load();
          }).catch(function () {
            if (!current(epoch,userId)) return;
            serviceBusy = false; navigation(false); button.disabled = false; button.textContent = tr('returnRetry'); photo.disabled = false;
            notify(returnMessage,'returnUnconfirmed',true);
          });
        });
        if (frozen) [category,qty,reason].forEach(function (control) { control.disabled = true; });
      });
    });
  }
  function load() {
    var current = ++version;
    var user = auth.currentUser();
    if (!user || user.id !== owner) {
      owner = user ? user.id : null;
      orders = []; requests = []; drafts = {}; pending = {}; serviceBusy = false; listState.page = 1;
      if (owner) {
        try {
          var saved = JSON.parse(window.sessionStorage.getItem(pendingKey()) || '{}');
          if (saved && typeof saved==='object' && !Array.isArray(saved)) {
            Object.keys(saved).forEach(function (id) { var p=saved[id]; if (p&&typeof p==='object'&&typeof p.operation_id==='string'&&p.order_item_id===id&&Number.isInteger(p.quantity)&&p.quantity>0&&typeof p.reason==='string'&&['withdrawal','seller_error','nonconforming'].includes(p.category)) pending[id]=p; });
          }
        } catch (error) { pending = {}; }
      }
      claim.textContent = ''; returns.textContent = ''; message.textContent = ''; message.hidden = true;
    }
    if (!user || !auth.isAuthed()) { portal.hidden = true; return; }
    var epoch = authVersion, userId = owner;
    portal.hidden = false;
    portal.setAttribute('aria-busy', 'true');
    if (!claim.children.length) renderClaim();
    returns.textContent = tr('ordersLoading');
    auth.call({ action:'orders',return_portal:true,query:listState.query,scope:listState.scope,page:listState.page,limit:listState.limit },true).then(function (data) {
      if (current !== version || !auth.currentUser() || auth.currentUser().id !== userId || epoch !== authVersion) return;
      if (!Array.isArray(data.orders) || !Number.isSafeInteger(data.total) || data.total < data.orders.length) throw new Error('Unconfirmed list');
      orders = data.orders; listState.total = data.total; requests = [].concat.apply([],orders.map(function (order) { return order.return_requests || []; }));
      Object.keys(pending).forEach(function (itemId) {
        var p = pending[itemId];
        if (requests.some(function (r) { return r.id === p.operation_id && r.order_item_id === itemId && r.quantity === p.quantity && r.reason === p.reason && r.category === p.category && (!p.had_photo || r.evidence_saved); })) { delete pending[itemId]; delete drafts[itemId]; }
      }); savePending();
      var last = Math.max(1,Math.ceil(data.total/listState.limit));
      if (listState.page > last) { listState.page = last; load(); return; }
      renderReturns();
    }).catch(function () { if (current === version && epoch === authVersion) { returns.textContent = ''; notify(message,'accountServiceError',true); var retry=el('button',tr('liveRetry'),returns); retry.type='button'; retry.className='btn btn-secondary btn-sm'; retry.addEventListener('click',load); } })
      .finally(function () { if (current === version) portal.setAttribute('aria-busy', 'false'); });
  }
  document.addEventListener('hn:auth', function () { authVersion++; serviceBusy = false; claim.textContent = ''; load(); });
  document.addEventListener('langchange', function () { if (auth.currentUser() && !serviceBusy) { renderClaim(); renderReturns(); } });
  auth.ready.then(load);
})();
