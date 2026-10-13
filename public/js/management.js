(function () {
  'use strict';
  var navigation = document.getElementById('adminNavigation');
  var desktop = window.matchMedia('(min-width: 900px)');
  function navigationSize() { if (navigation) navigation.open = desktop.matches; }
  navigationSize();
  if (desktop.addEventListener) desktop.addEventListener('change', navigationSize);
  else desktop.addListener(navigationSize);

  function tab(value) {
    return Array.prototype.find.call(document.querySelectorAll('.admin-tab'), function (button) { return button.getAttribute('data-tab') === value; });
  }
  function route() {
    if (!window.HN_ADMIN || !window.HN_ADMIN.token()) return;
    var button = tab(window.location.hash.slice(1));
    if (button && !button.classList.contains('active')) button.click();
  }
  function selected(button) {
    var more = button.closest('.management-nav-more');
    if (more) more.open = true;
    if (navigation && !desktop.matches) navigation.open = false;
    var heading = document.getElementById('adminSectionTitle');
    if (heading && document.getElementById('appView').style.display !== 'none') { heading.focus({ preventScroll:true }); heading.scrollIntoView({block:'start',behavior:'auto'}); }
  }
  document.querySelectorAll('.admin-tab').forEach(function (button) { button.addEventListener('click', function () { selected(button); }); });
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  // Keep native new-tab links correct despite the build's <base href="/">.
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    var href = link.getAttribute('href');
    if (tab(href.slice(1))) link.setAttribute('href', window.location.pathname + href);
  });
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var href = link.getAttribute('href');
    var button = href && href.charAt(0) === '#' ? tab(href.slice(1)) : null;
    if (!button) {
      try {
        var target = new URL(href, window.location.href);
        if (target.origin === window.location.origin && target.pathname === window.location.pathname && !target.search) button = tab(target.hash.slice(1));
      } catch (error) {}
    }
    if (!button) return;
    event.preventDefault();
    if (window.HN_ADMIN && window.HN_ADMIN.token()) button.click();
  });

  function details(title, nodes, className) {
    nodes = nodes.filter(Boolean);
    if (!nodes.length) return;
    var box = document.createElement('details'); box.className = 'management-details ' + (className || '');
    var summary = document.createElement('summary'); summary.textContent = title;
    nodes[0].parentNode.insertBefore(box, nodes[0]); box.appendChild(summary);
    nodes.forEach(function (node) { box.appendChild(node); });
    return box;
  }
  function byId(id) { return document.getElementById(id); }
  function filterGroup(search, ids) {
    var input = byId(search), toolbar = input && input.closest('.toolbar');
    if (!toolbar) return;
    var box = details('Filtres et tri', ids.map(byId), 'management-filters');
    if (box) { var row = document.createElement('div'); row.className = 'toolbar'; Array.prototype.slice.call(box.children).slice(1).forEach(function (node) { row.appendChild(node); }); box.appendChild(row); toolbar.insertAdjacentElement('afterend',box); }
  }
  filterGroup('filterProducts',['filterCategory','filterProductVisibility','filterProductStock','sortProducts','resetProductFilters']);
  filterGroup('inventorySearch',['inventoryVisibility','inventoryFilter','inventorySort','resetInventoryFilters']);
  var bulk = byId('productSelectionCount');
  if (bulk) details('Actions sur la sélection', ['inspectProductDeletion','activateSelectedProducts','archiveSelectedProducts','deleteSelectedProducts','clearProductSelection'].map(byId), 'management-bulk-actions');

  ['products','inventory','preparation','returns','sales'].forEach(function (name) {
    var panel = byId('panel-' + name);
    if (!panel) return;
    var notice = panel.querySelector(':scope > .admin-notice');
    if (notice) details({products:'Comprendre la visibilité des produits',inventory:'Comprendre le stock disponible',preparation:'Comment préparer un colis',returns:'Comment traiter un retour',sales:'Comprendre le bilan des ventes'}[name],[notice],'management-help');
  });
  var productHint = document.querySelector('#panel-products > p.admin-muted');
  if (productHint) details('Archivage et historique',[productHint],'management-help');
  var costs = byId('variantCostForm');
  if (costs) details('Coûts d’achat et marge',[costs.closest('.card')]);
  var legacy = byId('scanArea');
  if (legacy) details('Rechercher un code-barres au clavier',[legacy]);
  var journal = byId('inventoryHistory');
  if (journal) details('Historique des ajustements de stock',[journal.closest('.card')]);

  function quickLinks(panelId, links) {
    var panel = byId(panelId); if (!panel) return;
    var row = document.createElement('nav'); row.className = 'management-context-links'; row.setAttribute('aria-label','Accès associés');
    links.forEach(function (item) { var link = document.createElement('a'); link.href = item[1].charAt(0) === '#' ? window.location.pathname + item[1] : item[1]; link.textContent = item[0]; row.appendChild(link); });
    panel.insertBefore(row,panel.firstChild);
  }
  quickLinks('panel-orders',[['Préparer les colis','#preparation'],['Retours clients','#returns']]);
  quickLinks('panel-preparation',[['Voir les commandes','#orders']]);
  quickLinks('panel-inventory',[['Scanner un QR de stock','/stock.html?view=stock'],['Imprimer les étiquettes','/stock.html?view=labels']]);
  quickLinks('panel-sales',[['Vendre en magasin','/stock.html?view=sale'],['Historique magasin','/stock.html?view=history'],['Étiquettes et QR','/stock.html?view=labels']]);
  quickLinks('panel-returns',[['Voir les commandes','#orders']]);
})();
