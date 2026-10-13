(function () {
  'use strict';
  var API = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';
  var KEY = 'hn-stock-pending', mode = 'sale', variant = null, cart = [], quote = null, pending = null;
  var revision = 0, busy = false, page = 1, total = 0, lookupRevision = 0;
  var labelsPage = 1, labelsTotal = 0;
  var ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  function el(id) { return document.getElementById(id); }
  function token() { try { return sessionStorage.getItem('hn-admin-token') || ''; } catch (error) { return ''; } }
  function say(text) { el('status').textContent = text || ''; }
  function money(cents, currency) { return (cents / 100).toFixed(2) + ' ' + String(currency).toUpperCase(); }
  function stopCamera() { if (window.HN_STOCK_CODES) window.HN_STOCK_CODES.stop(); el('cameraPanel').hidden = true; el('camera').srcObject = null; }
  function savePending(value) {
    if (value) localStorage.setItem(KEY, JSON.stringify(value)); else localStorage.removeItem(KEY);
    pending = value;
  }
  function readPending() {
    try { var value = JSON.parse(localStorage.getItem(KEY) || 'null'); return value && ['recordPhysicalSale','adjustInventory'].indexOf(value.action) >= 0 && value.body && ID.test(value.body.operation_id) ? value : null; } catch (error) { return null; }
  }
  function logout(message) {
    revision++; lookupRevision++; busy = false; stopCamera();
    try { sessionStorage.removeItem('hn-admin-token'); } catch (error) {}
    variant = null; cart = []; quote = null; pending = null;
    el('password').value = ''; el('app').hidden = true; el('logout').hidden = true; el('loginPanel').hidden = false;
    el('variantPanel').hidden = true; el('history').textContent = ''; el('saleItems').textContent = ''; el('saleSummary').textContent = '';
    ['code','quantity','reason','saleNote'].forEach(function (id) { el(id).value = ''; });
    ['variantName','variantOptions','variantDetails','variantStock','pendingText','variantsList','labelName','labelVariant','labelCode','saleCount'].forEach(function (id) { el(id).textContent = ''; });
    el('saleTotal').textContent = 'À calculer'; el('paymentStep').hidden = true;
    el('labelQr').removeAttribute('src'); el('labelBarcode').textContent = '';
    if (el('labelDialog').open) el('labelDialog').close();
    say(message || 'Déconnecté. Une tentative non confirmée sera retrouvée à la prochaine connexion.');
  }
  async function call(action, body) {
    var current = revision, auth = token(), controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await fetch(API + '/admin', { method:'POST',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer ' + auth},body:JSON.stringify(Object.assign({},body || {},{action:action})) });
      var data = await response.json();
      if (current !== revision || (action !== 'login' && token() !== auth)) throw Object.assign(new Error('Réponse d’une ancienne session ignorée.'),{stale:true});
      if (response.status === 401 && action !== 'login') { logout('Session expirée. Reconnecte-toi pour reprendre la même opération.'); throw Object.assign(new Error('Session expirée.'),{stale:true}); }
      if (!response.ok || data.error) throw Object.assign(new Error(data.error || 'Service indisponible.'),{code:data.code,status:response.status});
      return data;
    } finally { clearTimeout(timer); }
  }
  function controls() {
    var blocked = busy || !!pending;
    el('app').querySelectorAll('button,input,select').forEach(function (node) { node.disabled = blocked; });
    el('pendingPanel').hidden = !pending;
    el('retry').disabled = busy;
    el('pendingText').textContent = pending ? pending.summary : '';
    el('confirmSale').disabled = blocked || !quote || !el('collected').checked || !el('payment').value;
    el('previous').disabled = blocked || page <= 1;
    el('next').disabled = blocked || page * 20 >= total;
    el('labelsPrevious').disabled = blocked || labelsPage <= 1;
    el('labelsNext').disabled = blocked || labelsPage * 20 >= labelsTotal;
    el('addSale').disabled = blocked || !variant || !variant.active || !variant.products || !variant.products.active || !!variant.products.catalog_deleted_at || !Number.isInteger(variant.stock) || variant.stock < 1;
    el('barcodeLabel').disabled = blocked || !variant || !variant.barcode;
  }
  async function run(task) {
    if (busy) return;
    var current = revision; busy = true; controls();
    try { await task(); } catch (error) { if (!error.stale && current === revision) say(error.message || 'Impossible de terminer.'); }
    finally { if (current === revision) { busy = false; controls(); } }
  }
  function invalidateQuote() { quote = null; el('collected').checked = false; el('saleSummary').textContent = 'Vérifie les prix et le total avant de confirmer.'; el('saleTotal').textContent = 'À calculer'; el('paymentStep').hidden = true; var count = cart.reduce(function (sum, line) { return sum + line.quantity; }, 0); el('saleCount').textContent = count ? count + ' article' + (count > 1 ? 's' : '') : ''; controls(); }
  function drawCart() {
    el('saleItems').textContent = '';
    cart.forEach(function (line) {
      var box = document.createElement('div'); box.className = 'sale-line';
      var title = document.createElement('strong'); title.textContent = line.name;
      var details = document.createElement('p'); details.textContent = [line.color,line.size].filter(Boolean).join(' · ');
      var row = document.createElement('div'); row.className = 'input-row';
      var input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '100'; input.step = '1'; input.value = line.quantity; input.setAttribute('aria-label','Quantité de ' + line.name);
      input.addEventListener('change',function () { var quantity = Number(input.value); if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) { input.value = line.quantity; return; } line.quantity = quantity; invalidateQuote(); });
      var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Retirer';
      remove.addEventListener('click',function () { cart = cart.filter(function (item) { return item !== line; }); invalidateQuote(); drawCart(); });
      row.append(input,remove); box.append(title,details,row); el('saleItems').appendChild(box);
    });
    if (!cart.length) el('saleItems').textContent = 'Scanne un code-barres, puis ajoute l’article au panier.';
    var count = cart.reduce(function (sum, line) { return sum + line.quantity; }, 0);
    el('saleCount').textContent = count ? count + ' article' + (count > 1 ? 's' : '') : '';
    controls();
  }
  function setMode(next, keepLocation) {
    stopCamera(); lookupRevision++; mode = next; variant = null; el('variantPanel').hidden = true;
    el('app').setAttribute('data-view', mode);
    (mode === 'labels' ? el('labelSelection') : el('scanPanel')).appendChild(el('variantPanel'));
    el('variantExtra').open = mode === 'labels';
    if (!keepLocation) { try { historyReplace(mode); } catch (error) {} }
    document.querySelectorAll('[data-mode]').forEach(function (button) { button.setAttribute('aria-pressed',String(button.getAttribute('data-mode') === mode)); });
    el('scanPanel').hidden = mode === 'history' || mode === 'labels'; el('salePanel').hidden = mode !== 'sale'; el('historyPanel').hidden = mode !== 'history'; el('labelsPanel').hidden = mode !== 'labels';
    el('scanTitle').textContent = mode === 'stock' ? 'Identifier la variante' : 'Choisir les articles';
    el('codeLabel').textContent = mode === 'stock' ? 'QR code ou identifiant de variante' : 'Code-barres de vente';
    el('scanHelp').textContent = mode === 'stock' ? 'Scanne le QR code, puis choisis l’ajustement de stock.' : 'Scanne un code-barres, puis ajoute l’article au panier de vente.';
    el('code').value = ''; controls();
  }
  function historyReplace(view) { window.history.replaceState(null, '', location.pathname + '?view=' + encodeURIComponent(view)); }
  function qrId(raw) {
    raw = String(raw).trim(); if (ID.test(raw)) return raw.toLowerCase();
    var url;
    try { url = new URL(raw); } catch (error) { throw new Error('Scanne le QR code de stock ou saisis l’identifiant de la variante.'); }
    if (url.origin !== location.origin || url.pathname !== '/stock.html' || url.search || url.username || url.password || !/^#variant=[0-9a-f-]+$/i.test(url.hash)) throw new Error('Ce QR code ne correspond pas au stock Hanna & Nour.');
    var value = url.hash.slice(9); if (!ID.test(value)) throw new Error('QR code de variante invalide.'); return value.toLowerCase();
  }
  function showVariant() {
    var p = variant.products || {};
    el('variantPanel').hidden = false; el('variantName').textContent = p.name_fr || p.name_en || 'Variante';
    el('variantOptions').textContent = [variant.color,variant.size].filter(Boolean).join(' · ');
    el('variantDetails').textContent = variant.barcode ? 'Code-barres : ' + variant.barcode : 'Aucun code-barres enregistré. Le QR code reste disponible.';
    el('variantStock').textContent = 'Stock disponible : ' + variant.stock + ((!p.active || !variant.active || p.catalog_deleted_at) ? ' · Vente indisponible' : '');
    el('addSale').hidden = mode !== 'sale'; el('adjustForm').hidden = mode !== 'stock';
    el('quantity').value = ''; el('reason').value = ''; el('adjustPreview').textContent = ''; controls();
    if (mode === 'labels') el('variantPanel').scrollIntoView({block:'start',behavior:'auto'});
  }
  async function lookup(raw) {
    var current = ++lookupRevision, selectedMode = mode;
    variant = null; el('variantPanel').hidden = true;
    var code = selectedMode === 'stock' || selectedMode === 'labels' ? qrId(raw) : String(raw).trim();
    if (selectedMode === 'sale' && !/^[\x21-\x7e]{1,80}$/.test(code)) throw new Error('Scanne un code-barres de vente, pas un QR code de stock.');
    var data = await call('stockLookup',{kind:selectedMode === 'stock' || selectedMode === 'labels' ? 'qr' : 'barcode',code:code});
    if (current !== lookupRevision || selectedMode !== mode) return;
    variant = data.variant; if (!variant || !ID.test(variant.id) || !Number.isInteger(variant.stock)) throw new Error('Fiche de variante incomplète.');
    showVariant(); say('Variante identifiée. Aucun stock modifié.');
  }
  function items() { return cart.map(function (line) { return {variant_id:line.variant_id,quantity:line.quantity}; }); }
  async function refreshQuote() {
    invalidateQuote(); if (!cart.length) throw new Error('Le panier de vente est vide.');
    var data = await call('quotePhysicalSale',{items:items()});
    var result = data.result;
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total_cents) || !['eur','usd'].includes(result.currency)) throw new Error('Récapitulatif incomplet.');
    quote = result;
    el('saleTotal').textContent = money(result.total_cents,result.currency);
    el('paymentStep').hidden = false;
    el('saleSummary').textContent = result.items.map(function (i) { return i.name + ' · ' + i.quantity + ' × ' + money(i.unit_price_cents,result.currency); }).join('\n') + '\nSous-total : ' + money(result.subtotal_cents,result.currency) + '\nTVA : ' + money(result.tax_cents,result.currency) + '\nTotal à encaisser : ' + money(result.total_cents,result.currency);
    say('Prix, TVA et stock vérifiés. Encaisse le total affiché avant confirmation.');
  }
  async function executePending() {
    var operation = pending;
    if (!operation) return;
    try {
      var data = await call(operation.action,operation.body), result = data.result;
      if (!result || result.operation_id !== operation.body.operation_id) throw new Error('Confirmation incomplète. Reprends la même opération.');
      if (operation.action === 'recordPhysicalSale' && (result.total_cents !== operation.body.quote.total_cents || result.currency !== operation.body.quote.currency || !result.order_number)) throw new Error('Montant non confirmé.');
      if (operation.action === 'adjustInventory' && (!Number.isInteger(result.stock_after) || !Number.isInteger(result.stock_before))) throw new Error('Stock non confirmé.');
      savePending(null);
      if (operation.action === 'recordPhysicalSale') { cart = []; invalidateQuote(); drawCart(); say('Vente enregistrée : ' + result.order_number + '\n' + money(result.total_cents,result.currency) + '. Le stock et l’admin sont synchronisés.'); }
      else { if (variant && variant.id === operation.body.variant_id) { variant.stock = result.stock_after; showVariant(); } say('Stock enregistré : ' + result.stock_before + ' → ' + result.stock_after + '. Historique conservé dans l’admin.'); }
    } catch (error) {
      if (['physical_quote_changed','physical_stock','physical_unavailable','physical_config','inventory_stock_changed','inventory_stock_bounds'].indexOf(error.code) >= 0) { savePending(null); invalidateQuote(); variant = null; el('variantPanel').hidden = true; }
      throw error;
    }
  }
  async function history() {
    var data = await call('listPhysicalSales',{page:page});
    total = data.total; el('history').textContent = '';
    (data.orders || []).forEach(function (order) {
      var box = document.createElement('details'); box.className = 'stock-history-order';
      var summary = document.createElement('summary'), heading = document.createElement('span');
      var title = document.createElement('strong'); title.textContent = order.order_number;
      var date = document.createElement('small'); date.textContent = new Date(order.paid_at).toLocaleString('fr-FR') + ' · ' + ({cash:'Espèces',card:'Terminal bancaire',other:'Autre'}[order.external_payment_method] || '');
      var amount = document.createElement('b'); amount.textContent = money(order.total_cents,order.currency);
      var text = document.createElement('p'); text.textContent = (order.order_items || []).map(function (i) { return i.quantity + ' × ' + i.product_name + ' · ' + i.variant; }).join('\n');
      heading.append(title,date); summary.append(heading,amount); box.append(summary,text); el('history').appendChild(box);
    });
    el('historyPage').textContent = 'Page ' + page + ' / ' + Math.max(1,Math.ceil(total/20));
  }
  function openApp() {
    el('loginPanel').hidden = true; el('app').hidden = false; el('logout').hidden = false;
    pending = readPending(); drawCart();
    var requested = new URLSearchParams(location.search).get('view');
    var nativeQr = location.hash.indexOf('#variant=') === 0;
    var view = pending ? (pending.action === 'adjustInventory' ? 'stock' : 'sale') : nativeQr ? 'stock' : ['sale','stock','labels','history'].indexOf(requested) >= 0 ? requested : 'sale';
    setMode(view, true); controls();
    if (pending) say('Une opération non confirmée est conservée. Vérifie-la avant de continuer.');
    else {
      var current = revision, qrLink = location.href;
      setTimeout(function () {
        if (current !== revision || !token() || pending || mode !== view) return;
        if (nativeQr) run(function () { return lookup(qrLink); });
        else if (view === 'labels') run(listVariants);
        else if (view === 'history') run(history);
      }, 0);
    }
  }
  el('loginForm').addEventListener('submit',function (event) { event.preventDefault(); run(async function () { var password = el('password').value; el('password').value = ''; var data = await call('login',{password:password}); if (!data.token) throw new Error('Connexion non confirmée.'); sessionStorage.setItem('hn-admin-token',data.token); say('Connecté.'); openApp(); }); });
  el('logout').addEventListener('click',function () { logout(); });
  document.querySelectorAll('[data-mode]').forEach(function (button) { button.addEventListener('click',function () { if (busy || pending) return; setMode(button.getAttribute('data-mode')); if (mode === 'history') run(history); if (mode === 'labels') run(listVariants); }); });
  el('scanForm').addEventListener('submit',function (event) { event.preventDefault(); if (!pending) run(function () { return lookup(el('code').value); }); });
  el('cameraStart').addEventListener('click',function () {
    if (busy || pending) return;
    if (!navigator.mediaDevices || !window.HN_STOCK_CODES) { say('Caméra indisponible. Saisis le code ou utilise un scanner clavier.'); return; }
    el('cameraPanel').hidden = false;
    var current = revision;
    window.HN_STOCK_CODES.start(mode,el('camera'),function (code) { if (current !== revision || busy || pending) return; stopCamera(); el('code').value = code; run(function () { return lookup(code); }); }).catch(function () { if (current === revision) { stopCamera(); say('Autorise la caméra dans Safari, ou saisis le code manuellement.'); } });
  });
  el('cameraStop').addEventListener('click',stopCamera);
  el('addSale').addEventListener('click',function () {
    if (busy || pending || el('addSale').disabled || !variant) return;
    var line = cart.find(function (i) { return i.variant_id === variant.id; });
    if ((line ? line.quantity : 0) >= Math.min(100,variant.stock)) { say('La quantité disponible est déjà dans le panier.'); return; }
    if (line) line.quantity++; else { if (cart.length >= 50) { say('Maximum 50 variantes par vente.'); return; } cart.push({variant_id:variant.id,quantity:1,name:variant.products.name_fr || variant.products.name_en,color:variant.color,size:variant.size}); }
    invalidateQuote(); drawCart(); say('Article ajouté au panier de vente. Aucun stock déduit.');
  });
  el('quoteSale').addEventListener('click',function () { if (!pending) run(refreshQuote); });
  el('collected').addEventListener('change',controls);
  el('payment').addEventListener('change',function () { el('collected').checked = false; controls(); });
  el('confirmSale').addEventListener('click',function () {
    if (busy || pending || !quote || !el('collected').checked || !el('payment').value) return;
    if (!window.confirm('Confirmer la vente de ' + money(quote.total_cents,quote.currency) + ' déjà encaissée ? Les articles seront déduits du stock.')) return;
    run(async function () { savePending({action:'recordPhysicalSale',summary:'Vente : ' + money(quote.total_cents,quote.currency),body:{operation_id:crypto.randomUUID(),items:items(),quote:quote,payment_method:el('payment').value,note:el('saleNote').value,confirmation:'ENCAISSE'}}); stopCamera(); controls(); await executePending(); });
  });
  function stockPreview() { if (!variant) return; var n = Number(el('quantity').value), target = el('adjustMode').value === 'count' ? n : variant.stock + (el('adjustMode').value === 'remove' ? -n : n); el('adjustPreview').textContent = el('quantity').value && Number.isInteger(n) ? 'Disponible : ' + variant.stock + ' → ' + target + ' unités.' : ''; }
  el('quantity').addEventListener('input',stockPreview); el('adjustMode').addEventListener('change',stockPreview);
  el('adjustForm').addEventListener('submit',function (event) {
    event.preventDefault(); if (busy || pending || !variant) return;
    var n = Number(el('quantity').value), operationMode = el('adjustMode').value, reason = el('reason').value.trim();
    if (!el('quantity').value || !Number.isInteger(n) || n < 0 || n > 1000000 || (operationMode !== 'count' && n === 0) || reason.length < 3 || reason.length > 300) { say('Indique une quantité entière et un motif de 3 à 300 caractères.'); return; }
    var target = operationMode === 'count' ? n : variant.stock + (operationMode === 'remove' ? -n : n);
    if (target < 0 || target > 1000000) { say('Quantité hors des limites du stock.'); return; }
    if (!window.confirm(variant.products.name_fr + ' · ' + variant.color + ' · ' + variant.size + '\nDisponible : ' + variant.stock + ' → ' + target + '\nMotif : ' + reason + '\nConfirmer ?')) return;
    run(async function () { savePending({action:'adjustInventory',summary:'Stock : ' + variant.stock + ' → ' + target,body:{operation_id:crypto.randomUUID(),variant_id:variant.id,mode:operationMode,quantity:n,expected_stock:variant.stock,reason:reason}}); stopCamera(); controls(); await executePending(); });
  });
  el('retry').addEventListener('click',function () { if (pending) run(executePending); });
  el('refreshHistory').addEventListener('click',function () { run(history); });
  el('previous').addEventListener('click',function () { if (page>1) { page--; run(history); } });
  el('next').addEventListener('click',function () { if (page*20<total) { page++; run(history); } });
  async function listVariants() {
    var data = await call('listStockVariants',{page:labelsPage}); labelsTotal = data.total; el('variantsList').textContent = '';
    (data.variants || []).forEach(function (v) { var box = document.createElement('div'); box.className = 'sale-line stock-label-choice'; var text = document.createElement('p'); text.textContent = (v.products.name_fr || v.products.name_en) + ' · ' + v.color + ' · ' + v.size; var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Choisir'; button.addEventListener('click',function () { if (busy || pending) return; run(function () { return lookup(v.id); }); }); box.append(text,button); el('variantsList').appendChild(box); });
    el('labelsPage').textContent = 'Page ' + labelsPage + ' / ' + Math.max(1,Math.ceil(labelsTotal/20));
  }
  el('labelsPrevious').addEventListener('click',function () { if (labelsPage>1) { labelsPage--; run(listVariants); } });
  el('labelsNext').addEventListener('click',function () { if (labelsPage*20<labelsTotal) { labelsPage++; run(listVariants); } });
  async function label(kind) {
    if (!variant) return;
    var current = variant;
    var text = kind === 'barcode' ? current.barcode : location.origin + '/stock.html#variant=' + current.id;
    el('labelTitle').textContent = kind === 'barcode' ? 'Étiquette vente' : 'Étiquette stock';
    el('labelName').textContent = current.products.name_fr || current.products.name_en;
    el('labelVariant').textContent = [current.color,current.size].filter(Boolean).join(' · ');
    el('labelBarcode').hidden = kind !== 'barcode'; el('labelQr').hidden = kind !== 'qr';
    el('labelKind').textContent = kind === 'barcode' ? 'VENTE · CODE-BARRES' : 'STOCK · QR CODE';
    el('labelCode').textContent = kind === 'barcode' ? text : current.id;
    if (kind === 'barcode') window.JsBarcode(el('labelBarcode'),text,{format:'CODE128',width:2,height:60,fontSize:14,margin:10});
    else { var image = await window.HN_STOCK_CODES.qr(text); if (current !== variant) return; el('labelQr').src = image; }
    el('labelDialog').showModal();
  }
  el('barcodeLabel').addEventListener('click',function () { if (!pending) run(function () { return label('barcode'); }); });
  el('qrLabel').addEventListener('click',function () { if (!pending) run(function () { return label('qr'); }); });
  el('printLabel').addEventListener('click',function () { window.print(); });
  el('closeLabel').addEventListener('click',function () { el('labelDialog').close(); });
  document.addEventListener('visibilitychange',function () { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide',stopCamera);
  window.addEventListener('hashchange',function () { if (token() && !busy && !pending && location.hash.indexOf('#variant=') === 0) { setMode('stock',true); run(function () { return lookup(location.href); }); } });
  window.addEventListener('storage',function (event) { if (event.key === KEY && token() && !busy) { pending = readPending(); controls(); } });
  if (token()) openApp();
})();
