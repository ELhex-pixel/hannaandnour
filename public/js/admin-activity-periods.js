(function () {
  'use strict';
  var api=window.HN_ADMIN,dialog=document.getElementById('activityPeriodDialog');if(!api||!dialog)return;
  var scope='current',head=null,pending=null,busy=false,revision=0,contextRevision=0;
  var key='hn-admin-activity-period-operation',el=function(id){return document.getElementById(id);};
  var ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  function call(action,body){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error('Réponse non confirmée dans le délai prévu.'));},20000);api.call(action,body).then(resolve,reject).finally(function(){clearTimeout(timer);});});}
  function change(){document.dispatchEvent(new CustomEvent('hn:activity-period'));}
  function valid(value){return value&&ID.test(value.operation_id||'')&&(value.previous_id===null||ID.test(value.previous_id||''))&&typeof value.reason==='string'&&value.reason.length>=3&&value.reason.length<=300&&value.confirmation==='NOUVELLE_PERIODE';}
  function read(){try{var stored=localStorage.getItem(key);pending=stored?JSON.parse(stored):null;if(pending&&!valid(pending))throw new Error();return true;}catch(error){el('activityPeriodStatus').textContent='Opération conservée illisible. Vérifiez l’historique avant de recommencer.';return false;}}
  function label(){
    var date=head?new Date(head.started_at).toLocaleString('fr-FR'):'';
    var text=scope==='all'?'Toutes les périodes, historique inclus.':scope==='history'?(head?'Historique antérieur au '+date+'.':'Aucune période antérieure enregistrée.'):(head?'Période actuelle depuis le '+date+'.':'Période actuelle : depuis le début.');
    document.querySelectorAll('[data-activity-caption]').forEach(function(node){node.textContent=text;});
    document.querySelectorAll('[data-activity-scope]').forEach(function(node){node.value=scope;});
  }
  function context(){
    var request=contextRevision,owner=api.token(),selected=scope;
    return call('getActivityPeriod').then(function(data){
      if(request!==contextRevision||owner!==api.token())throw Object.assign(new Error('Lecture remplacée.'),{stale:true});
      if(!data||!Object.prototype.hasOwnProperty.call(data,'period')||(data.period&&(!ID.test(data.period.id||'')||!Number.isFinite(Date.parse(data.period.started_at)))))throw new Error('Période indisponible.');
      head=data.period;label();return{reporting_scope:selected,expected_reporting_period:head?head.id:'initial'};
    });
  }
  function controls(){
    el('activityPeriodReason').disabled=busy||!!pending;
    el('activityPeriodConfirm').disabled=busy;
    el('activityPeriodConfirm').textContent=pending?'Vérifier / réessayer la même période':'Confirmer la nouvelle période';
    document.querySelectorAll('[data-start-activity-period]').forEach(function(button){button.disabled=busy;});
  }
  function open(){
    var request=++revision,owner=api.token();if(!owner)return;
    if(!dialog.open)dialog.showModal();el('activityPeriodStatus').textContent='Lecture de la période actuelle…';el('activityPeriodConfirm').disabled=true;
    if(!read()){el('activityPeriodConfirm').disabled=true;return;}
    if(pending){el('activityPeriodReason').value=pending.reason;el('activityPeriodStatus').textContent='Une demande reste à confirmer. Reprenez exactement la même opération.';controls();return;}
    el('activityPeriodReason').value='';
    context().then(function(){if(request!==revision||owner!==api.token())return;el('activityPeriodStatus').textContent='La nouvelle date sera fixée par le serveur à la confirmation.';controls();}).catch(function(){if(request===revision&&owner===api.token()){el('activityPeriodStatus').textContent='Période non disponible. Fermez puis réessayez.';el('activityPeriodConfirm').disabled=true;}});
  }
  function save(){
    if(busy||!api.token())return;
    if(!read())return;
    if(!pending){
      var reason=el('activityPeriodReason').value.trim();if(reason.length<3||reason.length>300){el('activityPeriodStatus').textContent='Indiquez un motif de 3 à 300 caractères.';return;}
      try{pending={operation_id:window.crypto.randomUUID(),previous_id:head?head.id:null,reason:reason,confirmation:'NOUVELLE_PERIODE'};localStorage.setItem(key,JSON.stringify(pending));}
      catch(error){pending=null;el('activityPeriodStatus').textContent='Impossible de conserver la demande. Aucune opération envoyée.';return;}
    }
    var request=++revision,owner=api.token(),operation=pending.operation_id;busy=true;controls();el('activityPeriodStatus').textContent='Enregistrement de la nouvelle période…';
    call('startActivityPeriod',pending).then(function(data){
      if(request!==revision||owner!==api.token())return;
      if(!data.result||data.result.operation_id!==operation||!Number.isFinite(Date.parse(data.result.started_at)))throw new Error('Réponse incomplète.');
      localStorage.removeItem(key);pending=null;contextRevision++;scope='current';head={id:operation,started_at:data.result.started_at};label();change();
      el('activityPeriodStatus').textContent=(data.result.already?'Période déjà enregistrée. ':'Nouvelle période démarrée. ')+'Les anciennes données restent disponibles dans Historique.';
    }).catch(function(error){
      if(request!==revision||owner!==api.token())return;
      if(['activity_period_invalid','activity_period_changed'].indexOf(error.code)>=0){try{localStorage.removeItem(key);pending=null;}catch(storageError){}}
      el('activityPeriodStatus').textContent=(error.message||'Résultat non confirmé.')+(pending?' Réessayez la même opération.':' Fermez et actualisez avant une nouvelle confirmation.');
      if(!pending){head=null;el('activityPeriodConfirm').disabled=true;}
    }).finally(function(){if(request===revision&&owner===api.token()){busy=false;controls();if(!pending&&head===null)el('activityPeriodConfirm').disabled=true;}});
  }
  document.querySelectorAll('[data-start-activity-period]').forEach(function(button){button.addEventListener('click',open);});
  document.querySelectorAll('[data-activity-scope]').forEach(function(select){select.addEventListener('change',function(){scope=this.value;contextRevision++;label();change();});});
  el('activityPeriodConfirm').addEventListener('click',save);
  el('activityPeriodClose').addEventListener('click',function(){dialog.close();});
  dialog.addEventListener('close',function(){revision++;busy=false;controls();});
  window.addEventListener('storage',function(event){if(event.key===key&&event.newValue===null){contextRevision++;change();}});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&api.token()){contextRevision++;change();}});
  document.addEventListener('hn:admin-logout',function(){revision++;contextRevision++;busy=false;pending=null;head=null;scope='current';if(dialog.open)dialog.close();el('activityPeriodReason').value='';el('activityPeriodStatus').textContent='';document.querySelectorAll('[data-activity-caption]').forEach(function(node){node.textContent='';});});
  window.HN_ACTIVITY_PERIOD={context:context,scope:function(){return scope;}};
})();
