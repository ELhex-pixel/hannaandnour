(function () {
  'use strict';
  var api = window.HN_ADMIN;
  var el = function (id) { return document.getElementById(id); };
  var panel = el('productDeletionInfo');
  if (!panel || !api) return;
  var ids = [], page = 0, revision = 0, busy = false;
  var uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  var titles = { visibility: 'Produit actuellement en ligne', stock: 'Variante(s) avec un stock non nul', orders: 'Ligne(s) de commande liée(s)', reviews: 'Avis lié(s)', adjustments: 'Ajustement(s) de stock, y compris archives', costs: 'Coût(s) de variante enregistré(s)', cost_history: 'Entrée(s) dans l’historique des coûts' };
  function node(tag, text, parent) {
    var value = document.createElement(tag);
    if (text !== undefined) value.textContent = String(text);
    if (parent) parent.appendChild(value);
    return value;
  }
  function date(value) { var parsed = new Date(value); return value && !isNaN(parsed.getTime()) ? parsed.toLocaleString('fr-FR') : 'Date non renseignée'; }
  function variant(sample) { return [sample.color, sample.size].filter(Boolean).join(' / ') || sample.variant_id || sample.id || 'Variante'; }
  function sampleText(kind, sample) {
    var reference = sample.id || 'Référence non renseignée';
    if (kind === 'stock') return variant(sample) + ' : ' + sample.stock + ' unité(s)' + (sample.active === false ? ' — variante désactivée' : '') + ' · ' + reference;
    if (kind === 'orders') return 'Commande ' + (sample.order_number || sample.order_id) + ' · ' + ({ pending: 'En attente', paid: 'Payée', abandoned: 'Abandonnée', cancelled: 'Annulée', refunded: 'Remboursée', failed: 'Échouée' }[sample.status] || sample.status || 'Statut non renseigné') + ' · ' + sample.quantity + ' article(s) · ' + date(sample.created_at) + ' · ligne ' + reference;
    if (kind === 'reviews') return 'Avis ' + reference + ' · ' + ({ pending: 'À modérer', approved: 'Approuvé', rejected: 'Refusé' }[sample.status] || sample.status || '') + ' · ' + sample.rating + '/5 · ' + date(sample.created_at);
    if (kind === 'adjustments') return ({ restock: 'Arrivage', remove: 'Retrait', count: 'Comptage' }[sample.mode] || sample.mode) + ' · ' + variant(sample) + ' · ' + sample.stock_before + ' → ' + sample.stock_after + ' · ' + date(sample.created_at) + ' · motif : ' + sample.reason + ' · opération ' + reference;
    return variant(sample) + ' · coût ' + (sample.unit_cost_cents / 100).toFixed(2) + ' ' + String(sample.currency || '').toUpperCase() + ' · ' + date(sample.created_at) + (sample.reason ? ' · motif : ' + sample.reason : '') + ' · référence ' + reference;
  }
  function render(result, parent) {
    var card = node('article', undefined, parent); card.className = 'admin-deletion-card';
    var info = result.info;
    if (result.error) { node('h4', 'Produit ' + result.id, card); node('p', 'Diagnostic non confirmé : ' + result.error, card); return; }
    if (!info || info.id !== result.id || typeof info.missing !== 'boolean' || !Array.isArray(info.reasons) || (!info.missing && (!info.product || info.product.id !== result.id || typeof info.product.name !== 'string' || info.eligible !== (info.reasons.length === 0)))) { node('p', 'Réponse incomplète pour ' + result.id + '. Actualisez pour vérifier.', card); return; }
    if (info.missing) { node('h4', 'Produit ' + result.id, card); node('p', 'Fiche absente du catalogue actualisé.', card); return; }
    node('h4', info.product.name, card);
    node('p', [info.product.sku, info.product.slug, result.id].filter(Boolean).join(' · '), card).className = 'admin-muted';
    if (!info.reasons.length) { node('p', 'Aucun historique lié ni stock non nul détecté.', card); return; }
    info.reasons.forEach(function (reason) {
      if (!reason || !titles[reason.kind] || !Number.isSafeInteger(reason.count) || reason.count < 1 || !Array.isArray(reason.samples) || reason.samples.length > 3 || reason.samples.some(function (sample) { return !sample || typeof sample !== 'object'; })) { node('p', 'Motif non confirmé : actualisez pour vérifier.', card); return; }
      var section = node('div', undefined, card);
      node('strong', titles[reason.kind] + ' : ' + reason.count, section);
      if (reason.kind === 'visibility') { node('p', 'Supprimer du catalogue retirera aussi ce produit de la boutique.', section); return; }
      var list = node('ul', undefined, section);
      reason.samples.forEach(function (sample) {
        var item = node('li', sampleText(reason.kind, sample), list);
        if (reason.kind === 'orders' && uuid.test(sample.order_id || '')) {
          var button = node('button', 'Voir la commande', item);
          button.type = 'button'; button.className = 'btn btn-secondary btn-small view-order'; button.setAttribute('data-id', sample.order_id);
        }
      });
      if (reason.count > reason.samples.length) node('p', 'Références présentées : ' + reason.samples.length + ' sur ' + reason.count + '.', section).className = 'admin-muted';
    });
  }
  function controls() {
    el('productDeletionPrevious').disabled = busy || page === 0;
    el('productDeletionNext').disabled = busy || (page + 1) * 3 >= ids.length;
    el('productDeletionPage').textContent = ids.length ? (page * 3 + 1) + '–' + Math.min((page + 1) * 3, ids.length) + ' sur ' + ids.length + ' produit(s) de la demande' : '';
  }
  function load() {
    var owner = api.token(), request = ++revision;
    var current = ids.slice(page * 3, page * 3 + 3);
    busy = true; controls(); el('productDeletionDetails').textContent = 'Vérification des liens…';
    Promise.all(current.map(function (id) {
      return api.call('getProductDeletionInfo', { id: id }).then(function (info) { return { id: id, info: info }; }).catch(function (error) { return { id: id, error: error.message }; });
    })).then(function (results) {
      if (request !== revision || owner !== api.token()) return;
      el('productDeletionDetails').textContent = '';
      results.forEach(function (result) { render(result, el('productDeletionDetails')); });
    }).finally(function () { if (request === revision && owner === api.token()) { busy = false; controls(); } });
  }
  function clear() { revision++; ids = []; page = 0; busy = false; panel.hidden = true; el('productDeletionDetails').textContent = ''; controls(); }
  function show(selected) {
    clear();
    ids = Array.isArray(selected) ? selected.filter(function (id, index) { return typeof id === 'string' && uuid.test(id) && selected.indexOf(id) === index; }).slice(0, 100) : [];
    if (!ids.length) return;
    panel.hidden = false; load();
  }
  el('productDeletionPrevious').addEventListener('click', function () { if (!busy && page > 0) { page--; load(); } });
  el('productDeletionNext').addEventListener('click', function () { if (!busy && (page + 1) * 3 < ids.length) { page++; load(); } });
  el('closeProductDeletionInfo').addEventListener('click', clear);
  document.addEventListener('hn:admin-logout', clear);
  window.HN_PRODUCT_DELETION = { show: show, clear: clear };
})();
