(function () {
  'use strict';
  var api = window.HN_ADMIN, el = function (id) { return document.getElementById(id); };
  var list = el('returnRequestsList'); if (!list || !api) return;
  var state = { page:1,limit:10,total:0,scope:'open',query:'' }, revision = 0, loading = false, busy = false;
  var expanded = Object.create(null), pending = Object.create(null);
  var pendingKey = 'hn-admin-return-decisions';
  try { if (api.token()) { var saved = JSON.parse(sessionStorage.getItem(pendingKey)||'{}'); if (saved && typeof saved==='object' && !Array.isArray(saved)) pending=saved; } } catch (error) {}
  function savePending() { try { sessionStorage.setItem(pendingKey,JSON.stringify(pending)); return true; } catch (error) { return false; } }
  function node(tag,text,parent) { var n=document.createElement(tag); if (text!==undefined) n.textContent=String(text); if (parent) parent.appendChild(n); return n; }
  function message(text) { el('returnListStatus').textContent=text; }
  function controls() {
    ['returnAdminSearch','returnAdminScope','returnAdminPageSize','returnAdminApply','refreshReturnRequests'].forEach(function (id) { el(id).disabled=loading||busy; });
    var pages=Math.max(1,Math.ceil(state.total/state.limit));
    el('returnAdminPrevious').disabled=loading||busy||state.page<=1;
    el('returnAdminNext').disabled=loading||busy||state.page>=pages;
    el('returnAdminResults').textContent=(state.total?(state.page-1)*state.limit+1:0)+'–'+Math.min(state.page*state.limit,state.total)+' sur '+state.total+' demande(s) · page '+state.page+' / '+pages;
  }
  function confirmed(request,p) {
    if (!p || request.status!==p.status) return false;
    if (p.status==='received') return request.inspection && request.inspection.sellable_quantity===p.sellable_quantity && request.inspection.inspection_note===p.note;
    return request.decision_note===p.note && request.shipping_payer===p.shipping_payer;
  }
  function render(request,version,owner) {
    var order=request.orders||{}, item=request.order_items||{};
    var card=node('details',undefined,list); card.className='admin-return-card'; card.setAttribute('data-return-id',request.id); card.open=!!expanded[request.id];
    var summary=node('summary',undefined,card);
    node('strong',(order.order_number||'Commande')+' — '+(item.product_name||'Article')+' × '+request.quantity,summary);
    node('span',{requested:'À examiner',approved:'Autorisé — réception à contrôler',rejected:'Refusé',received:'Réception traitée — remboursement séparé'}[request.status]||request.status,summary).className='badge badge-gray';
    node('small',request.created_at?new Date(request.created_at).toLocaleDateString('fr-FR'):'',summary);
    var body=node('div',undefined,card); body.className='admin-return-body';
    node('p',({withdrawal:'Changement d’avis',seller_error:'Erreur de la boutique',nonconforming:'Défaut / non-conformité'}[request.category]||'Retour')+' — '+request.reason,body);
    node('p','Référence : '+request.id,body).className='admin-muted';
    node('p','Remboursement confirmé pour la commande : '+(Number.isSafeInteger(order.refunded_cents)?(order.refunded_cents/100).toFixed(2)+' '+String(order.currency||'').toUpperCase():'montant non confirmé')+'. Le remboursement se traite dans la commande.',body);
    var see=node('button','Voir la commande',body); see.type='button'; see.className='btn btn-secondary btn-small view-order'; see.setAttribute('data-id',request.order_id);
    if (request.decision_note) node('p','Décision : '+request.decision_note+' · Frais retour : '+(request.shipping_payer==='store'?'boutique':'client'),body);
    if (request.status==='received') {
      var inspection=request.inspection;
      node('p',inspection&&inspection.sellable_quantity!=null?inspection.sellable_quantity+' unité(s) revendables remises en stock, '+(inspection.quantity-inspection.sellable_quantity)+' hors vente. Contrôle : '+inspection.inspection_note:'Retour historique : contrôle revendable non documenté.',body);
    }
    (request.evidence_urls||[]).forEach(function (url) { var link=node('a','Voir la photo du retour',body); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; });
    var p=pending[request.id], payer, sellable, note, frozen=!!p, buttons=[];
    if (request.status==='requested') {
      node('label','Qui paie le retour ?',body); payer=node('select',undefined,body); payer.setAttribute('aria-label','Qui paie le retour ?');
      [['customer','Client — changement d’avis'],['store','Boutique']].forEach(function (entry) { var option=node('option',entry[1],payer); option.value=entry[0]; });
      payer.value=p?p.shipping_payer:request.category!=='withdrawal'?'store':(order.return_policy||{}).withdrawal_payer||'customer';
      payer.disabled=frozen||request.category!=='withdrawal'||(order.return_policy||{}).withdrawal_payer==='store';
    }
    if (request.status==='approved') {
      node('label','Unités contrôlées et revendables (0 à '+request.quantity+')',body);
      sellable=node('input',undefined,body); sellable.type='number'; sellable.min=0; sellable.max=request.quantity; sellable.step=1; sellable.required=true; sellable.value=p?p.sellable_quantity:''; sellable.disabled=frozen; sellable.setAttribute('aria-label','Unités revendables');
    }
    if (['requested','approved'].includes(request.status)) { node('label','Motif / contrôle enregistré',body); note=node('textarea',undefined,body); note.maxLength=500; note.setAttribute('aria-label','Motif / contrôle enregistré'); note.value=p?p.note:''; note.disabled=frozen; }
    var status=node('p','',body); status.setAttribute('role','status');
    if (p) status.textContent='Une décision reste à vérifier : réessayez la même opération ou actualisez.';
    var actions=p?[[p.status,'Vérifier / réessayer la même décision']]:request.status==='requested'?[['approved','Autoriser le retour'],['rejected','Refuser avec motif']]:request.status==='approved'?[['received','Confirmer la réception et le contrôle']]:[];
    actions.forEach(function (entry) {
      var button=node('button',entry[1],body); button.type='button'; button.className='btn btn-secondary btn-small'; button.setAttribute('data-return-action',entry[0]); buttons.push(button);
      button.addEventListener('click',function () {
        if (busy||loading) return;
        var payload=pending[request.id]||{id:request.id,status:entry[0],shipping_payer:payer?payer.value:request.shipping_payer,note:note.value.trim()};
        if (entry[0]==='received'&&!pending[request.id]) payload.sellable_quantity=sellable.value===''?null:Number(sellable.value);
        if (payload.note.length<3||payload.note.length>500||(entry[0]==='received'&&(!Number.isInteger(payload.sellable_quantity)||payload.sellable_quantity<0||payload.sellable_quantity>request.quantity))) { status.textContent='Renseignez le motif et la quantité revendable, zéro si aucun.'; return; }
        if (!pending[request.id]&&!confirm(entry[0]==='received'?'Confirmer la réception : '+payload.sellable_quantity+' unité(s) revendables, '+(request.quantity-payload.sellable_quantity)+' hors vente ? Le remboursement reste séparé.':'Enregistrer cette décision et son motif ?')) return;
        pending[request.id]=payload;
        if (!savePending()) { delete pending[request.id]; status.textContent='Impossible de conserver la décision. Aucune demande envoyée.'; return; }
        busy=true; controls(); buttons.forEach(function (b) { b.disabled=true; }); [payer,sellable,note].filter(Boolean).forEach(function (control) { control.disabled=true; });
        api.call('updateReturnRequest',payload).then(function (result) {
          if (version!==revision||owner!==api.token()) return;
          if (!result||result.ok!==true) throw new Error('Réponse incomplète : décision non confirmée.');
          delete pending[request.id]; savePending(); busy=false; message('Décision enregistrée.'); load();
        }).catch(function (error) { if (version===revision&&owner===api.token()) { busy=false; controls(); button.disabled=false; status.textContent=error.message+' Réessayez la même décision ou actualisez pour vérifier.'; } });
      });
    });
    if (['received','rejected'].includes(request.status)) {
      var remove=node('button','Supprimer de la liste',body); remove.type='button'; remove.className='btn btn-danger btn-small'; remove.disabled=frozen; remove.setAttribute('data-hide-return',request.id);
      remove.addEventListener('click',function () {
        if (busy||loading||pending[request.id]||!confirm('Retirer cette demande terminée de la liste admin ? La commande, le retour client et son historique restent conservés.')) return;
        busy=true; controls(); remove.disabled=true;
        api.call('hideCompletedReturn',{id:request.id,confirmation:'SUPPRIMER'}).then(function (result) {
          if (version!==revision||owner!==api.token()) return;
          if (!result||result.id!==request.id) throw new Error('Suppression de la liste non confirmée.');
          busy=false; delete expanded[request.id]; message('Demande terminée supprimée de la liste admin. Historique conservé.'); load();
        }).catch(function (error) { if (version===revision&&owner===api.token()) { busy=false; controls(); remove.disabled=false; message(error.message); } });
      });
    }
  }
  function load() {
    if (busy) return;
    var version=++revision, owner=api.token(); loading=true; controls(); list.textContent='Chargement…';
    return api.call('listReturnRequests',{query:state.query,scope:state.scope,page:state.page,limit:state.limit}).then(function (result) {
      if (version!==revision||owner!==api.token()) return;
      if (!result||!Array.isArray(result.requests)||!Number.isSafeInteger(result.total)||result.total<result.requests.length) throw new Error('Liste non confirmée. Actualisez.');
      state.total=result.total;
      var last=Math.max(1,Math.ceil(state.total/state.limit));
      if (state.page>last) { state.page=last; loading=false; return load(); }
      list.textContent='';
      result.requests.forEach(function (request) {
        var p=pending[request.id];
        if (confirmed(request,p)) delete pending[request.id];
        else if (p && (['received','rejected'].includes(request.status) || (request.status==='approved' && p.status!=='received'))) {
          delete pending[request.id]; message('Une décision est déjà enregistrée. Consultez les détails confirmés avant de poursuivre.');
        }
        render(request,version,owner);
      }); savePending();
      if (!result.requests.length) list.textContent='Aucune demande pour ces filtres. Les réceptions traitées et les refus sont accessibles avec le filtre correspondant.';
    }).catch(function (error) { if (version===revision&&owner===api.token()) list.textContent=error.message; })
      .finally(function () { if (version===revision&&owner===api.token()) { loading=false; controls(); } });
  }
  function filter() { if (busy) return; state.query=el('returnAdminSearch').value.trim(); state.scope=el('returnAdminScope').value; state.limit=Number(el('returnAdminPageSize').value)||10; state.page=1; message(''); load(); }
  el('returnAdminApply').addEventListener('click',filter);
  el('returnAdminSearch').addEventListener('keydown',function (event) { if (event.key==='Enter') { event.preventDefault(); filter(); } });
  ['returnAdminScope','returnAdminPageSize'].forEach(function (id) { el(id).addEventListener('change',filter); });
  el('returnAdminPrevious').addEventListener('click',function () { if (!busy&&!loading&&state.page>1) { state.page--; load(); } });
  el('returnAdminNext').addEventListener('click',function () { if (!busy&&!loading&&state.page*state.limit<state.total) { state.page++; load(); } });
  list.addEventListener('toggle',function (event) { var id=event.target.getAttribute('data-return-id'); if (id) expanded[id]=event.target.open; },true);
  el('refreshReturnRequests').addEventListener('click',load);
  document.querySelector('[data-tab="returns"]').addEventListener('click',load);
  document.addEventListener('hn:admin-logout',function () { revision++; loading=false; busy=false; pending=Object.create(null); expanded=Object.create(null); state.page=1; state.total=0; list.textContent=''; message(''); try { sessionStorage.removeItem(pendingKey); } catch (error) {} controls(); });
})();
