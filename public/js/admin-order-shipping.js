(function(){
  'use strict';
  var api=window.HN_ADMIN,rules=window.HN_SHIPPING_PARCEL,dialog=document.getElementById('orderShippingDialog');if(!api||!rules||!dialog)return;
  var el=function(id){return document.getElementById(id);},revision=0,orderId='',eligible=false,busy=false,pending=null,operation=null,quotes=[],selected=-1,opener=null;
  var key='hn-admin-shipping-operation',ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  function persist(value){var raw=localStorage.getItem(key),stored=raw?JSON.parse(raw):null;if(stored&&stored.operation_id!==value.operation_id)throw new Error('Une autre demande est conservée.');localStorage.setItem(key,JSON.stringify(value));}
  function clearStored(id){var raw=localStorage.getItem(key),stored=raw?JSON.parse(raw):null;if(!stored||stored.operation_id===id)localStorage.removeItem(key);}
  function current(version,owner){return dialog.open&&version===revision&&owner===api.token();}
  function call(action,body){return new Promise(function(resolve,reject){var timer=setTimeout(function(){reject(new Error('Réponse non confirmée dans le délai prévu.'));},30000);api.call(action,body).then(resolve,reject).finally(function(){clearTimeout(timer);});});}
  function money(cents){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(cents/100);}
  function readPending(){try{var raw=localStorage.getItem(key);pending=raw?JSON.parse(raw):null;if(pending&&(!ID.test(pending.operation_id||'')||!ID.test(pending.order_id||'')||!pending.quote||typeof pending.signature!=='string'||pending.confirmation!=='CREER_ETIQUETTE'))throw new Error();return true;}catch(error){el('shippingStatus').textContent='Demande conservée illisible. Vérifiez les étiquettes dans Sendcloud avant de recommencer.';return false;}}
  function controls(){
    var ready=operation&&operation.state==='ready',locked=busy||!!pending||!!ready;
    el('shippingParcelFields').querySelectorAll('input,select').forEach(function(node){node.disabled=locked;});
    el('shippingQuote').disabled=locked||!eligible;
    el('shippingOptionsList').querySelectorAll('input').forEach(function(node){node.disabled=locked;});
    el('shippingCreate').disabled=busy||!!ready||(!pending&&selected<0);
    el('shippingCreate').textContent=pending?'Vérifier / réessayer la même demande':'Créer l’étiquette choisie';
    el('shippingDownload').disabled=busy||!ready;el('shippingPaper').disabled=busy||!ready;
  }
  function showOperation(value){
    if(pending&&value&&pending.operation_id!==value.id){el('shippingStatus').textContent='Une autre demande est enregistrée pour cette commande. Reprenez d’abord la demande locale conservée.';controls();return;}
    if(pending&&value&&['ready','failed'].includes(value.state)){try{clearStored(pending.operation_id);pending=null;}catch(error){el('shippingStatus').textContent='Étiquette confirmée, mais la demande locale reste à reprendre.';}}
    operation=value;
    if(value&&value.state==='pending'){
      pending=Object.assign({operation_id:value.id,order_id:value.order_id},value.request);
      var saved=true;try{persist(pending);}catch(error){saved=false;}
      el('shippingStatus').textContent=saved?'Création à confirmer. Reprenez la même demande, sans créer une deuxième étiquette.':'Création à confirmer dans le journal serveur. La conservation locale est indisponible ; reprenez la même demande.';
    }
    if(value&&value.state==='ready')el('shippingReceipt').textContent='Étiquette créée. Suivi : '+value.result.tracking_number+(value.result.order_attention?'\nLa commande a changé pendant la création. Contrôlez son état avant expédition.':'\nLe colis n’est pas marqué expédié par la création de l’étiquette.');
    if(value&&value.state==='failed')el('shippingStatus').textContent='Échec d’annonce confirmé par le transporteur. Recalculez les services avant une nouvelle demande.';
    controls();
  }
  function clearQuotes(){if(pending||busy)return;quotes=[];selected=-1;el('shippingOptionsList').textContent='';el('shippingOptions').hidden=true;controls();}
  function open(id,trigger){
    if(!api.token()||!ID.test(id))return;
    opener=trigger||document.activeElement;orderId=id;revision++;eligible=false;busy=true;operation=null;quotes=[];selected=-1;
    if(!dialog.open)dialog.showModal();
    el('orderShippingTitle').textContent='Étiquette Mondial Relay';el('shippingReceipt').textContent='';el('shippingPoint').textContent='';el('shippingOptionsList').textContent='';el('shippingOptions').hidden=true;
    ['shippingSender','shippingPackaging','shippingWeight','shippingLength','shippingWidth','shippingHeight'].forEach(function(name){el(name).value='';});
    if(!readPending()){controls();return;}
    if(pending)orderId=pending.order_id;
    el('shippingStatus').textContent='Lecture de la commande et de ses étiquettes…';controls();var version=revision,owner=api.token();
    call('getOrderShipping',{order_id:orderId}).then(function(data){
      if(!current(version,owner))return;eligible=data.eligible===true;
      el('orderShippingTitle').textContent='Étiquette — '+data.order_number;
      el('shippingPoint').textContent=data.point?data.point.name+' — '+Object.values(data.point.address).filter(Boolean).join(' '):'';
      var select=el('shippingSender');select.replaceChildren();var empty=document.createElement('option');empty.value='';empty.textContent='Choisir l’expéditeur';select.appendChild(empty);
      (data.senders||[]).forEach(function(sender){var option=document.createElement('option');option.value=String(sender.id);option.textContent=[sender.name,sender.house_number,sender.address_line_1,sender.postal_code,sender.city].filter(Boolean).join(' ');select.appendChild(option);});
      el('shippingStatus').textContent=pending?'Une demande reste à confirmer. Réessayez avec son identifiant conservé.':eligible?'Renseignez les mesures du colis fermé, puis consultez les services.':'Commande non disponible : vérifiez le paiement, le relais, le téléphone et la préparation du colis.';
      if(data.incomplete)el('shippingStatus').textContent+=' La liste des expéditeurs est partielle.';
      if(data.operation)showOperation(data.operation);
    }).catch(function(error){if(current(version,owner))el('shippingStatus').textContent=error.message;}).finally(function(){if(current(version,owner)){busy=false;controls();}});
  }
  el('shippingParcelFields').querySelectorAll('input,select').forEach(function(node){node.addEventListener('input',clearQuotes);node.addEventListener('change',clearQuotes);});
  el('shippingQuote').addEventListener('click',function(){
    if(busy||pending||!eligible)return;var parcel,sender=Number(el('shippingSender').value);
    try{parcel=rules.parse({packaging:el('shippingPackaging').value,weight:el('shippingWeight').value,length:el('shippingLength').value,width:el('shippingWidth').value,height:el('shippingHeight').value});if(!Number.isSafeInteger(sender)||sender<1)throw new Error('Choisissez l’expéditeur.');}catch(error){el('shippingStatus').textContent=error.message;return;}
    clearQuotes();busy=true;controls();var version=revision,owner=api.token();el('shippingStatus').textContent='Recherche des services et estimations Sendcloud…';
    call('quoteOrderShipping',{order_id:orderId,sender_id:sender,parcel:parcel}).then(function(data){
      if(!current(version,owner))return;if(!Array.isArray(data.options))throw new Error('Services non confirmés.');quotes=data.options;
      quotes.forEach(function(value,index){var label=document.createElement('label'),radio=document.createElement('input'),copy=document.createElement('span');label.className='shipping-option';radio.type='radio';radio.name='shippingOption';radio.value=String(index);copy.textContent=value.quote.option.name+' — '+money(value.quote.option.price_cents)+' (estimation Sendcloud)';label.appendChild(radio);label.appendChild(copy);el('shippingOptionsList').appendChild(label);radio.addEventListener('change',function(){if(!busy&&!pending&&radio.checked){selected=index;controls();}});});
      el('shippingOptions').hidden=!quotes.length;el('shippingStatus').textContent=quotes.length?'Choisissez le service avant de confirmer la création.':'Aucun service avec tarif confirmé pour ce colis et ce relais.';
    }).catch(function(error){if(current(version,owner))el('shippingStatus').textContent=error.message;}).finally(function(){if(current(version,owner)){busy=false;controls();}});
  });
  el('shippingCreate').addEventListener('click',function(){
    if(busy||!api.token())return;
    if(!pending){
      if(!readPending())return;
      if(pending){open(pending.order_id,opener);return;}
      var choice=quotes[selected];if(!choice)return;
      if(!confirm('Créer cette étiquette Mondial Relay ?\n\n'+choice.quote.option.name+'\nEstimation Sendcloud : '+money(choice.quote.option.price_cents)+'\nPoids du colis : '+(choice.quote.parcel.weight_g/1000)+' kg'))return;
      try{pending={operation_id:window.crypto.randomUUID(),order_id:orderId,quote:choice.quote,signature:choice.signature,confirmation:'CREER_ETIQUETTE'};persist(pending);}catch(error){pending=null;el('shippingStatus').textContent='Impossible de conserver la demande. Aucune création envoyée.';return;}
    }
    var request=pending,version=revision,owner=api.token();busy=true;controls();el('shippingStatus').textContent='Vérification et création de l’étiquette…';
    call('createOrderShipping',request).then(function(data){
      if(!current(version,owner))return;if(!data.operation||data.operation.id!==request.operation_id||!['ready','failed'].includes(data.operation.state))throw new Error('Résultat non confirmé.');
      clearStored(request.operation_id);pending=null;selected=-1;showOperation(data.operation);
    }).catch(function(error){
      if(!current(version,owner))return;
      if(['shipping_invalid','shipping_quote_changed','shipping_order_unavailable','shipping_order_busy'].includes(error.code)){try{clearStored(request.operation_id);pending=null;selected=-1;quotes=[];el('shippingOptionsList').textContent='';el('shippingOptions').hidden=true;}catch(storageError){}}
      el('shippingStatus').textContent=error.message+(pending?' Réessayez la même demande ; ses identifiants sont conservés.':' Actualisez la commande puis recalculez les services.');
    }).finally(function(){if(current(version,owner)){busy=false;controls();}});
  });
  el('shippingDownload').addEventListener('click',function(){
    if(busy||!operation||operation.state!=='ready')return;var version=revision,owner=api.token();busy=true;controls();
    call('downloadOrderShippingLabel',{order_id:orderId,paper_size:el('shippingPaper').value}).then(function(data){
      if(!current(version,owner))return;var binary=atob(data.pdf_base64),array=new Uint8Array(binary.length);for(var i=0;i<binary.length;i++)array[i]=binary.charCodeAt(i);var url=URL.createObjectURL(new Blob([array],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=data.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},60000);
    }).catch(function(error){if(current(version,owner))el('shippingStatus').textContent=error.message;}).finally(function(){if(current(version,owner)){busy=false;controls();}});
  });
  function cleanup(){revision++;busy=false;orderId='';quotes=[];operation=null;pending=null;eligible=false;el('orderShippingTitle').textContent='Étiquette Mondial Relay';el('shippingPoint').textContent='';el('shippingReceipt').textContent='';el('shippingOptionsList').textContent='';el('shippingSender').replaceChildren();el('shippingStatus').textContent='';['shippingPackaging','shippingWeight','shippingLength','shippingWidth','shippingHeight'].forEach(function(id){el(id).value='';});if(opener&&document.contains(opener)&&opener.getClientRects().length)opener.focus();opener=null;}
  function close(){if(dialog.open)dialog.close();cleanup();}
  el('shippingClose').addEventListener('click',close);
  dialog.addEventListener('close',function(){if(!dialog.open)cleanup();});
  dialog.addEventListener('cancel',function(event){event.preventDefault();close();});
  document.addEventListener('click',function(event){var button=event.target.closest('[data-order-shipping]');if(button)open(button.getAttribute('data-order-shipping'),button);});
  ['hn:admin-logout','hn:order-view'].forEach(function(name){document.addEventListener(name,close);});
  document.getElementById('closeOrderBtn').addEventListener('click',close);
})();
