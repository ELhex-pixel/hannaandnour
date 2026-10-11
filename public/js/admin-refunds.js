(function () {
  'use strict';
  var api = window.HN_ADMIN, revision = 0;
  var KEY = 'hn-admin-refund-operation';
  function stored() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(value) { try { if (value) sessionStorage.setItem(KEY,JSON.stringify(value)); else sessionStorage.removeItem(KEY); } catch (e) {} }
  function node(tag, text, parent) { var el=document.createElement(tag);if(text!=null)el.textContent=text;if(parent)parent.appendChild(el);return el; }
  function money(cents,currency) { return (cents/100).toFixed(2)+' '+String(currency).toUpperCase(); }
  function open(order, onUpdate) {
    var body=document.getElementById('orderModalBody'), root=document.createElement('section');
    var old=document.getElementById('partialRefundPanel');if(old)old.remove();
    root.id='partialRefundPanel';root.className='card admin-refund-panel';body.appendChild(root);
    var owner=api.token(), generation=++revision, info=null, quote=null, busy=false, quoteRevision=0;
    var local=stored();if(local && local.id!==order.id)local=null;
    node('h3','Remboursement par articles',root);
    node('p','Montant calculé depuis la commande payée, remise et taxe comprises. La livraison est facultative. Aucun retour physique ni mouvement de stock ne découle de ce formulaire.',root);
    var status=node('p','Chargement du journal…',root);status.setAttribute('role','status');
    var history=node('div',null,root), form=node('div',null,root), preview=node('div',null,root), controls=node('div',null,root);
    var quoteBtn=node('button','Calculer le remboursement',controls);quoteBtn.type='button';quoteBtn.className='btn btn-secondary';quoteBtn.disabled=true;
    var confirmBtn=node('button','Confirmer le remboursement',controls);confirmBtn.type='button';confirmBtn.className='btn btn-danger';confirmBtn.hidden=true;
    var retryBtn=node('button','Vérifier / reprendre la même opération',controls);retryBtn.type='button';retryBtn.className='btn btn-secondary';retryBtn.hidden=true;
    var resetBtn=node('button','Actualiser et préparer une nouvelle sélection',controls);resetBtn.type='button';resetBtn.className='btn btn-secondary';resetBtn.hidden=true;
    function active() { return owner===api.token() && generation===revision && root.isConnected && body.getAttribute('data-order-id')===order.id && document.getElementById('orderModal').classList.contains('open'); }
    function lock(value) { busy=value;root.querySelectorAll('button,input,textarea').forEach(function(el){el.disabled=value||el.hasAttribute('data-refund-unavailable')||!!(pendingId()&&(['INPUT','TEXTAREA'].includes(el.tagName)||el===quoteBtn||el===confirmBtn));}); }
    function invalidate() { quote=null;quoteRevision++;preview.textContent='';confirmBtn.hidden=true; }
    function pendingId() { return local ? local.operation_id : info && info.pending_operation; }
    function draw() {
      history.textContent='';form.textContent='';invalidate();
      node('p','Déjà remboursé : '+money(info.refunded_cents,info.currency)+' — Solde : '+money(info.remaining_cents,info.currency),history);
      (info.operations||[]).forEach(function(op){node('p',new Date(op.created_at).toLocaleString('fr-FR')+' — '+money(op.amount_cents,op.currency)+' — '+({prepared:'résultat à vérifier',pending:'en attente Stripe',succeeded:'confirmé',failed:'échoué'}[op.status]||'à vérifier')+' — '+op.reason,history);});
      retryBtn.hidden=!pendingId();resetBtn.hidden=!local || !!info.pending_operation;quoteBtn.hidden=!!pendingId();confirmBtn.hidden=true;
      if(pendingId()){ status.textContent='Une tentative est conservée. Reprenez son identifiant avant toute nouvelle demande.';return; }
      if(!info.remaining_cents){status.textContent='Aucun solde à rembourser.';quoteBtn.hidden=true;return;}
      var rows=node('div',null,form);
      (info.items||[]).forEach(function(item){
        var remaining=item.quantity-item.refunded_quantity;
        var label=node('label',item.product_name+(item.variant?' — '+item.variant:'')+' ('+remaining+' remboursable(s)) ',rows);
        var input=node('input',null,label);input.type='number';input.min='0';input.max=String(Math.max(0,remaining));input.step='1';input.value='0';input.setAttribute('data-refund-item',item.id);input.disabled=remaining<=0;
        if(remaining<=0)input.setAttribute('data-refund-unavailable','');input.addEventListener('input',invalidate);
      });
      var shippingLabel=node('label',null,form), shipping=node('input',null,shippingLabel);shipping.type='checkbox';shipping.id='refundShipping';node('span',' Inclure les frais de livraison encore remboursables',shippingLabel);shipping.addEventListener('change',invalidate);
      var label=node('label','Motif du remboursement',form), reason=node('textarea',null,label);reason.id='refundReason';reason.minLength=3;reason.maxLength=500;reason.addEventListener('input',invalidate);
      status.textContent='Saisissez les quantités à rembourser, puis calculez le montant.';quoteBtn.disabled=false;
    }
    function refresh() {
      lock(true);
      return api.call('getOrderRefunds',{id:order.id}).then(function(res){
        if(!active())return;
        if(!res.info || res.info.order_id!==order.id || !Number.isSafeInteger(res.info.remaining_cents) || !Array.isArray(res.info.items)||!Array.isArray(res.info.operations))throw new Error('Journal incomplet : actualisez avant de continuer.');
        info=res.info;
        if(local){var recorded=info.operations.find(function(op){return op.id===local.operation_id;});if(recorded && ['succeeded','failed'].includes(recorded.status)){local=null;save(null);}}
        draw();
      }).catch(function(error){if(active())status.textContent=error.message;}).finally(function(){if(active()){lock(false);if(!info)quoteBtn.disabled=true;}});
    }
    function payload() {
      var items=[];
      form.querySelectorAll('[data-refund-item]').forEach(function(input){var quantity=Number(input.value);if(!Number.isSafeInteger(quantity)||quantity<0||quantity>Number(input.max))throw new Error('Quantité entière comprise entre zéro et le disponible requise.');if(quantity)items.push({id:input.getAttribute('data-refund-item'),quantity:quantity});});
      if(!items.length)throw new Error('Sélectionnez au moins un article.');
      var reason=document.getElementById('refundReason').value.trim();if(reason.length<3||reason.length>500)throw new Error('Indiquez un motif de 3 à 500 caractères.');
      return {id:order.id,items:items,refund_shipping:document.getElementById('refundShipping').checked,reason:reason};
    }
    function result(res,id) {
      if(!active())return;
      if(!res || res.operation_id!==id || !['succeeded','pending','failed'].includes(res.status))throw new Error('Réponse non confirmée : reprenez la même opération.');
      if(res.status==='succeeded' && res.ok===true){if(!Number.isSafeInteger(res.amount_cents)||res.amount_cents<=0||(local&&res.amount_cents!==local.expected_amount_cents))throw new Error('Montant de confirmation incohérent : vérifiez la même opération.');local=null;save(null);invalidate();quoteBtn.hidden=true;retryBtn.hidden=true;form.textContent='';status.textContent='Remboursement confirmé.';return onUpdate('Remboursement confirmé');}
      if(res.status==='failed'){local=null;save(null);status.textContent='Échec confirmé dans Stripe. Actualisez pour préparer une autre opération.';return refresh();}
      status.textContent='Remboursement en attente dans Stripe. Vérifiez cette même opération ultérieurement.';retryBtn.hidden=false;confirmBtn.hidden=true;
    }
    quoteBtn.addEventListener('click',function(){
      if(busy || !active() || pendingId())return;
      var data;try{data=payload();}catch(error){status.textContent=error.message;return;}
      var request=++quoteRevision;lock(true);status.textContent='Calcul serveur…';
      api.call('quoteOrderRefund',data).then(function(res){
        if(!active()||request!==quoteRevision)return;
        var q=res.quote;if(!q||q.order_id!==order.id||!Number.isSafeInteger(q.amount_cents)||q.amount_cents<=0||!Number.isSafeInteger(q.refunded_cents)||!['eur','usd'].includes(q.currency))throw new Error('Devis incomplet.');
        quote={data:data,value:q};preview.textContent='';
        (q.lines||[]).forEach(function(line){node('p',line.product_name+' × '+line.quantity+' : '+money(line.amount_cents,q.currency),preview);});
        if(q.shipping_cents)node('p','Livraison : '+money(q.shipping_cents,q.currency),preview);
        node('strong','À rembourser : '+money(q.amount_cents,q.currency),preview);confirmBtn.hidden=false;status.textContent='Vérifiez la sélection et le montant avant confirmation.';
      }).catch(function(error){if(active()&&request===quoteRevision)status.textContent=error.message;}).finally(function(){if(active())lock(false);});
    });
    confirmBtn.addEventListener('click',function(){
      if(busy||!active()||!quote||pendingId())return;
      if(!confirm('Confirmer le remboursement de '+money(quote.value.amount_cents,quote.value.currency)+' pour cette sélection ?'))return;
      local=Object.assign({},quote.data,{operation_id:crypto.randomUUID(),expected_amount_cents:quote.value.amount_cents,expected_currency:quote.value.currency,expected_refunded_cents:quote.value.refunded_cents});save(local);
      var id=local.operation_id;lock(true);status.textContent='Confirmation Stripe en cours…';
      api.call('refundOrderPartial',local).then(function(res){return result(res,id);}).catch(function(error){if(active()){status.textContent=error.message;retryBtn.hidden=false;resetBtn.hidden=false;confirmBtn.hidden=true;}}).finally(function(){if(active())lock(false);});
    });
    retryBtn.addEventListener('click',function(){
      if(busy||!active()||!pendingId())return;
      var id=pendingId();lock(true);status.textContent='Vérification de la même opération…';
      api.call(local?'refundOrderPartial':'resumeOrderRefund',local||{id:order.id,operation_id:id}).then(function(res){return result(res,id);}).catch(function(error){if(active())status.textContent=error.message;}).finally(function(){if(active())lock(false);});
    });
    resetBtn.addEventListener('click',function(){
      if(busy||!active())return;
      if(!confirm('Actualiser le journal avant de préparer une nouvelle sélection ? Une opération encore en attente restera bloquante.'))return;
      api.call('getOrderRefunds',{id:order.id}).then(function(res){if(!active())return;if(!res.info||res.info.pending_operation){status.textContent='Une opération reste à vérifier ; reprenez-la.';return;}local=null;save(null);return refresh();}).catch(function(error){if(active())status.textContent=error.message;});
    });
    refresh();
  }
  document.addEventListener('hn:admin-logout',function(){revision++;save(null);var panel=document.getElementById('partialRefundPanel');if(panel)panel.remove();});
  window.HN_ADMIN_REFUNDS={open:open};
})();
