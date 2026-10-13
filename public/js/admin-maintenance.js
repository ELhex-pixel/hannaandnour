(function () {
  'use strict';
  var api=window.HN_ADMIN,panel=document.getElementById('panel-maintenance'); if(!panel||!api)return;
  var KEY='hn-admin-maintenance-operation',kind='',quote=null,pending=null,busy=false,revision=0,page=1,total=0,selection=Object.create(null);
  var info={
    zero_stock:['Tout le stock disponible à zéro','Toutes les variantes avec du disponible dans le catalogue actuel, y compris les produits hors ligne. Les réservations de commandes, identités et historiques sont conservés. Des annulations ou retours reçus ultérieurement peuvent rendre des unités de nouveau disponibles.','ZERO'],
    archive_orders:['Ranger les commandes terminées','Commandes livrées, annulées ou remboursées sans réservation, retour ouvert ni remboursement en cours. Elles restent consultables dans Archives conservées.','ARCHIVER'],
    archive_returns:['Ranger les retours traités','Les demandes reçues ou refusées sont retirées de la vue courante et restent dans les archives.','ARCHIVER'],
    archive_journal:['Vider le journal courant du stock','Les ajustements sont rangés dans les archives. Aucune quantité de stock ne change.','ARCHIVER'],
    purge_products:['Supprimer des produits inutilisés','Seulement les fiches hors ligne, sans stock et sans lien historique. Les fichiers photo ne sont pas effacés.','SUPPRIMER'],
    purge_visits:['Effacer les statistiques de visite','Les événements présents dans l’aperçu seront supprimés. Les visites arrivées après l’aperçu, commandes, ventes et coûts d’achat restent conservés.','SUPPRIMER'],
    purge_messages:['Supprimer des messages de contact','Sélectionnez les messages à effacer définitivement.','SUPPRIMER'],
    purge_drafts:['Supprimer des brouillons expirés','Sélectionnez au maximum 10 commandes impayées de plus de 72 heures, sans réservation ni historique financier. Les sessions Stripe doivent être expirées, impayées et sans paiement lié.','SUPPRIMER']
  };
  function el(id){return document.getElementById(id);}
  function node(tag,text,parent){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.appendChild(n);return n;}
  function selective(){return ['purge_products','purge_messages','purge_drafts'].indexOf(kind)>=0;}
  function say(text){el('maintenanceStatus').textContent=text||'';}
  function read(){try{var p=JSON.parse(localStorage.getItem(KEY)||'null');return p&&p.body&&info[p.body.kind]&&/^[0-9a-f-]{36}$/i.test(p.body.operation_id)?p:null;}catch(error){return null;}}
  function save(p){if(p)localStorage.setItem(KEY,JSON.stringify(p));else localStorage.removeItem(KEY);pending=p;}
  function controls(){
    panel.querySelectorAll('button,input').forEach(function(n){n.disabled=busy||!!pending;});
    el('maintenanceRetry').disabled=busy;
    el('maintenancePending').hidden=!pending;
    el('maintenanceSelectionCount').textContent=Object.keys(selection).length+' élément(s) sélectionné(s), y compris hors page.';
    el('maintenancePrevious').disabled=busy||!!pending||page<=1;
    el('maintenanceNext').disabled=busy||!!pending||page*20>=total;
    el('maintenancePreview').disabled=busy||!!pending||(selective()&&!Object.keys(selection).length);
    el('maintenanceRun').disabled=busy||!!pending||!quote||!quote.count;
  }
  function current(r,owner){return r===revision&&owner===api.token();}
  async function call(action,body){
    var owner=api.token(),controller=new AbortController(),timer=setTimeout(function(){controller.abort();},20000);
    try{
      var response=await fetch(((window.HN_CONFIG&&window.HN_CONFIG.API_BASE)||'/.netlify/functions')+'/admin',{method:'POST',signal:controller.signal,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+owner},body:JSON.stringify(Object.assign({},body||{},{action:action}))});
      var data=await response.json();
      if(owner!==api.token())throw Object.assign(new Error('Ancienne session ignorée.'),{stale:true});
      if(!response.ok||data.error)throw Object.assign(new Error(data.error||'Réponse non confirmée.'),{code:data.code,status:response.status});
      return data;
    }finally{clearTimeout(timer);}
  }
  async function task(fn){if(busy)return;var r=revision,owner=api.token();busy=true;controls();try{await fn(r,owner);}catch(error){if(current(r,owner)&&!error.stale)say(error.message||'Résultat non confirmé. Reprenez la même opération.');}finally{if(current(r,owner)){busy=false;controls();}}}
  function showAction(){el('maintenanceEditor').hidden=false;el('maintenanceActionTitle').textContent=info[kind][0];el('maintenanceDescription').textContent=info[kind][1];el('maintenanceSelection').hidden=!selective();el('maintenanceQuote').hidden=!quote;el('maintenanceConfirmationLabel').textContent='Saisissez '+info[kind][2]+' pour confirmer';controls();}
  async function list(r,owner){
    var res=await call('listMaintenanceTargets',{kind:kind,page:page});if(!current(r,owner))return;
    if(!Array.isArray(res.targets)||!Number.isInteger(res.total))throw new Error('Sélection non confirmée.');
    total=res.total;el('maintenanceTargets').textContent='';
    res.targets.forEach(function(target){var label=node('label',undefined,el('maintenanceTargets')),input=node('input',undefined,label);input.type='checkbox';input.checked=!!selection[target.id];input.setAttribute('data-maintenance-id',target.id);node('span',target.label,label);});
    if(!res.targets.length)node('p','Aucun élément éligible dans cette liste.',el('maintenanceTargets'));
    el('maintenancePage').textContent='Page '+page+' / '+Math.max(1,Math.ceil(total/20));controls();
  }
  function choose(next){if(busy||pending)return;revision++;kind=next;quote=null;page=1;selection=Object.create(null);el('maintenanceReason').value='';el('maintenanceConfirmation').value='';say('');showAction();el('maintenanceEditor').scrollIntoView({block:'start'});if(selective())task(list);}
  panel.querySelectorAll('[data-maintenance-kind]').forEach(function(button){button.addEventListener('click',function(){choose(button.getAttribute('data-maintenance-kind'));});});
  el('maintenanceTargets').addEventListener('change',function(event){var input=event.target.closest('[data-maintenance-id]');if(!input||busy||pending)return;var id=input.getAttribute('data-maintenance-id');if(input.checked)selection[id]=true;else delete selection[id];quote=null;el('maintenanceQuote').hidden=true;controls();});
  el('maintenancePrevious').addEventListener('click',function(){if(!busy&&!pending&&page>1){page--;task(list);}});
  el('maintenanceNext').addEventListener('click',function(){if(!busy&&!pending&&page*20<total){page++;task(list);}});
  function ids(){return Object.keys(selection).sort();}
  function showQuote(){
    el('maintenanceQuote').hidden=false;
    el('maintenanceSummary').textContent=quote.count+' élément(s) concernés'+(kind==='zero_stock'?' · '+quote.units+' unité(s) disponibles seront retirées.':'.')+'\n'+info[kind][1];
    el('maintenanceSamples').textContent='';(quote.samples||[]).forEach(function(row){node('li',row.label+(kind==='zero_stock'?' · '+row.quantity+' → 0':''),el('maintenanceSamples'));});
    if(quote.count>20)node('li','Aperçu : les 20 premiers éléments sur '+quote.count+'.',el('maintenanceSamples'));
  }
  el('maintenancePreview').addEventListener('click',function(){if(!kind||pending)return;task(async function(r,owner){var res=await call('quoteMaintenance',{kind:kind,ids:selective()?ids():undefined});if(!current(r,owner))return;if(!res.result||res.result.kind!==kind||!Number.isInteger(res.result.count))throw new Error('Aperçu incomplet.');quote=res.result;showQuote();say(quote.count?'Aperçu prêt. Saisissez le motif et la confirmation.':'Aucun élément concerné.');});});
  async function execute(r,owner){
    var attempt=pending;
    try{
      var res=await call('runMaintenance',attempt.body);if(!current(r,owner))return;
      if(!res.result||res.result.operation_id!==attempt.body.operation_id||res.result.kind!==attempt.body.kind||res.result.count!==attempt.body.quote.count)throw new Error('Confirmation incomplète. Reprenez la même opération.');
      save(null);quote=null;el('maintenanceQuote').hidden=true;showAction();say('Opération confirmée : '+res.result.count+' élément(s). Référence : '+res.result.operation_id+'\n'+(kind.indexOf('archive_')===0?'Les archives sont accessibles ci-dessous.':'Le résultat est conservé dans l’historique de gestion.'));selection=Object.create(null);if(selective())await list(r,owner);
    }catch(error){if(current(r,owner)&&['maintenance_preview_changed','maintenance_target_unavailable','maintenance_empty','maintenance_draft_unverified','product_delete_active','product_delete_stock','product_delete_history'].indexOf(error.code)>=0){save(null);quote=null;el('maintenanceQuote').hidden=true;}throw error;}
  }
  el('maintenanceForm').addEventListener('submit',function(event){event.preventDefault();if(busy||pending||!quote||!quote.count)return;var reason=el('maintenanceReason').value.trim(),confirmation=el('maintenanceConfirmation').value.trim();if(reason.length<3||reason.length>300||confirmation!==info[kind][2]){say('Indiquez un motif et saisissez exactement '+info[kind][2]+'.');return;}if(!confirm(info[kind][0]+'\n'+quote.count+' élément(s)'+(kind==='zero_stock'?' · '+quote.units+' unité(s)':'')+'\nMotif : '+reason+'\nConfirmer cette opération ?'))return;task(async function(r,owner){save({body:{operation_id:crypto.randomUUID(),kind:kind,ids:selective()?ids():undefined,quote:quote,reason:reason,confirmation:confirmation}});controls();await execute(r,owner);});});
  el('maintenanceRetry').addEventListener('click',function(){if(pending)task(execute);});
  el('maintenanceHistoryRefresh').addEventListener('click',function(){task(async function(r,owner){var res=await call('listMaintenanceHistory');if(!current(r,owner))return;el('maintenanceHistory').textContent='';(res.operations||[]).forEach(function(operation){var box=node('article',undefined,el('maintenanceHistory'));node('strong',info[operation.kind]?info[operation.kind][0]:operation.kind,box);node('p',(operation.result.count||0)+' élément(s) · '+new Date(operation.created_at).toLocaleString('fr-FR')+' · '+operation.reason,box);node('small','Référence : '+operation.id,box);});});});
  var scope=el('returnAdminScope');if(scope&&!scope.querySelector('option[value="archived"]')){var option=node('option','Historique archivé',scope);option.value='archived';}
  panel.querySelectorAll('[data-maintenance-archive]').forEach(function(button){button.addEventListener('click',function(){if(busy||pending)return;var target=button.getAttribute('data-maintenance-archive');document.querySelector('.admin-tab[data-tab="'+target+'"]').click();var input=el(target==='orders'?'filterOrderArchive':target==='returns'?'returnAdminScope':'inventoryHistoryView');input.value='archived';if(target==='inventory'){var details=input.closest('details');if(details)details.open=true;input.scrollIntoView({block:'start'});}input.dispatchEvent(new Event('change'));});});
  function open(){if(!api.token()||busy)return;pending=read();if(pending){kind=pending.body.kind;quote=pending.body.quote;showAction();showQuote();say('Une opération reste à vérifier. Reprenez la même tentative.');}else controls();}
  document.querySelector('.admin-tab[data-tab="maintenance"]').addEventListener('click',open);
  document.addEventListener('hn:admin-logout',function(){revision++;busy=false;pending=null;quote=null;kind='';selection=Object.create(null);['maintenanceTargets','maintenanceHistory','maintenanceSamples','maintenanceSummary','maintenanceStatus'].forEach(function(id){el(id).textContent='';});el('maintenanceReason').value='';el('maintenanceConfirmation').value='';el('maintenanceEditor').hidden=true;controls();});
  window.addEventListener('storage',function(event){if(event.key===KEY&&api.token()&&!busy)open();});
})();
