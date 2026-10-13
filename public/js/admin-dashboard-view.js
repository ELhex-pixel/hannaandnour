(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_DASHBOARD_VIEW = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(cents, currency) { return Number.isInteger(cents) ? new Intl.NumberFormat('fr-FR',{style:'currency',currency:currency.toUpperCase()}).format(cents/100) : 'À compléter'; }
  function number(value) { return Number.isFinite(value) ? new Intl.NumberFormat('fr-FR').format(value) : '—'; }
  function ratio(value, base) { return base > 0 ? new Intl.NumberFormat('fr-FR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(value/base*100)+' %' : '—'; }
  function card(label, value, help, tone) {
    return '<article class="dashboard-kpi '+(tone || '')+'"><span class="dashboard-kpi-label">'+esc(label)+'</span><strong>'+esc(value)+'</strong><p>'+esc(help)+'</p></article>';
  }
  function costs(row, currency) {
    if (row.purchaseMinCents == null) return 'Non renseigné';
    var price = money(row.purchaseMinCents,currency);
    if (row.purchaseMaxCents !== row.purchaseMinCents) price += ' à ' + money(row.purchaseMaxCents,currency);
    return price;
  }
  function productRows(rows,currency) {
    return rows.map(function (row) {
      return '<tr><td data-label="Produit"><strong>'+esc(row.name || row.slug)+'</strong><small>'+esc(row.sold)+' unité(s) vendue(s)'+(row.returned ? ' · '+esc(row.returned)+' retournée(s)' : '')+'</small></td>'+
        '<td data-label="Prix de vente moyen">'+esc(money(row.averageSaleCents,currency))+'</td>'+
        '<td data-label="Prix d’achat par unité">'+esc(costs(row,currency))+(row.purchaseMissingUnits ? '<small>'+esc(row.purchaseMissingUnits)+' unité(s) sans coût historique</small>' : '')+'</td>'+
        '<td data-label="Coût d’achat total">'+esc(row.purchaseCents == null ? 'À compléter' : money(row.purchaseCents,currency))+'</td>'+
        '<td data-label="Marge articles">'+esc(row.marginCents == null ? 'Non calculable' : money(row.marginCents,currency))+'</td></tr>';
    }).join('');
  }
  function productTable(rows,currency) {
    return '<div class="dashboard-table-wrap"><table class="dashboard-table"><thead><tr><th>Produit / quantités</th><th>Vente / unité</th><th>Achat / unité</th><th>Coût d’achat total</th><th>Marge articles</th></tr></thead><tbody>'+productRows(rows,currency)+'</tbody></table></div>';
  }
  function finance(report) {
    var t=report.totals, currency=report.currency.code, rows=(report.products || []).filter(function (row) { return row.sold>0; });
    var purchase = t.purchaseCents == null ? 'À compléter' : money(t.purchaseCents,currency);
    var margin = !t.unitsSold ? 'Aucune vente' : t.marginCents == null ? 'Non calculable' : money(t.marginCents,currency);
    var html='<div class="dashboard-section-heading"><div><span class="management-kicker">Votre activité commerciale</span><h2>Chiffre d’affaires et achats</h2></div><span class="dashboard-currency">'+esc(currency.toUpperCase())+' · en ligne + magasin</span></div>';
    if (report.limited) html+='<p class="dashboard-alert">Lecture partielle : la limite de données a été atteinte. Les montants présentés ne couvrent pas toute l’activité.</p>';
    if ((report.excluded_currencies || []).length) html+='<p class="dashboard-alert">Autres devises exclues : '+esc(report.excluded_currencies.join(', ').toUpperCase())+'. Choisissez leur devise pour les consulter.</p>';
    html+='<div class="dashboard-finance-grid">'+
      card('Chiffre d’affaires encaissé',money(t.revenueCents,currency),'Montants payés, avec livraison et taxes.','dashboard-kpi-primary')+
      card('Net après remboursements',money(t.netRevenueCents,currency),'Encaissements − remboursements confirmés.','dashboard-kpi-primary')+
      card('Coût d’achat des articles vendus',purchase,'Prix d’achat figés × quantités vendues, avant retours.')+
      card('Marge articles estimée',margin,'Après coût d’achat et retours physiques, avant les autres frais.')+'</div>';
    html+='<div class="dashboard-mini-grid">'+card('Commandes payées',number(t.orders),number(t.onlineOrders)+' en ligne · '+number(t.physicalOrders)+' en magasin')+
      card('Articles vendus',number(t.unitsSold),number(t.returnedUnits)+' unité(s) retournée(s)')+
      card('Remboursements',money(t.refundedCents,currency),'Confirmés à ce jour pour les commandes de cette période.')+'</div>';
    if (t.purchaseMissingUnits) html+='<p class="dashboard-alert">Prix d’achat manquant pour '+esc(t.purchaseMissingUnits)+' unité(s). Coût connu sur '+esc(t.purchaseKnownUnits)+' unité(s) : '+esc(money(t.purchaseKnownCents,currency))+'. Le total des achats et la marge ne sont pas complets.</p>';
    else if (t.marginMissingUnits) html+='<p class="dashboard-alert">La marge de '+esc(t.marginMissingUnits)+' unité(s) n’est pas calculable avec les remboursements ou les informations de retour disponibles.</p>';
    html+='<div class="dashboard-actions"><button type="button" class="btn btn-secondary" data-dashboard-costs>Renseigner les prix d’achat</button><a class="btn btn-secondary" href="/admin.html#sales" data-dashboard-sales>Ouvrir le bilan des ventes</a></div>';
    html+='<details class="management-details dashboard-help"><summary>Que signifie « net » ici ?</summary><p>Le net affiché correspond au montant encaissé après les remboursements. Ce n’est pas le bénéfice net : les frais du terminal ou de Stripe, le transport, les emballages, les charges et les impôts ne sont pas renseignés ici.</p><p>La marge articles utilise les prix d’achat enregistrés au moment des ventes et les retours physiques contrôlés. Un coût absent n’est jamais remplacé par zéro. Les remboursements rendent cette marge non calculable lorsque leur répartition ne permet pas un calcul fiable.</p><p>La période porte sur la date du paiement. Les remboursements et retours connus à ce jour restent rattachés aux commandes de cette période.</p></details>';
    html+='<section class="dashboard-product-section"><h3>Prix d’achat et marge par produit</h3><p class="dashboard-caption">Prix de vente moyen après remises, hors taxes et livraison. Les prix d’achat sont historiques ; ils peuvent varier entre les ventes.</p>';
    if (!rows.length) html+='<p class="dashboard-empty">Aucune vente payée dans cette période et cette devise.</p>';
    else { html+=productTable(rows.slice(0,20),currency); if (rows.length>20) html+='<details class="management-details"><summary>Voir les '+esc(rows.length-20)+' autres produits vendus</summary>'+productTable(rows.slice(20),currency)+'</details>'; }
    html+='</section>';
    var current=report.purchase_prices || [];
    html+='<details class="management-details dashboard-current-costs"><summary>Prix d’achat enregistrés · '+esc(current.length)+' variante(s)</summary><p class="dashboard-caption">Ces prix s’appliquent aux prochaines ventes. Modifier un prix ici ne recalcule pas les coûts historiques. Chaque montant garde sa devise.</p>';
    if (!current.length) html+='<p class="dashboard-empty">Aucune variante active à afficher.</p>';
    else html+='<div class="dashboard-table-wrap"><table class="dashboard-table"><thead><tr><th>Produit / variante</th><th>Prix d’achat par unité</th></tr></thead><tbody>'+current.map(function (row) {
      var value=Number.isInteger(row.unit_cost_cents) && ['eur','usd'].indexOf(row.currency)>=0 ? money(row.unit_cost_cents,row.currency) : 'Non renseigné';
      return '<tr><td data-label="Produit"><strong>'+esc(row.name)+'</strong><small>'+esc([row.color,row.size].filter(Boolean).join(' · '))+'</small></td><td data-label="Prix d’achat">'+esc(value)+'</td></tr>';
    }).join('')+'</tbody></table></div>';
    return html+'<div class="dashboard-actions"><button type="button" class="btn btn-secondary" data-dashboard-costs>Modifier les prix d’achat</button></div></details>';
  }
  var pageNames = {index:'Accueil',shop:'Boutique',account:'Compte client',cart:'Panier',checkout:'Paiement',collections:'Collections',product:'Fiche produit',about:'Notre histoire',blog:'Blog','blog-post':'Article',contact:'Contact',success:'Confirmation de commande',terms:'Conditions de vente',privacy:'Confidentialité','size-guide':'Guide des tailles',review:'Avis client',reset:'Mot de passe'};
  function pageLabel(path) {
    var clean=String(path || '').split(/[?#]/)[0], lang=clean.match(/^\/(fr|en|ar)\//), key=clean.replace(/^\/(fr|en|ar)\//,'/').replace(/^\//,'').replace(/\.html\/?$/,'');
    return (pageNames[key] || (key.indexOf('products/')===0 ? 'Produit · '+key.slice(9) : key.indexOf('articles/')===0 ? 'Article · '+key.slice(9) : clean)) + (lang ? ' · '+lang[1].toUpperCase() : '');
  }
  function topList(rows, kind, names) {
    if (!rows || !rows.length) return '<p class="dashboard-empty">Aucune visite enregistrée pour cette période.</p>';
    var highest=Math.max(1,rows[0].views || 0);
    return '<ol class="dashboard-ranking">'+rows.map(function (row,index) {
      var label=kind==='product' ? (names[row.slug] || row.slug || 'Produit') : pageLabel(row.path);
      var percent=Math.max(0,Math.min(100,Math.round((row.views || 0)/highest*100)));
      return '<li><span class="dashboard-rank">'+(index+1)+'</span><div class="dashboard-ranking-item"><strong>'+esc(label)+'</strong><span class="dashboard-bar" aria-hidden="true"><span style="width:'+percent+'%"></span></span></div><b>'+esc(number(row.views))+'<small>vues</small></b></li>';
    }).join('')+'</ol>';
  }
  function analytics(response,period,names) {
    var data=response.summary && response.summary[period];
    if (!data || !data.counts) return '<p class="dashboard-empty">Statistiques indisponibles pour cette période.</p>';
    var c=data.counts, html='<div class="dashboard-section-heading"><div><span class="management-kicker">Comprendre les visites</span><h2>Activité du site</h2></div></div>';
    if (response.limited) html+='<p class="dashboard-alert">Lecture partielle : jusqu’à 20 000 événements récents. Les totaux et classements peuvent être incomplets.</p>';
    html+='<div class="dashboard-traffic-grid">'+card('Pages vues',number(c.pageview),'Nombre d’affichages, pas de visiteurs uniques.')+card('Fiches produit vues',number(c.product_view),'Consultations de produits enregistrées.')+card('Ajouts au panier',number(c.add_to_cart),'Actions enregistrées sur le site.')+card('Paiements commencés',number(c.checkout_attempt),'Tentatives de passage au paiement.')+'</div>';
    html+='<div class="dashboard-ratios">'+card('Achats web suivis',number(c.purchase),'Événements de paiement suivis, hors caisse magasin.')+card('Achats / ajouts panier',ratio(c.purchase,c.add_to_cart),'Rapport entre événements, pas un suivi individuel.')+card('Achats / pages vues',ratio(c.purchase,c.pageview),'Pourcentage affiché avec une décimale.')+'</div>';
    html+='<div class="dashboard-rankings"><section><h3>Produits les plus consultés</h3>'+topList(data.topProducts,'product',names || {})+'</section><section><h3>Pages les plus consultées</h3><p class="dashboard-caption">Les variantes d’URL d’une même page sont regroupées.</p>'+topList(data.topPaths,'page',{})+'</section></div>';
    return html;
  }
  return {finance:finance,analytics:analytics,money:money,ratio:ratio,pageLabel:pageLabel};
});
