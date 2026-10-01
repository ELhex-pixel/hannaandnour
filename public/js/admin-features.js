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

  function renderReturns() {
    var list = document.getElementById('returnRequestsList');
    list.textContent = 'Chargement…';
    call('listReturnRequests').then(function (res) {
      list.textContent = '';
      (res.requests || []).forEach(function (request) {
        var card = document.createElement('div');
        card.className = 'card';
        var info = document.createElement('p');
        info.textContent = (request.orders ? request.orders.order_number : '') + ' — ' + (request.order_items ? request.order_items.product_name : '') + ' × ' + request.quantity + ' — ' + request.status + '\n' + request.reason;
        card.appendChild(info);
        (request.evidence_urls || []).forEach(function (url) { var link = document.createElement('a'); link.href = url; link.textContent = 'Voir la photo du retour'; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.appendChild(link); });
        var actions = request.status === 'requested' ? [['approved', 'Accepter'], ['rejected', 'Refuser']] : request.status === 'approved' ? [['received', 'Colis reçu : remettre en stock'], ['rejected', 'Refuser']] : [];
        actions.forEach(function (entry) {
          var button = document.createElement('button');
          button.className = 'btn btn-secondary btn-small';
          button.textContent = entry[1];
          button.addEventListener('click', function () {
            if (entry[0] === 'received' && !confirm('Confirmer la réception physique ? Ceci remet les articles en stock, sans remboursement Stripe automatique.')) return;
            button.disabled = true;
            call('updateReturnRequest', { id: request.id, status: entry[0] }).then(renderReturns).catch(function (error) { button.disabled = false; alert(error.message); });
          });
          card.appendChild(button);
        });
        list.appendChild(card);
      });
      if (!(res.requests || []).length) list.textContent = 'Aucune demande de retour.';
    }).catch(function (error) { list.textContent = error.message; });
  }
  document.getElementById('refreshReturnRequests').addEventListener('click', renderReturns);
  document.querySelector('[data-tab="returns"]').addEventListener('click', renderReturns);
})();
