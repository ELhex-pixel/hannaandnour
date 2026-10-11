(function () {
  'use strict';
  var HN = window.HN;
  if (!HN) return;
  var dialog, form, title, price, status, variantField, colorField, sizeField, variantSelect, colorSelect, sizeSelect, confirmButton, closeButton, refreshButton, syncStatus;
  var product = null, currency = null, origin = null, busy = false, revision = 0;
  var syncing = false, syncFailed = false, syncTimer = null;
  function tr(key, values) { return HN.tr(key, values); }
  function variants(p) { return Array.isArray(p.variants) && p.variants.length ? p.variants : Array.isArray(p.product_variants) ? p.product_variants : []; }
  function valid(v) { return v && typeof v.id === 'string' && v.id && typeof v.color === 'string' && typeof v.size === 'string' && v.active === true && Number.isInteger(v.stock) && v.stock > 0 && v.stock <= 1000000; }
  function values(list) { return Array.isArray(list) ? list.filter(function (value, index) { return typeof value === 'string' && value && list.indexOf(value) === index; }) : []; }
  function unavailable(v) { return v && v.active === true && v.stock === 0 ? tr('stockOut') : tr('quickAddOptionUnavailable'); }
  function color(value) { return window.HN_COLORS ? window.HN_COLORS.label(value, HN.lang()) : value; }
  function size(value) { return window.HN_SIZES.canonical(value) === 'Taille unique' ? tr('sizeOne') : value || tr('sizeUnspecified'); }
  function label(v) { return [color(v.color || ''), size(v.size)].filter(Boolean).join(' / '); }
  function toast(message, type) { if (window.hnToast) window.hnToast(tr('cartAdd'), message, type || 'error'); }
  function create(tag, parent, text) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function field(id) {
    var wrap = create('div', form); wrap.className = 'quick-add-field';
    var heading = create('label', wrap); heading.setAttribute('for', id);
    var select = create('select', wrap); select.id = id;
    select.addEventListener('change', function () { update(); });
    return { wrap: wrap, heading: heading, select: select };
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = create('dialog', document.body); dialog.className = 'quick-add-dialog'; dialog.setAttribute('aria-labelledby', 'quickAddTitle');
    title = create('h2', dialog); title.id = 'quickAddTitle';
    price = create('p', dialog); price.className = 'quick-add-price';
    form = create('form', dialog);
    variantField = field('quickAddVariant'); colorField = field('quickAddColor'); sizeField = field('quickAddSize');
    variantSelect = variantField.select; colorSelect = colorField.select; sizeSelect = sizeField.select;
    status = create('p', form); status.id = 'quickAddStatus'; status.setAttribute('role', 'status');
    syncStatus = create('p', form); syncStatus.id = 'quickAddSyncStatus'; syncStatus.className = 'quick-add-sync-status'; syncStatus.setAttribute('role', 'status');
    var actions = create('div', form); actions.className = 'quick-add-actions';
    confirmButton = create('button', actions); confirmButton.type = 'submit'; confirmButton.id = 'quickAddConfirm'; confirmButton.className = 'btn btn-primary';
    closeButton = create('button', actions); closeButton.type = 'button'; closeButton.className = 'btn btn-outline';
    refreshButton = create('button', actions); refreshButton.id = 'quickAddRefresh'; refreshButton.type = 'button'; refreshButton.className = 'btn btn-outline';
    refreshButton.addEventListener('click', refresh);
    closeButton.addEventListener('click', close);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('close', function () { if (product && !dialog.open) close(); });
    form.addEventListener('submit', function (event) { event.preventDefault(); confirm(); });
  }
  function fill(select, list, preserve, text) {
    select.textContent = '';
    var placeholder = create('option', select, tr('quickAddChoose')); placeholder.value = '';
    list.forEach(function (item) { var option = create('option', select, text(item)); option.value = typeof item === 'string' ? item : item.id; if (typeof item !== 'string') option.disabled = !valid(item); });
    select.value = preserve != null ? preserve : (list.length === 1 ? (typeof list[0] === 'string' ? list[0] : list[0].id) : '');
  }
  function choice() {
    if (!product) return null;
    var rows = variants(product);
    if (rows.length) {
      var selected = rows.filter(function (v) { return v.id === variantSelect.value; })[0];
      return valid(selected) ? { color: selected.color || '', size: selected.size || '', variantId: selected.id, stock: selected.stock, qty: 1 } : null;
    }
    var colors = values(product.colors), sizes = values(product.sizes);
    if ((colors.length && colors.indexOf(colorSelect.value) < 0) || (sizes.length && sizes.indexOf(sizeSelect.value) < 0)) return null;
    return { color: colors.length ? colorSelect.value : '', size: sizes.length ? sizeSelect.value : '', variantId: null, stock: null, qty: 1 };
  }
  function quantity(p, option) {
    function norm(value) { return String(value || '').trim().toLowerCase(); }
    return HN.cart.list().filter(function (item) { return item.slug === p.slug && norm(item.color) === norm(option.color) && norm(item.size) === norm(option.size); }).reduce(function (sum, item) { return sum + item.qty; }, 0);
  }
  function lock() {
    if (origin) origin.disabled = busy;
    if (!form) return;
    [variantSelect, colorSelect, sizeSelect].forEach(function (select) { select.disabled = busy; });
    confirmButton.disabled = busy || syncing || syncFailed || !choice();
    confirmButton.textContent = tr(busy ? 'processing' : 'quickAddConfirm');
    refreshButton.disabled = busy || syncing;
  }
  function update(message) {
    if (!product || !status) return;
    var selected = choice(), rows = variants(product);
    status.textContent = message || (selected ? selected.stock === null ? '' : tr('quickAddStock', { n: selected.stock }) : rows.length && !rows.some(valid) ? rows.every(function (v) { return v.active === true && v.stock === 0; }) ? tr('stockOut') : tr('quickAddUnavailable') : tr('quickAddChoose'));
    lock();
  }
  function render(preserve, message) {
    title.textContent = HN.productName(product);
    price.textContent = currency.symbol + (product.price_cents / 100).toFixed(2);
    variantField.heading.textContent = tr('quickAddVariantLabel'); colorField.heading.textContent = tr('colorLabel'); sizeField.heading.textContent = tr('sizeLabel');
    closeButton.textContent = tr('quickAddClose');
    refreshButton.textContent = tr('quickAddRefresh');
    var rows = variants(product), colors = values(product.colors), sizes = values(product.sizes);
    variantField.wrap.hidden = !rows.length; colorField.wrap.hidden = !!rows.length || !colors.length; sizeField.wrap.hidden = !!rows.length || !sizes.length;
    fill(variantSelect, rows.filter(function (v) { return v.active === true; }), preserve && preserve.variantId, function (v) { return label(v) + ' — ' + (valid(v) ? tr('quickAddStock', { n: v.stock }) : unavailable(v)); });
    fill(colorSelect, colors, preserve && preserve.color, color); fill(sizeSelect, sizes, preserve && preserve.size, size);
    update(message);
  }
  function close() {
    revision++; busy = false; syncing = false; syncFailed = false;
    stopSync();
    if (dialog && dialog.open) dialog.close();
    if (origin) { origin.disabled = false; if (document.contains(origin)) origin.focus(); }
    product = null; currency = null; origin = null;
  }
  function stopSync() { if (syncTimer !== null) clearTimeout(syncTimer); syncTimer = null; }
  function scheduleSync() {
    stopSync();
    if (product && dialog && dialog.open && !document.hidden) syncTimer = setTimeout(function () { syncTimer = null; return refresh(); }, 15000);
  }
  function selection() { return { variantId: variantSelect.value, color: colorSelect.value, size: sizeSelect.value }; }
  function fingerprint(p) {
    return JSON.stringify({ id: p.id, name: HN.productName(p), colors: values(p.colors), sizes: values(p.sizes), variants: variants(p).map(function (v) { return [v.id, v.color, v.size, v.stock, v.active]; }) });
  }
  function sameSelection(before, after) { return (before.variantId || '') === (after.variantId || '') && before.color === after.color && before.size === after.size; }
  function refresh() {
    if (busy || syncing || !product || !dialog || !dialog.open || document.hidden) { scheduleSync(); return Promise.resolve(); }
    stopSync();
    var old = product, oldCurrency = currency, selected = selection(), request = ++revision;
    syncing = true; syncStatus.textContent = tr('quickAddSyncing'); lock();
    return read(old.slug).then(function (fresh) {
      if (request !== revision || !dialog.open) return;
      // Capture the current selection again: the customer may change it while
      // the background read is running. Never pick a different option for them.
      selected = selection();
      var previous = variants(old).filter(function (v) { return v.id === selected.variantId; })[0];
      var expected = previous ? { variantId: previous.id, color: previous.color, size: previous.size } : selected;
      var changed = fingerprint(old) !== fingerprint(fresh.product);
      var priceChanged = old.price_cents !== fresh.product.price_cents || oldCurrency.code !== fresh.currency.code || oldCurrency.symbol !== fresh.currency.symbol;
      product = fresh.product; currency = fresh.currency; syncFailed = false;
      if (changed || priceChanged) {
        render(selected);
        var current = choice();
        if ((selected.variantId || selected.color || selected.size) && (!current || !sameSelection(expected, current))) update(tr('quickAddOptionsChanged'));
        else if (priceChanged) update(tr('quickAddPriceChanged'));
        syncStatus.textContent = tr('quickAddUpdated');
      } else { update(); syncStatus.textContent = tr('quickAddSynced'); }
    }).catch(function () {
      if (request !== revision || !dialog.open) return;
      syncFailed = true; syncStatus.textContent = tr('quickAddSyncFailed'); update(tr('quickAddUnavailable'));
    }).finally(function () { if (request === revision) { syncing = false; lock(); scheduleSync(); } });
  }
  function read(slug) {
    return Promise.all([HN.requireConfig(true), HN.fetchProducts({ slug: slug, limit: 1 })]).then(function (results) {
      var p = results[1].filter(function (item) { return item.slug === slug && item.active === true && item.catalog_deleted_at == null; })[0];
      if (!p || !Number.isSafeInteger(p.price_cents) || p.price_cents < 1) throw new Error(tr('quickAddUnavailable'));
      if ((p.variants != null && !Array.isArray(p.variants)) || (p.product_variants != null && !Array.isArray(p.product_variants)) || variants(p).some(function (v) { return !v || typeof v !== 'object'; })) throw new Error(tr('quickAddUnavailable'));
      return { product: p, currency: results[0].currency };
    });
  }
  function addSelected(p, selected) {
    var before = quantity(p, selected), cap = Math.min(10, selected.stock === null ? 10 : selected.stock);
    if (before >= cap) { toast(tr('quickAddLimit')); return false; }
    HN.cart.add(p, selected);
    if (quantity(p, selected) <= before) { toast(tr('quickAddUnavailable')); return false; }
    toast(HN.productName(p) + (selected.color || selected.size ? ' — ' + label(selected) : '') + ' ' + tr('cartAddMsg'), 'success');
    return true;
  }
  function add(button, slug) {
    if (busy || !slug) return Promise.resolve();
    close(); origin = button; var request = ++revision; busy = true; lock();
    return read(slug).then(function (fresh) {
      if (request !== revision) return;
      product = fresh.product; currency = fresh.currency;
      var rows = variants(product), colors = values(product.colors), sizes = values(product.sizes);
      if (rows.length === 1 && valid(rows[0])) {
        var v = rows[0]; addSelected(product, { color: v.color || '', size: v.size || '', variantId: v.id, stock: v.stock, qty: 1 }); close();
      } else if (!rows.length && colors.length <= 1 && sizes.length <= 1) {
        addSelected(product, { color: colors[0] || '', size: sizes[0] || '', variantId: null, stock: null, qty: 1 }); close();
      } else {
        ensureDialog(); busy = false; syncFailed = false; render(); syncStatus.textContent = tr('quickAddSynced');
        if (typeof dialog.showModal === 'function') { dialog.showModal(); scheduleSync(); } else { window.location.href = HN.productUrl(product.slug); close(); }
      }
    }).catch(function () { if (request === revision) { toast(tr('quickAddUnavailable')); close(); } })
      .finally(function () { if (request === revision) { busy = false; lock(); } });
  }
  function confirm() {
    if (busy || syncing || syncFailed || !product) return;
    var selected = choice(); if (!selected) { update(tr('quickAddChoose')); return; }
    var old = product, oldCurrency = currency, request = ++revision;
    stopSync(); busy = true; update(tr('processing'));
    return read(old.slug).then(function (fresh) {
      if (request !== revision) return;
      product = fresh.product; currency = fresh.currency;
      render(selected);
      if (product.price_cents !== old.price_cents || currency.code !== oldCurrency.code || currency.symbol !== oldCurrency.symbol) { update(tr('quickAddPriceChanged')); return; }
      var current = choice();
      if (!current || current.variantId !== selected.variantId || current.color !== selected.color || current.size !== selected.size) { update(tr('quickAddOptionsChanged')); return; }
      if (addSelected(product, current)) close();
    }).catch(function () { if (request === revision) { syncFailed = true; syncStatus.textContent = tr('quickAddSyncFailed'); update(tr('quickAddUnavailable')); } })
      .finally(function () { if (request === revision) { busy = false; lock(); scheduleSync(); } });
  }
  document.addEventListener('langchange', function () { if (product && dialog && dialog.open) { render(selection()); syncStatus.textContent = tr(syncing ? 'quickAddSyncing' : syncFailed ? 'quickAddSyncFailed' : 'quickAddSynced'); } });
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopSync(); else refresh(); });
  document.addEventListener('hn:cart', function () { if (product && dialog && dialog.open && !busy && !syncing) update(); });
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', function (event) { if (event.persisted) refresh(); });
  }
  window.HN_QUICK_ADD = { add: add, close: close };
})();
