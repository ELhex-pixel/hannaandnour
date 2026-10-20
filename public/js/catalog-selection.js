(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HN_CATALOG_SELECTION=factory();})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function isNew(product){return /^(new|nouveau|nouveaute|nouveautes|nouveauté|nouveautés)$/i.test(String(product.badge||'').trim());}
  function isSale(product){return Number.isSafeInteger(product.price_cents)&&product.price_cents>0&&Number.isSafeInteger(product.compare_at_price_cents)&&product.compare_at_price_cents>product.price_cents;}
  function matches(product,selection){return selection==='new'?isNew(product):selection==='sale'?isSale(product):true;}
  return{matches:matches,isNew:isNew,isSale:isSale};
});
