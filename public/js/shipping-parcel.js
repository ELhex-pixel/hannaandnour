(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HN_SHIPPING_PARCEL=factory();})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  function scaled(raw,decimals,max){
    var value=String(raw==null?'':raw).trim().replace(',','.');
    if(!new RegExp('^\\d+(?:\\.\\d{1,'+decimals+'})?$').test(value))throw new Error('Mesure invalide.');
    var parts=value.split('.'),result=Number(parts[0])*Math.pow(10,decimals)+Number((parts[1]||'').padEnd(decimals,'0'));
    if(!Number.isSafeInteger(result)||result<1||result>max)throw new Error('Mesure hors limites.');return result;
  }
  function valid(p){return !!p&&['pouch','box'].indexOf(p.packaging)>=0&&Number.isSafeInteger(p.weight_g)&&p.weight_g>0&&p.weight_g<=100000&&['length_mm','width_mm','height_mm'].every(function(k){return Number.isSafeInteger(p[k])&&p[k]>0&&p[k]<=3000;});}
  function parse(values){var p={packaging:values.packaging,weight_g:scaled(values.weight,3,100000),length_mm:scaled(values.length,1,3000),width_mm:scaled(values.width,1,3000),height_mm:scaled(values.height,1,3000)};if(!valid(p))throw new Error('Choisissez l’emballage et les mesures réelles du colis.');return p;}
  function provider(p){if(!valid(p))throw new Error('Colis invalide.');return{weight:{value:(p.weight_g/1000).toFixed(3),unit:'kg'},dimensions:{length:(p.length_mm/10).toFixed(1),width:(p.width_mm/10).toFixed(1),height:(p.height_mm/10).toFixed(1),unit:'cm'},package_type:'package'};}
  return{valid:valid,parse:parse,provider:provider};
});
