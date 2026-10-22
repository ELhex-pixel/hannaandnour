/* Keep the public conditions aligned with validated live settings; no order mutation. */
(function(){
  'use strict';
  var HN=window.HN,conditions=window.HN_RETURN_CONDITIONS,section=document.getElementById('returnConditions');
  if(!HN||!conditions||!section)return;
  var policy={days:Number(section.getAttribute('data-policy-days')),withdrawal_payer:section.getAttribute('data-policy-payer')},revision=0;
  function render(){
    var c=conditions.copy(HN.lang());section.innerHTML=conditions.render(policy,HN.lang());
    document.querySelector('h1.page-header-title').textContent=c.title;
    var crumbs=document.querySelectorAll('.page-header-breadcrumb span');if(crumbs.length)crumbs[crumbs.length-1].textContent=c.title;
    document.title=c.title+' | '+HN.tr('brandName');
    document.querySelector('meta[name="description"]').content=c.description;
  }
  function refresh(force){
    var request=++revision;
    return HN.requireConfig(force).then(function(cfg){
      if(request!==revision)return;
      if(!conditions.validPolicy(cfg.return_policy))throw new Error();
      policy={days:cfg.return_policy.days,withdrawal_payer:cfg.return_policy.withdrawal_payer};render();
      document.getElementById('returnConditionsStatus').textContent='';
    }).catch(function(){if(request===revision)document.getElementById('returnConditionsStatus').textContent=conditions.copy(HN.lang()).unavailable;});
  }
  document.addEventListener('langchange',render);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh(true);});
  window.addEventListener('pageshow',function(event){if(event.persisted)refresh(true);});
  refresh(false);
})();
