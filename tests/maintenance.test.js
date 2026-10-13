const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm');
const {adminMaintenance,verifyDrafts}=require('../netlify/functions/lib/admin-maintenance');
const quote={kind:'zero_stock',count:2,units:15,cutoff:'2026-10-13T12:00:00Z',fingerprint:'a'.repeat(32),samples:[]};
test('la maintenance valide sélection, motif et confirmation avant une unique RPC, et filtre les erreurs',async()=>{
  const id=randomUUID(),calls=[];const sb={rpc:async(name,args)=>{calls.push([name,args]);return{data:{operation_id:id,kind:'zero_stock',count:2,units:15}};}};
  const body={operation_id:id,kind:'zero_stock',quote,reason:'Action choisie',confirmation:'ZERO'};
  assert.equal((await adminMaintenance(sb,'runMaintenance',{...body,confirmation:'SUPPRIMER'})).statusCode,400);assert.equal(calls.length,0);
  assert.equal((await adminMaintenance(sb,'runMaintenance',body)).statusCode,200);assert.equal(calls[0][0],'run_admin_maintenance');assert.equal(calls[0][1].p_reason,'Action choisie');
  sb.rpc=async()=>({error:{message:'maintenance_preview_changed',details:'private SQL'}});const refusal=await adminMaintenance(sb,'runMaintenance',body);assert.equal(refusal.statusCode,409);assert.equal(JSON.parse(refusal.body).code,'maintenance_preview_changed');assert.doesNotMatch(refusal.body,/private/);
  sb.rpc=async()=>({error:{message:'secret SQL token'}});const failure=await adminMaintenance(sb,'runMaintenance',body);assert.equal(failure.statusCode,503);assert.doesNotMatch(failure.body,/secret|token/);
  assert.equal((await adminMaintenance(sb,'quoteMaintenance',{kind:'purge_messages',ids:[]})).statusCode,400);
  assert.equal((await adminMaintenance(sb,'quoteMaintenance',{kind:'purge_drafts',ids:Array.from({length:11},randomUUID)})).statusCode,400);
});
test('la vérification des brouillons accepte seulement une session expirée, impayée, sans paiement et liée à la bonne commande',async()=>{
  const id=randomUUID();const sb={from:()=>({select(){return this;},in:async()=>({data:[{id,stripe_session_id:'cs_local',stripe_creation_started:true}]})})};
  const session={id:'cs_local',client_reference_id:id,status:'expired',payment_status:'unpaid',payment_intent:null};
  assert.deepEqual(await verifyDrafts(sb,[id],async()=>session),[id]);
  for(const changes of [{status:'open'},{status:'complete'},{payment_status:'paid'},{payment_status:'no_payment_required'},{payment_intent:'pi_paid'},{client_reference_id:randomUUID()}])await assert.rejects(verifyDrafts(sb,[id],async()=>({...session,...changes})),/définitivement expiré/);
  sb.from=()=>({select(){return this;},in:async()=>({data:[{id,stripe_session_id:null,stripe_creation_started:true}]})});await assert.rejects(verifyDrafts(sb,[id]),/incertain/);
});
test('reprendre une suppression de brouillon déjà enregistrée ne vérifie pas un ordre désormais supprimé',async()=>{
  const id=randomUUID(),target=randomUUID();const sb={from:table=>{assert.equal(table,'admin_maintenance_operations');return{select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{id}})};},rpc:async(name,args)=>{assert.equal(name,'run_admin_maintenance');assert.deepEqual(args.p_verified_drafts,[]);return{data:{operation_id:id,kind:'purge_drafts',count:1}};}};
  const response=await adminMaintenance(sb,'runMaintenance',{operation_id:id,kind:'purge_drafts',ids:[target],quote:{...quote,kind:'purge_drafts',count:1},reason:'Brouillon expiré',confirmation:'SUPPRIMER'});assert.equal(response.statusCode,200);
});
test('toutes les opérations de maintenance exigent la session admin et la limite avant le module',async()=>{
  for(const action of ['listMaintenanceTargets','quoteMaintenance','runMaintenance','listMaintenanceHistory'])for(const allowed of [false,true]){
    const exports={},calls=[];const shared={json:(statusCode,data)=>({statusCode,body:JSON.stringify(data)}),isConfigured:()=>true,getSupabase:()=>({}),readBody:()=>({action}),requireAdmin:async()=>({ok:allowed}),rateLimit:async()=>{calls.push('quota');return null;}};
    vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,process:{env:{}},Buffer,require:name=>name==='./shared'?shared:name==='./lib/admin-maintenance'?{adminMaintenance:async()=>{calls.push('module');return shared.json(200,{});}}:name==='crypto'?require('node:crypto'):name==='./lib/product-assistant'?{categories:require('../public/js/categories').codes}:name==='../../public/js/product-media'?require('../public/js/product-media'):name==='../../public/js/product-sizes'?require('../public/js/product-sizes'):class Stripe{}});
    assert.equal((await exports.handler({httpMethod:'POST'})).statusCode,allowed?200:401);assert.deepEqual(calls,allowed?['quota','module']:[]);
  }
});
