const {json}=require('../shared');
const rules=require('../../../public/js/shipping-rules');
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
async function adminShippingRules(sb,action,body){
  let submitted;
  if(action==='saveShippingRules'){
    try{
      if(!uuid(body.operation_id)||(body.expected_revision!==null&&!uuid(body.expected_revision)))throw Error();
      submitted=rules.clean(body.rules);
    }catch{return json(400,{error:'Réglages invalides : renseignez un tarif strictement positif pour chaque mode coché et un seuil relais supérieur à zéro.',code:'shipping_rules_invalid'});}
  }
  try{
    const current=await sb.from('settings').select('value').eq('key','shipping_rules').maybeSingle();
    if(current.error)throw current.error;
    const stored=current.data?.value;
    if(stored&&!uuid(stored.revision))throw Error('Invalid revision');
    const legacy=await sb.from('settings').select('value').eq('key','shipping').maybeSingle();
    if(legacy.error)throw legacy.error;
    const effective=rules.resolve(stored,legacy.data?.value);
    if(action==='getShippingRules')return json(200,{rules:effective,revision:stored?.revision||null});
    if(action!=='saveShippingRules')return json(400,{error:'Action inconnue'});
    if(stored?.revision===body.operation_id){
      if(JSON.stringify(effective)!==JSON.stringify(submitted))return json(409,{error:'Cette tentative correspond à d’autres réglages.',code:'shipping_rules_conflict'});
      return json(200,{rules:effective,revision:stored.revision,already:true});
    }
    if((stored?.revision||null)!==body.expected_revision)return json(409,{error:'Les réglages ont changé. Actualisez avant de les modifier.',code:'shipping_rules_conflict'});
    const value={...submitted,revision:body.operation_id},row={key:'shipping_rules',value,updated_at:new Date().toISOString()};
    const result=stored
      ?await sb.from('settings').update({value,updated_at:row.updated_at}).eq('key','shipping_rules').eq('value->>revision',body.expected_revision).select('value').maybeSingle()
      :await sb.from('settings').insert(row).select('value').maybeSingle();
    if(result.error?.code==='23505'||(!result.error&&!result.data))return json(409,{error:'Les réglages ont changé. Actualisez avant de les modifier.',code:'shipping_rules_conflict'});
    if(result.error)throw result.error;
    if(result.data.value?.revision!==body.operation_id||JSON.stringify(rules.clean(result.data.value))!==JSON.stringify(submitted))throw Error('Unconfirmed save');
    return json(200,{rules:submitted,revision:body.operation_id});
  }catch{return json(503,{error:'Réglages de livraison indisponibles. Réessayez la même tentative.',code:'shipping_rules_unavailable'});}
}
module.exports={adminShippingRules};
