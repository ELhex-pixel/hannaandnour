(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.HN_STOCK_PRICES=factory();
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function parse(raw){
    var text=String(raw==null?'':raw).trim();
    if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(text))return null;
    var parts=text.replace(',','.').split('.');var cents=Number(parts[0])*100+Number(((parts[1]||'')+'00').slice(0,2));
    return Number.isInteger(cents)&&cents>=0&&cents<=100000000?cents:null;
  }
  function item(line){
    var value={variant_id:line.variant_id,quantity:line.quantity};
    if(line.price_override){
      var cents=parse(line.price_text);if(cents===null)throw new Error('Indique un prix de vente positif ou nul, avec au maximum deux décimales.');
      if(typeof line.price_note!=='string'||line.price_note.length>300)throw new Error('La note de prix doit contenir au maximum 300 caractères.');
      value.unit_price_cents=cents;value.price_note=line.price_note.trim();
    }
    return value;
  }
  return {parse:parse,item:item};
});
