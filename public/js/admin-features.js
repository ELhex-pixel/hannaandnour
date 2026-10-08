(function () {
  'use strict';
  var call = window.HN_ADMIN.call;
  var draft = null;
  var revision = 0;
  var btn = document.getElementById('describePhotoBtn');
  var box = document.getElementById('photoDraft');
  var text = document.getElementById('photoDraftText');
  function analyze() {
    var request = ++revision;
    draft = null;
    document.getElementById('applyPhotoDraft').disabled = true;
    btn.disabled = true;
    box.hidden = false;
    text.textContent = 'Analyse de la photo…';
    call('describeProduct', { image: document.getElementById('f-image').value }).then(function (res) {
      if (request !== revision) return;
      draft = res.draft;
      text.textContent = 'Catégorie : ' + draft.category + '\n\n' + draft.name_fr + '\n' + draft.description_fr + '\n\nEN : ' + draft.description_en + '\n\nAR : ' + draft.description_ar;
      document.getElementById('applyPhotoDraft').disabled = false;
    }).catch(function (error) { if (request === revision) text.textContent = error.message; })
      .finally(function () { if (request === revision) btn.disabled = false; });
  }
  btn.addEventListener('click', analyze);
  document.addEventListener('hn:main-image-uploaded', function () { if (document.getElementById('autoDescribePhoto').checked) analyze(); });
  document.addEventListener('hn:product-editor', function () { revision++; draft = null; box.hidden = true; btn.disabled = false; });
  document.getElementById('applyPhotoDraft').addEventListener('click', function () {
    if (!draft) return;
    var overwrite = ['en', 'fr', 'ar'].some(function (lang) { return document.getElementById('f-desc_' + lang).value || document.getElementById('f-name_' + lang).value; });
    if (overwrite && !confirm('Remplacer les noms, descriptions et points forts actuels ?')) return;
    ['en', 'fr', 'ar'].forEach(function (lang) {
      document.getElementById('f-name_' + lang).value = draft['name_' + lang];
      document.getElementById('f-desc_' + lang).value = draft['description_' + lang];
      document.getElementById('f-features_' + lang).value = draft['features_' + lang].join(', ');
    });
    document.getElementById('f-category').value = draft.category;
    box.hidden = true;
  });

  var returnsRevision = 0;
  function renderReturns() {
    var list = document.getElementById('returnRequestsList');
    var requestVersion = ++returnsRevision, owner = window.HN_ADMIN.token();
    list.textContent = 'Chargement…';
    call('listReturnRequests').then(function (res) {
      if (requestVersion !== returnsRevision || owner !== window.HN_ADMIN.token()) return;
      list.textContent = '';
      (res.requests || []).forEach(function (request) {
        function node(tag, text) { var n = document.createElement(tag); if (text) n.textContent = text; card.appendChild(n); return n; }
        var card = document.createElement('section');
        card.className = 'card admin-return-card';
        var order = request.orders || {}, item = request.order_items || {};
        node('h3', (order.order_number || 'Commande') + ' — ' + (item.product_name || 'Article') + ' × ' + request.quantity);
        node('p', { requested:'1 · Demande à examiner',approved:'2 · Retour autorisé, réception à contrôler',rejected:'Demande refusée',received:'3 · Réception enregistrée' }[request.status] || request.status).className = 'badge badge-gray';
        node('p', ({ withdrawal:'Changement d’avis',seller_error:'Erreur de la boutique',nonconforming:'Défaut / non-conformité' }[request.category] || 'Changement d’avis') + ' — ' + request.reason);
        node('p', 'Remboursement confirmé pour la commande : ' + ((order.refunded_cents || 0) / 100).toFixed(2) + ' ' + (order.currency || '') + '. Aucun remboursement ni achat d’étiquette depuis ce formulaire.');
        if (request.decision_note) node('p', 'Décision : ' + request.decision_note + ' · Frais retour : ' + (request.shipping_payer === 'store' ? 'boutique' : 'client'));
        if (request.status === 'received') {
          var inspection = request.inspection;
          node('p', inspection && inspection.sellable_quantity != null ? inspection.sellable_quantity + ' unité(s) revendables remises en stock, ' + (inspection.quantity-inspection.sellable_quantity) + ' hors vente. Contrôle : ' + inspection.inspection_note : 'Retour historique : contrôle revendable non documenté. Aucune nouvelle remise en stock.');
        }
        (request.evidence_urls || []).forEach(function (url) { var link = document.createElement('a'); link.href = url; link.textContent = 'Voir la photo du retour'; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.appendChild(link); });
        var payer, sellable, note;
        if (request.status === 'requested') {
          node('label', 'Qui paie le retour ?');
          payer = node('select'); payer.setAttribute('aria-label', 'Qui paie le retour ?');
          [['customer','Client — changement d’avis uniquement'],['store','Boutique — erreur, défaut ou retour offert']].forEach(function (entry) { var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; payer.appendChild(option); });
          payer.value = request.category && request.category !== 'withdrawal' ? 'store' : (order.return_policy || {}).withdrawal_payer || 'customer';
          if ((request.category && request.category !== 'withdrawal') || (order.return_policy || {}).withdrawal_payer === 'store') payer.disabled = true;
        }
        if (request.status === 'approved') {
          node('p', 'Ouvrez et contrôlez le colis. Seules les unités revendables retournent au disponible ; les autres restent hors vente.');
          node('label', 'Unités contrôlées et revendables (0 à ' + request.quantity + ')');
          sellable = node('input'); sellable.type = 'number'; sellable.min = 0; sellable.max = request.quantity; sellable.step = 1; sellable.value = ''; sellable.required = true; sellable.setAttribute('aria-label', 'Unités revendables');
        }
        if (['requested','approved'].includes(request.status)) { node('label', 'Motif / contrôle enregistré'); note = node('textarea'); note.maxLength = 500; note.setAttribute('aria-label', 'Motif / contrôle enregistré'); }
        var actions = request.status === 'requested' ? [['approved', 'Autoriser le retour'], ['rejected', 'Refuser avec motif']] : request.status === 'approved' ? [['received', 'Confirmer la réception et le contrôle']] : [];
        var buttons = [], busy = false, frozen = null;
        var status = node('p'); status.setAttribute('role','status');
        actions.forEach(function (entry) {
          var button = document.createElement('button');
          button.className = 'btn btn-secondary btn-small';
          button.textContent = entry[1];
          button.setAttribute('data-return-action', entry[0]);
          buttons.push(button);
          button.addEventListener('click', function () {
            if (busy || (frozen && frozen.status !== entry[0])) return;
            var payload = frozen || { id:request.id,status:entry[0],shipping_payer:payer ? payer.value : request.shipping_payer,note:note.value.trim() };
            if (sellable) payload.sellable_quantity = frozen ? frozen.sellable_quantity : sellable.value === '' ? null : Number(sellable.value);
            if (payload.note.length < 3 || (sellable && (!Number.isInteger(payload.sellable_quantity) || payload.sellable_quantity < 0 || payload.sellable_quantity > request.quantity))) { status.textContent = 'Renseignez le contrôle et la quantité revendable, zéro si aucun.'; return; }
            if (!frozen && !confirm(entry[0] === 'received' ? 'Confirmer le colis reçu ? ' + payload.sellable_quantity + ' unité(s) revendables, ' + (request.quantity-payload.sellable_quantity) + ' hors vente. Aucun remboursement.' : 'Enregistrer cette décision et son motif ? Aucun email, remboursement ou achat d’étiquette.')) return;
            frozen = payload; busy = true;
            buttons.forEach(function (b) { b.disabled = true; });
            [payer,sellable,note].filter(Boolean).forEach(function (n) { n.disabled = true; });
            call('updateReturnRequest', payload).then(function (result) {
              if (requestVersion !== returnsRevision || owner !== window.HN_ADMIN.token()) return;
              if (!result || !result.ok) throw new Error('Réponse incomplète, vérifiez avant toute nouvelle opération.');
              renderReturns();
            }).catch(function (error) {
              if (requestVersion !== returnsRevision || owner !== window.HN_ADMIN.token()) return;
              busy = false; button.disabled = false;
              status.textContent = error.message + ' Réessayez la même décision ou actualisez pour vérifier.';
            });
          });
          card.appendChild(button);
        });
        list.appendChild(card);
      });
      if (!(res.requests || []).length) list.textContent = 'Aucune demande de retour.';
    }).catch(function (error) { if (requestVersion === returnsRevision && owner === window.HN_ADMIN.token()) list.textContent = error.message; });
  }
  document.addEventListener('hn:admin-logout', function () { returnsRevision++; document.getElementById('returnRequestsList').textContent = ''; });
  document.getElementById('refreshReturnRequests').addEventListener('click', renderReturns);
  document.querySelector('[data-tab="returns"]').addEventListener('click', renderReturns);

  var operationsRevision = 0, costsLoad = 0, policyLoad = 0, costs = [], policy = null, costBusy = false, policyBusy = false;
  function operationCurrent(version, owner) { return version === operationsRevision && owner === window.HN_ADMIN.token(); }
  function validReturnPolicy(value) {
    return value && Number.isInteger(value.days) && value.days >= 14 && value.days <= 365 && typeof value.version === 'string' && ['customer','store'].indexOf(value.withdrawal_payer) >= 0;
  }
  function pickCost() {
    var row = costs.filter(function (c) { return c.variant_id === document.getElementById('costVariant').value; })[0];
    document.getElementById('costAmount').value = row && row.unit_cost_cents != null ? (row.unit_cost_cents / 100).toFixed(2) : '';
    if (row) document.getElementById('costCurrency').value = row.currency;
  }
  function loadCosts() {
    if (costBusy) return;
    var load = ++costsLoad;
    var version = operationsRevision, owner = window.HN_ADMIN.token();
    document.getElementById('variantCostStatus').textContent = 'Chargement des coûts privés…';
    Promise.all([call('listProducts'),call('listVariantCosts')]).then(function (data) {
      if (!operationCurrent(version,owner) || load !== costsLoad) return;
      costs = data[1].costs || [];
      var select = document.getElementById('costVariant'), selected = select.value;
      select.textContent = '';
      var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choisir une variante'; select.appendChild(empty);
      (data[0].products || []).forEach(function (product) { (product.variants || []).forEach(function (variant) { var option = document.createElement('option'); option.value = variant.id; option.textContent = [product.name_fr || product.name_en || product.slug,variant.color,variant.size].filter(Boolean).join(' — '); select.appendChild(option); }); });
      select.value = selected;
      pickCost();
      document.getElementById('variantCostStatus').textContent = data[1].limited ? 'Liste partielle : 1 000 coûts maximum. Ne remplacez pas un coût absent sans vérification.' : 'Coûts visibles uniquement par l’admin. Coûts historiques inconnus non remplacés.';
    }).catch(function (error) { if (operationCurrent(version,owner)) document.getElementById('variantCostStatus').textContent = error.message; });
  }
  function loadPolicy() {
    if (policyBusy) return;
    var load = ++policyLoad;
    var version = operationsRevision, owner = window.HN_ADMIN.token();
    call('getReturnPolicy').then(function (res) {
      if (!operationCurrent(version,owner) || load !== policyLoad) return;
      if (!validReturnPolicy(res.policy)) throw new Error('Politique incomplète : actualisez avant de modifier.');
      policy = res.policy;
      document.getElementById('returnPolicyDays').value = policy.days;
      document.getElementById('setReturns').value = policy.days;
      document.getElementById('returnPolicyPayer').value = policy.withdrawal_payer;
      document.getElementById('returnPolicyStatus').textContent = 'Politique chargée. Aucun changement des anciennes commandes.';
    }).catch(function (error) { if (operationCurrent(version,owner)) document.getElementById('returnPolicyStatus').textContent = error.message; });
  }
  document.getElementById('costVariant').addEventListener('change',pickCost);
  document.getElementById('refreshVariantCosts').addEventListener('click',loadCosts);
  document.querySelector('[data-tab="sales"]').addEventListener('click',loadCosts);
  document.getElementById('refreshReturnPolicy').addEventListener('click',loadPolicy);
  document.querySelector('[data-tab="settings"]').addEventListener('click',loadPolicy);
  document.getElementById('variantCostForm').addEventListener('submit',function (event) {
    event.preventDefault(); if (costBusy) return;
    var id = document.getElementById('costVariant').value, input = document.getElementById('costAmount').value;
    var cents = input === '' ? null : Math.round(Number(input)*100);
    var row = costs.filter(function (c) { return c.variant_id === id; })[0];
    var currency = document.getElementById('costCurrency').value, reason = document.getElementById('costReason').value.trim();
    if (!id || (cents !== null && (!Number.isInteger(cents) || cents < 0 || Math.abs(Number(input)*100-cents) > 0.00001)) || reason.length < 3) return;
    if (!confirm('Coût par unité : ' + (cents === null ? 'inconnu' : (cents/100).toFixed(2)+' '+currency) + '. Appliquer aux futures ventes uniquement ?')) return;
    var version = operationsRevision, owner = window.HN_ADMIN.token(); costBusy = true; costsLoad++;
    document.getElementById('saveVariantCost').disabled = true;
    call('saveVariantCost',{ variant_id:id,unit_cost_cents:cents,currency:currency,expected_updated_at:row ? row.updated_at : null,reason:reason }).then(function (res) {
      if (!operationCurrent(version,owner)) return;
      if (!res.cost) throw new Error('Réponse incomplète : actualisez pour vérifier.');
      costs = costs.filter(function (c) { return c.variant_id !== id; }); costs.push(res.cost);
      document.getElementById('variantCostStatus').textContent = 'Coût enregistré pour les futures ventes. Aucun prix ni stock modifié.';
    }).catch(function (error) { if (operationCurrent(version,owner)) document.getElementById('variantCostStatus').textContent = error.message + ' Actualisez pour vérifier avant de modifier.'; })
      .finally(function () { if (operationCurrent(version,owner)) { costBusy = false; document.getElementById('saveVariantCost').disabled = false; } });
  });
  document.getElementById('returnPolicyForm').addEventListener('submit',function (event) {
    event.preventDefault(); if (policyBusy || !policy) return;
    var days = Number(document.getElementById('returnPolicyDays').value), payer = document.getElementById('returnPolicyPayer').value;
    if (!Number.isInteger(days) || days < 14 || days > 365) { document.getElementById('returnPolicyStatus').textContent = 'Saisissez 14 à 365 jours pour enregistrer. Zéro ne supprime pas le droit légal de rétractation.'; return; }
    if (!confirm('Afficher cette politique aux futurs achats : '+days+' jours ; changement d’avis à la charge '+(payer === 'store' ? 'de la boutique' : 'du client')+' ? Les commandes existantes et les droits légaux restent inchangés.')) return;
    var version = operationsRevision, owner = window.HN_ADMIN.token(); policyBusy = true; policyLoad++;
    document.getElementById('saveReturnPolicy').disabled = true;
    call('saveReturnPolicy',{ days:days,withdrawal_payer:payer,expected_version:policy.version }).then(function (res) {
      if (!operationCurrent(version,owner)) return;
      if (!validReturnPolicy(res.policy) || res.policy.days !== days || res.policy.withdrawal_payer !== payer) throw new Error('Réponse incomplète : actualisez pour vérifier.');
      policy = res.policy; document.getElementById('returnPolicyStatus').textContent = 'Nouvelle politique enregistrée. Conditions anciennes conservées.';
      document.getElementById('returnPolicyDays').value = policy.days;
      document.getElementById('setReturns').value = policy.days;
      try { localStorage.setItem('hn-return-policy-version', policy.version); } catch (error) {}
    }).catch(function (error) { if (operationCurrent(version,owner)) document.getElementById('returnPolicyStatus').textContent = error.message; })
      .finally(function () { if (operationCurrent(version,owner)) { policyBusy = false; document.getElementById('saveReturnPolicy').disabled = false; } });
  });
  document.addEventListener('hn:admin-logout',function () {
    operationsRevision++; costs = []; policy = null; costBusy = false; policyBusy = false;
    document.getElementById('variantCostForm').reset(); document.getElementById('costVariant').textContent = '';
    document.getElementById('returnPolicyForm').reset();
    document.getElementById('setReturns').value = '';
    ['variantCostStatus','returnPolicyStatus'].forEach(function (id) { document.getElementById(id).textContent = ''; });
    ['saveVariantCost','saveReturnPolicy'].forEach(function (id) { document.getElementById(id).disabled = false; });
  });

  var sendcloudBtn = document.getElementById('testSendcloudBtn');
  var sendcloudBox = document.getElementById('sendcloudDiagnostics');
  function sendcloudLine(message) {
    var paragraph = document.createElement('p');
    paragraph.textContent = message;
    sendcloudBox.appendChild(paragraph);
  }
  sendcloudBtn.addEventListener('click', function () {
    sendcloudBtn.disabled = true;
    sendcloudBox.textContent = 'Vérification Sendcloud, sans achat…';
    call('sendcloudDiagnostics').then(function (res) {
      sendcloudBox.textContent = '';
      var status = res.sendcloud;
      if (!status.configured) {
        sendcloudLine('Clés serveur absentes ou invalides. Vérifiez SENDCLOUD_PUBLIC_KEY et SENDCLOUD_SECRET_KEY dans Netlify (Functions, contexte Production), puis redéployez.');
        return;
      }
      sendcloudLine(status.authenticated ? 'Authentification API v3 réussie.' : 'Authentification non confirmée.');
      var integration = status.integration;
      if (!integration.ok) {
        sendcloudLine('Intégration : ' + integration.error);
      } else {
        sendcloudLine('Intégration n° ' + integration.id + '.');
        sendcloudLine(integration.service_points_enabled && integration.mondial_relay_enabled
          ? 'Points relais Mondial Relay activés dans Sendcloud.' : 'Activez Service Point delivery et cochez Mondial Relay dans Sendcloud → Integrations.');
        if (integration.other_carriers_enabled) sendcloudLine('Attention : d’autres transporteurs sont cochés dans Sendcloud. Conservez uniquement Mondial Relay pour cette connexion.');
        if (integration.webhook_active) sendcloudLine('Attention : webhook actif dans Sendcloud, mais sa réception n’est pas encore installée sur ce site.');
        if (integration.feedback_type === 'eager') sendcloudLine('Attention : le mode eager peut annoncer une expédition dès la création de l’étiquette. Ce n’est pas une prise en charge réelle.');
      }
      var contracts = status.contracts;
      if (!contracts.ok) {
        sendcloudLine('Contrat Mondial Relay : ' + contracts.error);
      } else {
        sendcloudLine(contracts.active ? contracts.active + ' contrat(s) Mondial Relay actif(s) trouvé(s). Les tarifs restent à vérifier chez le transporteur.'
          : contracts.pending ? 'Contrat Mondial Relay en cours de validation.' : 'Aucun contrat Mondial Relay actif trouvé dans ce résultat. Vérifiez le contrat dans Sendcloud.');
        if (contracts.incomplete) sendcloudLine('La liste des contrats est partielle ; l’absence dans ce premier lot ne prouve pas l’absence de contrat.');
      }
      var addresses = status.sender_addresses;
      if (!addresses.ok) {
        sendcloudLine('Adresse expéditeur : ' + addresses.error);
      } else {
        sendcloudLine(addresses.france ? 'Adresse(s) expéditeur en France métropolitaine trouvée(s). Vérifiez leur exactitude directement dans Sendcloud → Addresses.'
          : 'Aucune adresse expéditeur en France métropolitaine trouvée dans ce résultat. Vérifiez Sendcloud → Addresses.');
        if (addresses.incomplete) sendcloudLine('La liste des adresses est partielle.');
      }
      sendcloudLine('Aucun achat effectué. Suivi automatique et emails de livraison non activés par ce test.');
    }).catch(function (error) { sendcloudBox.textContent = error.message; })
      .finally(function () { sendcloudBtn.disabled = false; });
  });

  document.getElementById('sendcloudPointsForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = document.getElementById('searchSendcloudPointsBtn');
    if (button.disabled) return;
    var list = document.getElementById('sendcloudPoints');
    var postalCode = document.getElementById('sendcloudPostalCode').value.trim();
    button.disabled = true;
    list.textContent = 'Recherche des relais Mondial Relay…';
    call('searchSendcloudServicePoints', { postal_code: postalCode }).then(function (res) {
      list.textContent = '';
      if (!res.points.length) {
        list.textContent = res.geocoding_status === 'not_found' ? 'Code postal non localisé par Sendcloud.' : 'Aucun point Mondial Relay trouvé dans cette recherche.';
        return;
      }
      res.points.forEach(function (point) {
        var paragraph = document.createElement('p');
        var address = point.address;
        paragraph.textContent = point.name + (point.type === 'locker' ? ' — Locker' : ' — Point relais') + ' · '
          + [address.house_number, address.street, address.postal_code, address.city].filter(Boolean).join(' ')
          + (point.distance !== null ? ' · ' + (point.distance / 1000).toFixed(1) + ' km' : '');
        list.appendChild(paragraph);
      });
    }).catch(function (error) { list.textContent = error.message; })
      .finally(function () { button.disabled = false; });
  });
})();

(function () {
  'use strict';
  var api = window.HN_ADMIN;
  var el = function (id) { return document.getElementById(id); };
  var form = el('inventoryForm');
  if (!form) return;
  var rows = [], revision = 0, busy = false, snapshot = null, pending = null;
  var pendingKey = 'hn-admin-stock-operation';
  try { if (api.token && api.token()) pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch (e) {}
  var pendingReset = null, historyRevision = 0;
  var resetKey = 'hn-admin-journal-reset';
  try { if (api.token && api.token()) pendingReset = JSON.parse(sessionStorage.getItem(resetKey) || 'null'); } catch (e) {}
  function esc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function say(message) { el('inventoryStatus').hidden = false; el('inventoryStatus').textContent = message; }
  function clearPending() { pending = null; try { sessionStorage.removeItem(pendingKey); } catch (e) {} }
  function journalSay(message) { el('inventoryJournalStatus').hidden = false; el('inventoryJournalStatus').textContent = message; }
  function clearReset() { pendingReset = null; try { sessionStorage.removeItem(resetKey); } catch (e) {} }
  function preview() {
    var mode = el('inventoryMode').value, value = el('inventoryQuantity').value, qty = Number(value);
    if (!snapshot || ['restock','remove','count'].indexOf(mode) < 0 || value === '') { el('inventoryPreview').textContent = 'Choisissez une variante, une opération et une quantité pour voir le résultat avant envoi.'; return false; }
    if (!Number.isInteger(qty) || qty < 0 || qty > 1000000 || (mode !== 'count' && qty === 0)) { el('inventoryPreview').textContent = 'Saisissez une quantité entière valide.'; return false; }
    var after = mode === 'restock' ? snapshot.stock + qty : mode === 'remove' ? snapshot.stock - qty : qty;
    if (after < 0 || after > 1000000) { el('inventoryPreview').textContent = after < 0 ? 'Retrait impossible : quantité supérieure au disponible affiché.' : 'La quantité dépasserait la limite du stock.'; return false; }
    el('inventoryPreview').textContent = 'Aperçu : ' + snapshot.stock + (mode === 'restock' ? ' + ' + qty : mode === 'remove' ? ' − ' + qty : '') + ' → ' + after + ' unité(s) disponibles. Aucun changement avant confirmation. Le serveur vérifiera le stock au moment de l’enregistrement.';
    return true;
  }
  function lock(on) {
    form.querySelectorAll('input,select,textarea').forEach(function (node) { node.disabled = on || !!pendingReset; });
    el('saveInventory').disabled = busy || !!pendingReset || (!pending && !preview());
    el('saveInventory').textContent = pending ? 'Vérifier / réessayer la même opération' : 'Confirmer l’ajustement';
    el('resetInventoryJournal').disabled = busy || !!pending;
    el('resetInventoryJournal').textContent = pendingReset ? 'Vérifier / réessayer la réinitialisation' : 'Réinitialiser le journal à zéro';
    el('inventoryHistoryView').disabled = busy;
  }
  function modeLabel() {
    var mode = el('inventoryMode').value;
    el('inventoryQuantityLabel').textContent = mode === 'restock' ? 'Nombre d’unités à ajouter' : mode === 'remove' ? 'Nombre d’unités disponibles à retirer' : mode === 'count' ? 'Nouveau disponible, hors unités réservées ou vendues' : 'Quantité — choisissez d’abord l’opération';
    el('inventoryQuantity').min = mode === 'count' ? '0' : '1';
    el('inventoryReason').placeholder = mode === 'remove' ? 'Exemple : déstockage, article abîmé…' : mode === 'count' ? 'Exemple : recomptage du disponible physique…' : 'Exemple : arrivage fournisseur, référence du bon…';
    lock(!!pending);
  }
  function pick(id) {
    var row = rows.filter(function (value) { return value.id === id; })[0];
    if (!row) { snapshot = null; el('inventoryVariant').value = ''; el('inventoryCurrent').textContent = 'Variante non disponible dans la liste chargée.'; lock(!!pending); return; }
    snapshot = row;
    el('inventoryVariant').value = id;
    el('inventoryCurrent').textContent = row.label + ' — ' + row.stock + ' unité(s) actuellement disponibles' + (row.active ? '' : ' — hors ligne');
    lock(!!pending);
  }
  function render() {
    var active = rows.filter(function (row) { return row.active; });
    var stats = [[active.length, 'Variantes en vente'], [active.reduce(function (n, row) { return n + row.stock; }, 0), 'Unités disponibles'], [active.filter(function (row) { return row.stock === 0; }).length, 'Variantes épuisées'], [active.filter(function (row) { return row.stock > 0 && row.stock <= 5; }).length, 'Stock faible (1 à 5)']];
    el('inventorySummary').innerHTML = stats.map(function (item) { return '<div class="stat-card"><strong>' + item[0] + '</strong><span>' + item[1] + '</span></div>'; }).join('');
    var query = el('inventorySearch').value.toLowerCase().trim(), filter = el('inventoryFilter').value;
    var list = rows.filter(function (row) {
      if (filter !== 'all' && !row.active) return false;
      if (filter === 'low' && !(row.stock > 0 && row.stock <= 5)) return false;
      if (filter === 'empty' && row.stock !== 0) return false;
      return !query || (row.label + ' ' + row.barcode).toLowerCase().indexOf(query) >= 0;
    });
    el('inventoryList').innerHTML = !list.length ? '<p class="empty">Aucune variante pour ces filtres. Si le produit n’a pas de variantes, configurez ses tailles et coloris dans sa fiche.</p>' :
      '<table class="admin-table"><thead><tr><th>Produit / variante</th><th>Disponible</th><th>État</th><th>Action</th></tr></thead><tbody>' + list.map(function (row) {
        return '<tr><td data-label="Variante"><strong>' + esc(row.label) + '</strong><br><small>' + esc(row.barcode || 'Code-barres non configuré') + '</small></td><td data-label="Disponible">' + row.stock + '</td><td data-label="État"><span class="badge ' + (row.stock === 0 ? 'badge-red' : row.stock <= 5 ? 'badge-warn' : 'badge-green') + '">' + (row.active ? row.stock === 0 ? 'Épuisé' : row.stock <= 5 ? 'Stock faible' : 'Disponible' : 'Hors ligne') + '</span></td><td data-label="Action"><button type="button" class="btn btn-secondary btn-small" data-inventory-variant="' + esc(row.id) + '">Ajuster</button></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function renderHistory(adjustments) {
    if (!adjustments.length) { el('inventoryHistory').innerHTML = '<p class="empty">' + (el('inventoryHistoryView').value === 'archived' ? 'Aucun ajustement archivé.' : 'Aucun ajustement dans le journal courant.') + '</p>'; return; }
    el('inventoryHistory').innerHTML = '<table class="admin-table"><thead><tr><th>Date / opération</th><th>Variante</th><th>Disponible avant → après</th><th>Motif</th></tr></thead><tbody>' + adjustments.map(function (entry) {
      return '<tr><td data-label="Opération">' + esc(new Date(entry.created_at).toLocaleString('fr-FR')) + '<br><small>' + esc({ restock: 'Arrivage', remove: 'Retrait', count: 'Comptage' }[entry.mode] || entry.mode) + ' · ' + esc(entry.id) + '</small></td><td data-label="Variante">' + esc([entry.product_name, entry.color, entry.size].filter(Boolean).join(' — ')) + '</td><td data-label="Avant → après">' + entry.stock_before + ' → ' + entry.stock_after + '</td><td data-label="Motif">' + esc(entry.reason) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }
  function loadHistory() {
    var request = ++historyRevision, owner = api.token(), archived = el('inventoryHistoryView').value === 'archived';
    api.call('listInventoryAdjustments', { archived: archived }).then(function (res) {
      if (request !== historyRevision || owner !== api.token()) return;
      if (!Array.isArray(res.adjustments)) throw new Error('Journal non confirmé. Actualisez la rubrique.');
      renderHistory(res.adjustments);
    }).catch(function (error) { if (request === historyRevision && owner === api.token()) el('inventoryHistory').textContent = error.message; });
  }
  function load(selectId) {
    if (busy) return;
    var request = ++revision, owner = api.token();
    var selected = typeof selectId === 'string' ? selectId : (pending ? pending.variant_id : el('inventoryVariant').value);
    api.call('listProducts').then(function (res) {
      if (request !== revision || owner !== api.token()) return;
      rows = [];
      (res.products || []).forEach(function (product) {
        (product.variants || []).forEach(function (variant) {
          rows.push({ id: variant.id, stock: variant.stock, active: product.active !== false && variant.active !== false, barcode: variant.barcode || '', label: [product.name_fr || product.name_en || product.slug, variant.color, variant.size].filter(Boolean).join(' — ') });
        });
      });
      render();
      el('inventoryVariant').innerHTML = '<option value="">Choisir une variante</option>' + rows.map(function (row) { return '<option value="' + esc(row.id) + '">' + esc(row.label) + (row.active ? '' : ' — hors ligne') + '</option>'; }).join('');
      pick(selected || '');
      if (pending) {
        el('inventoryMode').value = pending.mode;
        el('inventoryQuantity').value = pending.quantity;
        el('inventoryReason').value = pending.reason;
        say('Une opération reste à confirmer. Vérifiez ou réessayez la même opération : ses identifiants sont conservés pour éviter un double ajout.');
      }
      modeLabel();
      lock(!!pending);
    }).catch(function (error) { if (request === revision && owner === api.token()) say(error.message); });
    loadHistory();
    if (pendingReset && el('inventoryJournalStatus').hidden) journalSay('Une réinitialisation reste à confirmer. Réessayez la même demande ; aucun stock ne sera modifié.');
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy || pendingReset) return;
    if (!pending) {
      if (!snapshot) { say('Choisissez une variante.'); return; }
      var qty = Number(el('inventoryQuantity').value), mode = el('inventoryMode').value, reason = el('inventoryReason').value.trim();
      if (!preview()) { say('Vérifiez la variante, l’opération et l’aperçu avant de confirmer.'); return; }
      if (!el('inventoryQuantity').value || !Number.isInteger(qty) || qty < 0 || qty > 1000000 || (mode !== 'count' && qty === 0) || reason.length < 3 || reason.length > 300) { say('Renseignez une quantité entière valide et un motif de 3 à 300 caractères.'); return; }
      if (!confirm(snapshot.label + '\n\n' + (mode === 'restock' ? 'Ajouter ' + qty + ' unités au disponible.' : mode === 'remove' ? 'Retirer ' + qty + ' unités du disponible.' : 'Remplacer le disponible affiché (' + snapshot.stock + ') par ' + qty + ', hors unités réservées ou vendues.') + '\nMotif : ' + reason)) return;
      if (!window.crypto || !window.crypto.randomUUID) { say('Utilisez un navigateur récent avec une connexion sécurisée. Aucune opération envoyée.'); return; }
      pending = { operation_id: window.crypto.randomUUID(), variant_id: snapshot.id, mode: mode, quantity: qty, expected_stock: snapshot.stock, reason: reason };
      try { sessionStorage.setItem(pendingKey, JSON.stringify(pending)); } catch (error) { pending = null; say('Impossible de conserver l’identifiant de l’opération. Aucune demande envoyée.'); return; }
    }
    var owner = api.token(), request = revision;
    busy = true;
    lock(true);
    say('Vérification et enregistrement en cours…');
    api.call('adjustInventory', pending).then(function (res) {
      if (owner !== api.token() || request !== revision) return;
      var result = res.result;
      if (!result || result.operation_id !== pending.operation_id || !Number.isInteger(result.stock_before) || result.stock_before < 0 || !Number.isInteger(result.stock_after) || result.stock_after < 0 || result.stock_after > 1000000 || result.stock_after !== (pending.mode === 'restock' ? result.stock_before + pending.quantity : pending.mode === 'remove' ? result.stock_before - pending.quantity : pending.quantity)) throw new Error('Réponse incomplète : opération non confirmée.');
      clearPending();
      say((result.already ? 'Opération déjà enregistrée, aucun double ajustement. ' : 'Ajustement enregistré. ') + 'Disponible lors de l’opération : ' + result.stock_before + ' → ' + result.stock_after + '.');
      el('inventoryQuantity').value = '';
      el('inventoryReason').value = '';
    }).catch(function (error) {
      if (owner !== api.token() || request !== revision) return;
      if (error.code && error.code !== 'inventory_operation_mismatch') clearPending();
      say(error.message + (pending ? ' Ne créez pas une autre opération : utilisez « Vérifier / réessayer la même opération ».' : ' Actualisez puis vérifiez les quantités avant un nouvel envoi.'));
    }).finally(function () {
      if (owner !== api.token() || request !== revision) return;
      busy = false;
      lock(!!pending);
      if (!pending) load();
    });
  });
  el('resetInventoryJournal').addEventListener('click', function () {
    if (busy || pending) { journalSay('Confirmez d’abord l’ajustement de stock en cours.'); return; }
    if (!pendingReset) {
      if (!confirm('Réinitialiser le journal courant à zéro ?\n\nToutes les opérations déjà enregistrées seront archivées, pas supprimées, y compris celles au-delà des 100 lignes affichées.\nLe stock et les commandes restent inchangés. Les nouvelles opérations resteront visibles.')) return;
      if (!window.crypto || !window.crypto.randomUUID) { journalSay('Utilisez un navigateur récent avec une connexion sécurisée. Aucune demande envoyée.'); return; }
      pendingReset = { operation_id: window.crypto.randomUUID(), confirmation: 'REINITIALISER' };
      try { sessionStorage.setItem(resetKey, JSON.stringify(pendingReset)); } catch (error) { pendingReset = null; journalSay('Impossible de conserver l’identifiant. Aucune demande envoyée.'); return; }
    }
    var owner = api.token(), operation = pendingReset.operation_id;
    busy = true;
    historyRevision++;
    revision++;
    lock(true);
    journalSay('Réinitialisation du journal en cours… Aucun changement de stock.');
    api.call('resetInventoryJournal', pendingReset).then(function (res) {
      if (owner !== api.token() || !pendingReset || operation !== pendingReset.operation_id) return;
      var result = res.result;
      if (!result || result.operation_id !== operation || !Number.isInteger(result.archived_count) || result.archived_count < 0) throw new Error('Réponse incomplète : réinitialisation non confirmée.');
      clearReset();
      el('inventoryHistoryView').value = 'current';
      journalSay((result.already ? 'Réinitialisation déjà enregistrée. ' : 'Journal réinitialisé. ') + result.archived_count + ' opération(s) archivée(s), consultables dans « Archives ». Stock inchangé.');
    }).catch(function (error) {
      if (owner !== api.token() || !pendingReset || operation !== pendingReset.operation_id) return;
      if (error.code === 'inventory_journal_invalid') clearReset();
      journalSay(error.message + (pendingReset ? ' Utilisez « Vérifier / réessayer la réinitialisation » : la même demande sera conservée.' : ' Aucune réinitialisation confirmée.'));
    }).finally(function () {
      if (owner !== api.token()) return;
      busy = false;
      lock(!!pending);
      load();
    });
  });
  el('inventoryHistoryView').addEventListener('change', function () { if (!busy) loadHistory(); });
  el('inventoryMode').addEventListener('change', modeLabel);
  el('inventoryQuantity').addEventListener('input', function () { lock(!!pending); });
  el('inventoryVariant').addEventListener('change', function () { if (!pending) pick(this.value); });
  el('inventorySearch').addEventListener('input', render);
  el('inventoryFilter').addEventListener('change', render);
  el('refreshInventory').addEventListener('click', function () { load(); });
  document.querySelector('[data-tab="inventory"]').addEventListener('click', function () { load(); });
  el('inventoryList').addEventListener('click', function (event) {
    var button = event.target.closest('[data-inventory-variant]');
    if (!button) return;
    if (pending || pendingReset || busy) { say('Confirmez d’abord l’opération en cours avant de changer de variante.'); return; }
    pick(button.getAttribute('data-inventory-variant'));
    form.scrollIntoView({ block: 'start' });
    el('inventoryQuantity').focus();
  });
  document.addEventListener('hn:inventory-variant', function (event) {
    if (pending || pendingReset || busy) { say('Confirmez d’abord l’opération en cours avant de changer de variante.'); return; }
    load(event.detail);
    form.scrollIntoView({ block: 'start' });
  });
  document.addEventListener('hn:admin-logout', function () {
    revision++;
    historyRevision++;
    rows = []; snapshot = null; pending = null; busy = false;
    clearReset();
    try { sessionStorage.removeItem(pendingKey); } catch (e) {}
    form.reset();
    modeLabel();
    lock(false);
    ['inventoryList', 'inventorySummary', 'inventoryHistory', 'inventoryCurrent'].forEach(function (id) { el(id).textContent = ''; });
    el('inventoryVariant').innerHTML = '<option value="">Choisir une variante</option>';
    el('inventoryStatus').textContent = '';
    el('inventoryStatus').hidden = true;
    el('inventoryHistoryView').value = 'current';
    el('inventoryJournalStatus').textContent = '';
    el('inventoryJournalStatus').hidden = true;
  });
  modeLabel();
})();
