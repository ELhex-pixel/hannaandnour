(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_INLINE_STOCK = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var key = 'hn-admin-editor-stock-operation', idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  function validStock(value) { return Number.isInteger(value) && value >= 0 && value <= 1000000; }
  function validRequest(p) { return p && idPattern.test(p.operation_id) && idPattern.test(p.variant_id) && ['count','restock','remove'].indexOf(p.mode) >= 0 && validStock(p.quantity) && (p.mode === 'count' || p.quantity > 0) && validStock(p.expected_stock) && typeof p.reason === 'string' && p.reason.trim().length >= 3 && p.reason.length <= 300; }
  function controller(options) {
    var epoch = 0;
    var state = { visible: false, busy: false, loading: false, snapshot: null, target: '', label: '', product: '', mode: '', quantity: '', reason: '', pending: null, storageError: false, message: '' };
    function emit() { options.change(state); }
    function readPending() {
      try {
        var raw = options.storage.getItem(key), stored = raw ? JSON.parse(raw) : null;
        if (stored && (!validRequest(stored.payload) || typeof stored.label !== 'string' || typeof stored.product !== 'string')) throw new Error();
        state.pending = stored; state.storageError = false;
      } catch (error) { state.storageError = true; state.message = 'L’opération conservée ne peut pas être lue. Vérifiez le journal avant tout nouvel ajustement.'; }
    }
    function current(request, owner) { return request === epoch && owner && owner === options.token(); }
    function blockedElsewhere() {
      try { return !!options.session.getItem('hn-admin-stock-operation') || !!options.session.getItem('hn-admin-journal-reset'); }
      catch (error) { return true; }
    }
    function clearPending() {
      options.storage.removeItem(key); state.pending = null;
    }
    function resume() {
      if (!state.pending) return;
      var pending = state.pending;
      state.visible = true; state.target = pending.payload.variant_id; state.label = pending.label; state.product = pending.product;
      state.mode = pending.payload.mode; state.quantity = String(pending.payload.quantity); state.reason = pending.payload.reason;
      state.snapshot = null; state.message = 'Une opération reste à confirmer sur cette variante. Réessayez la même demande pour éviter un double mouvement.'; emit();
    }
    function load() {
      if (state.pending || state.busy || !state.target) return Promise.resolve();
      var request = ++epoch, owner = options.token(), target = state.target, product = state.product;
      state.loading = true; state.snapshot = null; emit();
      return options.call('stockLookup', { kind: 'qr', code: target }).then(function (data) {
        if (!current(request, owner)) return;
        var variant = data.variant;
        if (!variant || variant.id !== target || !variant.products || variant.products.id !== product || variant.products.catalog_deleted_at || !validStock(variant.stock)) throw new Error('Stock de cette variante indisponible ou non confirmé.');
        state.snapshot = variant;
        options.update(variant);
      }).catch(function (error) { if (current(request, owner)) state.message = error.message; })
        .finally(function () { if (current(request, owner)) { state.loading = false; emit(); } });
    }
    function open(id, product, label) {
      if (state.busy || state.loading) return Promise.resolve();
      readPending();
      if (state.pending) { resume(); return Promise.resolve(); }
      if (!idPattern.test(id) || !idPattern.test(product)) return Promise.resolve();
      state.visible = true; state.target = id; state.product = product; state.label = label; state.mode = ''; state.quantity = ''; state.reason = '';
      state.message = state.storageError ? state.message : 'Choisissez une opération, puis renseignez la quantité et le motif.';
      return load();
    }
    function preview() {
      if (!state.snapshot || state.quantity === '' || ['count','restock','remove'].indexOf(state.mode) < 0) return null;
      var quantity = Number(state.quantity);
      if (!validStock(quantity) || (state.mode !== 'count' && quantity === 0)) return null;
      var after = state.mode === 'count' ? quantity : state.mode === 'restock' ? state.snapshot.stock + quantity : state.snapshot.stock - quantity;
      return validStock(after) ? after : null;
    }
    function draft(values) {
      if (state.pending || state.busy || state.loading) return;
      ['mode','quantity','reason'].forEach(function (name) { if (values[name] !== undefined) state[name] = values[name]; }); emit();
    }
    function save() {
      if (state.busy || state.loading || state.storageError || !options.token()) return Promise.resolve();
      if (!state.pending) {
        readPending();
        if (state.storageError) { emit(); return Promise.resolve(); }
        if (state.pending) { resume(); return Promise.resolve(); }
      }
      if (blockedElsewhere()) { state.message = 'Confirmez d’abord l’opération en attente dans Stock détaillé.'; emit(); return Promise.resolve(); }
      if (!state.pending) {
        var after = preview(), reason = state.reason.trim();
        if (after === null || reason.length < 3 || reason.length > 300) { state.message = 'Choisissez l’opération, une quantité entière valide et un motif de 3 à 300 caractères.'; emit(); return Promise.resolve(); }
        if (!options.confirm(state.label + '\n\nDisponible : ' + state.snapshot.stock + ' → ' + after + '\n' + { count: 'Correction du nouveau disponible, hors unités réservées ou vendues.', restock: 'Arrivage : ajouter ' + state.quantity + ' unité(s).', remove: 'Retrait : retirer ' + state.quantity + ' unité(s).' }[state.mode] + '\nMotif : ' + reason)) return Promise.resolve();
        var payload;
        try {
          payload = { operation_id: options.uuid(), variant_id: state.target, mode: state.mode, quantity: Number(state.quantity), expected_stock: state.snapshot.stock, reason: reason };
          if (!validRequest(payload)) throw new Error();
          var pending = { payload: payload, product: state.product, label: state.label };
          options.storage.setItem(key, JSON.stringify(pending)); state.pending = pending;
        } catch (error) { state.message = 'Impossible de conserver l’identifiant de l’opération. Aucune demande envoyée.'; emit(); return Promise.resolve(); }
      }
      var pending = state.pending, request = ++epoch, owner = options.token();
      state.busy = true; state.message = 'Vérification et enregistrement en cours…'; emit();
      return options.call('adjustInventory', pending.payload).then(function (data) {
        if (!current(request, owner)) return;
        var result = data.result, payload = pending.payload;
        if (!result || result.operation_id !== payload.operation_id || !validStock(result.stock_before) || !validStock(result.stock_after) || result.stock_after !== (payload.mode === 'count' ? payload.quantity : payload.mode === 'restock' ? result.stock_before + payload.quantity : result.stock_before - payload.quantity) || (payload.mode === 'count' && result.stock_before !== payload.expected_stock)) throw new Error('Réponse incomplète : résultat non confirmé.');
        clearPending(); state.snapshot = null; state.mode = ''; state.quantity = ''; state.reason = '';
        state.message = (result.already ? 'Opération déjà enregistrée, sans double mouvement. ' : 'Stock modifié. ') + 'Disponible lors de l’opération : ' + result.stock_before + ' → ' + result.stock_after + '.';
      }).catch(function (error) {
        if (!current(request, owner)) return;
        if (['inventory_invalid','inventory_variant_missing','inventory_stock_changed','inventory_stock_bounds'].indexOf(error.code) >= 0) {
          try { clearPending(); } catch (storageError) { /* Keep the original operation when its removal is uncertain. */ }
        }
        state.message = error.message + (state.pending ? ' Utilisez « Réessayer la même opération ».' : ' Actualisez le disponible et confirmez un nouvel aperçu.');
      }).finally(function () {
        if (!current(request, owner)) return;
        state.busy = false; emit(); if (!state.pending) return load();
      });
    }
    function reset() { epoch++; state.visible = false; state.busy = false; state.loading = false; state.snapshot = null; state.target = ''; state.label = ''; state.product = ''; state.mode = ''; state.quantity = ''; state.reason = ''; state.message = ''; readPending(); emit(); }
    readPending();
    return { state: state, open: open, resume: resume, load: load, draft: draft, preview: preview, save: save, reset: reset, key: key };
  }
  function install(bridge) {
    var api = window.HN_ADMIN, home = document.getElementById('editorStockHome'), panel = document.getElementById('editorStockPanel');
    if (!home || !panel) return null;
    var el = function (id) { return document.getElementById(id); }, model, focusRevision = 0;
    function render(state) {
      panel.hidden = !state.visible;
      var pending = !!state.pending, locked = pending || state.busy || state.loading;
      el('editorStockTitle').textContent = state.label;
      el('editorStockCurrent').textContent = state.loading ? 'Lecture du disponible actuel…' : state.snapshot ? 'Disponible actuel : ' + state.snapshot.stock + ' unité(s)' : pending ? 'Disponible avant la demande : ' + state.pending.payload.expected_stock : 'Disponible à actualiser';
      [['editorStockMode','mode'],['editorStockQuantity','quantity'],['editorStockReason','reason']].forEach(function (pair) { el(pair[0]).value = state[pair[1]]; el(pair[0]).disabled = locked; });
      el('editorStockQuantity').min = state.mode === 'count' ? '0' : '1';
      el('editorStockQuantityLabel').textContent = state.mode === 'count' ? 'Nouveau stock disponible' : state.mode === 'restock' ? 'Unités à ajouter' : state.mode === 'remove' ? 'Unités à retirer' : 'Quantité';
      var after = model ? model.preview() : null;
      el('editorStockPreview').textContent = after === null ? '' : 'Disponible : ' + state.snapshot.stock + ' → ' + after + ' unité(s)';
      el('editorStockStatus').textContent = state.message;
      el('editorStockSave').textContent = pending ? 'Réessayer la même opération' : 'Confirmer la modification';
      el('editorStockSave').disabled = state.busy || state.loading || state.storageError || (!pending && (after === null || state.reason.trim().length < 3));
      el('editorStockRefresh').disabled = locked;
      el('editorStockClose').disabled = pending || state.busy;
      document.querySelectorAll('[data-editor-inventory]').forEach(function (button) { button.disabled = state.busy || state.loading; });
      bridge.lock(pending || state.busy || state.loading || (state.visible && !state.snapshot));
      if (state.visible) {
        var button = document.querySelector('[data-editor-inventory="' + state.target + '"]');
        var parent = button ? button.closest('.variant-row') : home;
        if (panel.parentElement !== parent) parent.appendChild(panel);
      }
    }
    function boundedCall(action, data) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(new Error('Le serveur ne répond pas. Résultat non confirmé.')); }, 20000);
        api.call(action, data).then(resolve, reject).finally(function () { clearTimeout(timer); });
      });
    }
    var storage = { getItem: function (name) { return window.localStorage.getItem(name); }, setItem: function (name, value) { window.localStorage.setItem(name, value); }, removeItem: function (name) { window.localStorage.removeItem(name); } };
    model = controller({ call: boundedCall, token: api.token, storage: storage, session: { getItem: function (name) { return window.sessionStorage.getItem(name); } }, uuid: function () { return window.crypto.randomUUID(); }, confirm: window.confirm.bind(window), update: bridge.update, change: render });
    el('editorStockMode').addEventListener('change', function () { model.draft({ mode: this.value }); });
    el('editorStockQuantity').addEventListener('input', function () { model.draft({ quantity: this.value }); });
    el('editorStockReason').addEventListener('input', function () { model.draft({ reason: this.value }); });
    el('editorStockSave').addEventListener('click', function () { model.save(); });
    el('editorStockRefresh').addEventListener('click', function () { model.load(); });
    el('editorStockClose').addEventListener('click', function () { var target = model.state.target; model.reset(); var button = document.querySelector('[data-editor-inventory="' + target + '"]'); if (button) button.focus(); });
    document.addEventListener('hn:product-editor', function () { focusRevision++; home.appendChild(panel); model.reset(); });
    document.addEventListener('hn:admin-logout', function () { focusRevision++; home.appendChild(panel); model.reset(); });
    return {
      open: function (id, product, label) { var revision = ++focusRevision, owner = api.token(); model.open(id, product, label).then(function () { if (revision === focusRevision && owner === api.token() && model.state.visible) { panel.scrollIntoView({ block: 'nearest' }); el('editorStockMode').focus(); } }); },
      beforeRender: function () { if (panel.parentElement !== home) home.appendChild(panel); },
      afterRender: function () { if (model.state.pending && !model.state.visible) model.resume(); else render(model.state); },
      blocked: function () { return model.state.busy || model.state.loading || !!model.state.pending || (model.state.visible && !model.state.snapshot); }
    };
  }
  return { controller: controller, install: install, key: key };
});
