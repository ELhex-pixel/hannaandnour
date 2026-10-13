(function () {
  'use strict';
  var api=window.HN_ADMIN, view=window.HN_DASHBOARD_VIEW;
  var revision=0, financial=null, visits=null, errors={finance:'',visits:''};
  function el(id) { return document.getElementById(id); }
  function active(request,owner) { return request===revision && owner===api.token(); }
  function message(container,text) { container.textContent=''; var p=document.createElement('p'); p.className='dashboard-empty'; p.textContent=text; container.appendChild(p); }
  function render() {
    var names=Object.create(null);
    if (financial) (financial.products || []).forEach(function (product) { names[product.slug]=product.name; });
    if (financial) el('dashboardFinance').innerHTML=view.finance(financial); else message(el('dashboardFinance'),errors.finance || 'Chargement des ventes et des coûts d’achat…');
    if (visits) el('dashboardTraffic').innerHTML=view.analytics(visits,el('statsPeriod').value,names); else message(el('dashboardTraffic'),errors.visits || 'Chargement des visites du site…');
  }
  function load() {
    var request=++revision, owner=api.token(), period=el('statsPeriod').value, currency=el('statsCurrency').value;
    if (!owner) return Promise.resolve();
    financial=null; visits=null; errors={finance:'',visits:''};
    el('refreshStatsBtn').disabled=true; el('dashboardStatus').textContent='Actualisation des données…'; render();
    return Promise.allSettled([api.call('saleStats',{period:period,currency:currency}),api.call('analyticsSummary')]).then(function (results) {
      if (!active(request,owner)) return;
      var f=results[0],v=results[1];
      if (f.status==='fulfilled' && f.value && f.value.totals && f.value.currency && ['eur','usd'].indexOf(f.value.currency.code)>=0) financial=f.value;
      else errors.finance=f.status==='rejected' && f.reason.status===401 ? 'Session expirée. Reconnectez-vous à l’admin.' : 'Les montants ne sont pas disponibles. Actualisez pour réessayer.';
      if (v.status==='fulfilled' && v.value && v.value.summary) visits=v.value;
      else errors.visits=v.status==='rejected' && v.reason.status===401 ? 'Session expirée. Reconnectez-vous à l’admin.' : 'Les visites ne sont pas disponibles. Actualisez pour réessayer.';
      render();
      el('dashboardStatus').textContent=financial && visits ? 'Données actualisées à '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : 'Certaines données n’ont pas pu être chargées. Les valeurs indisponibles ne sont pas remplacées par zéro.';
    }).finally(function () { if (active(request,owner)) el('refreshStatsBtn').disabled=false; });
  }
  el('statsPeriod').addEventListener('change',load);
  el('statsCurrency').addEventListener('change',load);
  el('statsList').addEventListener('click',function (event) {
    var costs=event.target.closest('[data-dashboard-costs]'),sales=event.target.closest('[data-dashboard-sales]');
    if (!costs && !sales) return;
    event.preventDefault();
    document.querySelector('.admin-tab[data-tab="sales"]').click();
    if (costs) {
      var form=el('variantCostForm'),details=form.closest('details');
      if (details) details.open=true;
      form.scrollIntoView({block:'start',behavior:'auto'}); el('costVariant').focus({preventScroll:true});
    }
  });
  document.addEventListener('hn:admin-logout',function () { revision++; financial=null; visits=null; errors={finance:'',visits:''}; el('dashboardFinance').textContent=''; el('dashboardTraffic').textContent=''; el('dashboardStatus').textContent=''; el('refreshStatsBtn').disabled=false; });
  window.HN_DASHBOARD={load:load};
})();
