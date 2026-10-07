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
