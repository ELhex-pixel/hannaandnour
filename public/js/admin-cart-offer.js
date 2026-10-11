(function () {
  'use strict';
  var api = window.HN_ADMIN;
  var el = function (id) { return document.getElementById(id); };
  var form = el('cartOfferForm');
  if (!form || !api) return;
  var revision = 0, busy = false, loaded = false;
  function status(message) { el('cartOfferStatus').textContent = message; }
  function lock() {
    ['cartOfferEnabled', 'cartOfferPercent', 'saveCartOffer'].forEach(function (id) { el(id).disabled = busy || !loaded; });
    el('refreshCartOffer').disabled = busy;
  }
  function confirmOffer(offer) {
    if (!offer || typeof offer.enabled !== 'boolean' || !Number.isInteger(offer.percent_off) || offer.percent_off < 0 || offer.percent_off > 100 || (offer.enabled && offer.percent_off === 0)) throw new Error('Réponse incomplète : actualisez pour vérifier la promotion.');
    loaded = true;
    el('cartOfferEnabled').checked = offer.enabled;
    el('cartOfferPercent').value = offer.percent_off;
    status(offer.enabled ? 'Promotion surprise active : −' + offer.percent_off + ' % sur les articles du panier, sans cumul avec un code.' : 'Promotion surprise désactivée. Aucune remise automatique.');
  }
  function load() {
    if (busy) return;
    var request = ++revision, owner = api.token();
    busy = true; loaded = false; lock(); status('Chargement de la promotion…');
    api.call('getCartOffer').then(function (res) { if (request === revision && owner === api.token()) confirmOffer(res.offer); })
      .catch(function (error) { if (request === revision && owner === api.token()) status(error.message); })
      .finally(function () { if (request === revision && owner === api.token()) { busy = false; lock(); } });
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy || !loaded) return;
    var offer = { enabled: el('cartOfferEnabled').checked, percent_off: Number(el('cartOfferPercent').value) };
    if (el('cartOfferPercent').value === '' || !Number.isInteger(offer.percent_off) || offer.percent_off < 0 || offer.percent_off > 100 || (offer.enabled && offer.percent_off === 0)) { status('Choisissez une réduction entière de 1 à 100 % pour activer la promotion.'); return; }
    var request = ++revision, owner = api.token();
    busy = true; lock(); status('Enregistrement de la promotion…');
    api.call('saveCartOffer', { offer: offer }).then(function (res) {
      if (request !== revision || owner !== api.token()) return;
      if (!res.offer || res.offer.enabled !== offer.enabled || res.offer.percent_off !== offer.percent_off) throw new Error('Enregistrement non confirmé. Actualisez pour vérifier.');
      confirmOffer(res.offer);
    }).catch(function (error) { if (request === revision && owner === api.token()) status(error.message); })
      .finally(function () { if (request === revision && owner === api.token()) { busy = false; lock(); } });
  });
  el('refreshCartOffer').addEventListener('click', load);
  document.querySelector('[data-tab="promos"]').addEventListener('click', load);
  document.addEventListener('hn:admin-logout', function () {
    revision++; busy = false; loaded = false; form.reset(); lock();
    status('Ouvrez la rubrique pour vérifier l’état de la promotion.');
  });
})();
