const { json } = require('../shared');
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const kinds=['zero_stock','archive_orders','archive_returns','archive_journal','purge_products','purge_visits','purge_messages','purge_drafts'];
const selective=['purge_products','purge_messages','purge_drafts'];
function problem(message,status,code){return Object.assign(new Error(message),{status,code,maintenance:true});}
const failures={maintenance_invalid:[400,'Choisissez une opération, un motif et la confirmation demandée.'],maintenance_target_unavailable:[409,'Un élément a changé ou possède un historique à conserver. Reprenez la sélection.'],maintenance_preview_changed:[409,'Les données ont changé depuis l’aperçu. Recalculez et confirmez le nouvel aperçu.'],maintenance_empty:[409,'Aucun élément ne correspond à cette opération.'],maintenance_operation_mismatch:[409,'Cet identifiant correspond à un autre contenu. Reprenez la tentative initiale.'],maintenance_draft_unverified:[409,'Un brouillon ne possède pas de confirmation d’expiration du paiement.'],product_delete_active:[409,'Un produit est encore en ligne.'],product_delete_stock:[409,'Un produit possède encore du stock.'],product_delete_history:[409,'Un produit possède un historique à conserver.']};
function idsFor(body) {
  if (!selective.includes(body.kind)) return null;
  if (!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>100||body.ids.some(id=>typeof id!=='string'||!ID.test(id))) throw problem('Sélectionnez de 1 à 100 éléments.',400);
  const ids=[...new Set(body.ids.map(id=>id.toLowerCase()))].sort();
  if(body.kind==='purge_drafts'&&ids.length>10)throw problem('Sélectionnez au maximum 10 brouillons pour vérifier les paiements.',400);
  return ids;
}
async function verifyDrafts(sb,ids,retrieve) {
  const {data,error}=await sb.from('orders').select('id,stripe_session_id,stripe_creation_started').in('id',ids);
  if(error||!data||data.length!==ids.length)throw problem('Brouillon introuvable ou modifié.',409,'maintenance_target_unavailable');
  const verified=[];
  await Promise.all(data.map(async order=>{
    if(!order.stripe_session_id){if(order.stripe_creation_started)throw problem('Un paiement incertain doit être rapproché avant suppression.',409,'maintenance_draft_unverified');return;}
    if(!retrieve){
      if(!process.env.STRIPE_SECRET_KEY)throw new Error('Paiement non vérifiable.');
      const Stripe=require('stripe');const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{timeout:5000,maxNetworkRetries:0});retrieve=id=>stripe.checkout.sessions.retrieve(id);
    }
    const session=await retrieve(order.stripe_session_id);
    if(session.id!==order.stripe_session_id||session.client_reference_id!==order.id||session.status!=='expired'||session.payment_status!=='unpaid'||session.payment_intent)throw problem('Le paiement de ce brouillon n’est pas définitivement expiré et sans paiement lié.',409,'maintenance_draft_unverified');
    verified.push(order.id);
  }));
  return verified;
}
async function adminMaintenance(sb,action,body) {
  try{
    if(action==='listMaintenanceHistory'){
      const {data,error}=await sb.from('admin_maintenance_operations').select('id,kind,reason,result,created_at').order('created_at',{ascending:false}).limit(20);
      if(error)throw error;return json(200,{operations:data||[]});
    }
    if(!kinds.includes(body.kind))return json(400,{error:'Opération inconnue.'});
    if(action==='listMaintenanceTargets'){
      if(!selective.includes(body.kind))return json(400,{error:'Cette opération ne nécessite pas de sélection.'});
      const page=Number.isInteger(body.page)&&body.page>=1&&body.page<=5000?body.page:1;
      const result=await sb.rpc('list_admin_maintenance_targets',{p_kind:body.kind,p_offset:(page-1)*20,p_limit:20});
      if(result.error||!result.data||!Array.isArray(result.data.targets)||!Number.isInteger(result.data.total))throw new Error('Liste non confirmée.');
      return json(200,{...result.data,page});
    }
    const ids=idsFor(body);let args,result;
    if(action==='quoteMaintenance'){
      if(body.kind==='purge_drafts')await verifyDrafts(sb,ids);
      result=await sb.rpc('quote_admin_maintenance',{p_kind:body.kind,p_ids:ids});
    }else if(action==='runMaintenance'){
      if(typeof body.operation_id!=='string'||!ID.test(body.operation_id)||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.trim().length>300||body.confirmation!==(body.kind==='zero_stock'?'ZERO':body.kind.startsWith('archive_')?'ARCHIVER':'SUPPRIMER')||!body.quote||body.quote.kind!==body.kind||!Number.isInteger(body.quote.count)||body.quote.count<1||!Number.isInteger(body.quote.units)||!/^\w{32}$/.test(body.quote.fingerprint||'')||!Number.isFinite(Date.parse(body.quote.cutoff)))return json(400,{error:'Vérifiez l’aperçu, le motif et le mot de confirmation.'});
      let verified=[];
      if(body.kind==='purge_drafts'){
        const previous=await sb.from('admin_maintenance_operations').select('id').eq('id',body.operation_id).maybeSingle();
        if(previous.error)throw previous.error;
        if(!previous.data)verified=await verifyDrafts(sb,ids);
      }
      args={p_id:body.operation_id,p_kind:body.kind,p_ids:ids,p_quote:body.quote,p_reason:body.reason.trim(),p_confirmation:body.confirmation,p_verified_drafts:verified};
      result=await sb.rpc('run_admin_maintenance',args);
    }else return json(400,{error:'Action inconnue.'});
    if(result.error){const failure=failures[result.error.message];return failure?json(failure[0],{error:failure[1],code:result.error.message}):json(503,{error:'Résultat non confirmé. Vérifiez ou reprenez la même opération.'});}
    if(!result.data||(action==='runMaintenance'&&(result.data.operation_id!==body.operation_id||result.data.kind!==body.kind||result.data.count!==body.quote.count)))throw new Error('Confirmation incomplète.');
    return json(200,{result:result.data});
  }catch(error){return error.maintenance?json(error.status,{error:error.message,code:error.code}):json(503,{error:'Maintenance indisponible. Une tentative incertaine doit être reprise avec le même identifiant.'});}
}
module.exports={adminMaintenance,verifyDrafts};
