const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const json=(statusCode,body)=>({statusCode,body:JSON.stringify(body)});
function fixture(options={}){
  const id=randomUUID();
  const order={id,status:'pending',payment_flow:'authorize_capture',total_cents:1000,currency:'eur',stripe_session_id:'cs_local',inventory_reserved:false,...options.order};
  const session={id:'cs_local',client_reference_id:id,metadata:{order_id:id,lang:'fr'},mode:'payment',amount_total:order.total_cents,currency:order.currency,status:'complete',payment_status:'unpaid',payment_intent:'pi_local',...options.session};
  const intent={id:'pi_local',metadata:{order_id:id},amount:order.total_cents,currency:order.currency,capture_method:'manual',amount_capturable:order.total_cents,amount_received:0,status:'requires_capture',...options.intent};
  const state={stock:options.stock??1,claims:0,finishes:[],captures:[],captureSuccesses:0,cachedCaptureErrors:new Map(),cancels:[],notifications:0,providerReads:0,claim:null};
  const sb={
    from(table){return{select(){return this;},eq(){return this;},not(){return this;},lt(){return this;},order(){return this;},limit(){return this;},then(resolve){return Promise.resolve({data:options.unclaimed?[{id:order.id,stripe_session_id:session.id}]:[]}).then(resolve);},async maybeSingle(){return{data:table==='orders'?{...order}:state.claim?{...state.claim}:null};}};},
    async rpc(name,args){
      if(name==='recoverable_authorized_checkouts')return{data:state.claim?[{order_id:id,session_id:session.id}]:[]};
      if(name==='claim_authorized_checkout'){
        state.claims++;
        if(!state.claim){const available=state.stock>0;state.claim={order_id:id,session_id:session.id,payment_intent_id:session.payment_intent,amount_cents:order.total_cents,currency:order.currency,state:available?'capturing':'cancelling'};if(available){state.stock--;order.inventory_reserved=true;}}
        return{data:{...state.claim},error:null};
      }
      if(name==='finish_authorized_checkout'){
        state.finishes.push(args.p_outcome);
        if(state.claim.state!==args.p_outcome){if(args.p_outcome==='cancelled'&&order.inventory_reserved){state.stock++;}order.inventory_reserved=false;order.status=args.p_outcome==='captured'?'paid':'payment_failed';state.claim.state=args.p_outcome;}
        if(options.lostSQL){options.lostSQL=false;throw Error('SQL reply lost');}
        return{data:{...state.claim}};
      }
      if(name==='release_order'){order.status='payment_failed';return{data:true};}
      throw Error('Unexpected RPC '+name);
    }
  };
  const provider={checkout:{sessions:{retrieve:async()=>{state.providerReads++;return{...session};}}},paymentIntents:{
    retrieve:async()=>{state.providerReads++;return{...intent};},
    capture:async(id,payload,request)=>{
      state.captures.push({id,payload,request});
      if(state.cachedCaptureErrors.has(request.idempotencyKey))throw state.cachedCaptureErrors.get(request.idempotencyKey);
      if(Object.hasOwn(payload,'final_capture')){const error=Object.assign(Error('This PaymentIntent does not support multi-capture; final_capture cannot be passed'),{type:'StripeInvalidRequestError',statusCode:400});state.cachedCaptureErrors.set(request.idempotencyKey,error);throw error;}
      if(options.captureFailure){options.captureFailure=false;throw Error('provider failure');}
      if(intent.status==='succeeded')throw Error('Already captured');
      state.captureSuccesses++;intent.status='succeeded';intent.amount_received=intent.amount;intent.amount_capturable=0;session.payment_status='paid';if(options.lostCapture){options.lostCapture=false;throw Error('capture reply lost');}return{...intent};
    },
    cancel:async(id,payload,request)=>{state.cancels.push({id,payload,request});if(options.cancelFailure){options.cancelFailure=false;throw Error('provider failure');}intent.status='canceled';if(options.lostCancel){options.lostCancel=false;throw Error('cancel reply lost');}return{...intent};}
  }};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('netlify/functions/lib/authorized-checkout.js','utf8'),{module,Date,process:{env:{}},console:{error(){}},require:name=>name==='stripe'?class{constructor(){throw Error('No real provider allowed');}}:{json}});
  const notify=async value=>{if(['paid','no_payment_required'].includes(value.payment_status)&&!state.notified){state.notified=true;state.notifications++;}return json(200,{received:true});};
  return{order,session,intent,state,sb,provider,api:module.exports,run:()=>module.exports.settleCheckout(sb,{id:session.id,client_reference_id:order.id,payment_status:'unpaid'},notify,provider),recover:()=>module.exports.recoverAuthorizedCheckouts(sb,notify,provider)};
}

test('après validation bancaire : allouer puis capturer exactement une fois, confirmation seulement après encaissement',async()=>{
  const f=fixture();assert.equal(f.state.stock,1);assert.equal((await f.run()).statusCode,200);assert.equal(f.state.stock,0);assert.equal(f.order.status,'paid');assert.equal(f.state.captures.length,1);assert.equal(f.state.notifications,1);
  assert.equal(f.state.captures[0].payload.amount_to_capture,1000);assert.equal(Object.hasOwn(f.state.captures[0].payload,'final_capture'),false);
  assert.equal((await f.run()).statusCode,200);assert.equal(f.state.captures.length,1);assert.equal(f.state.stock,0);assert.equal(f.state.notifications,1);
});
test('un ancien refus final_capture mémorisé est repris avec la requête v2 sur le même intent, sans nouvelle allocation ni double encaissement',async()=>{
  const f=fixture();
  await f.sb.rpc('claim_authorized_checkout',{});
  const legacyKey='hn-capture-'+f.order.id;
  await assert.rejects(f.provider.paymentIntents.capture('pi_local',{amount_to_capture:1000,final_capture:true},{idempotencyKey:legacyKey}),/multi-capture/);
  // Merely dropping the parameter under the old key still gets the stored error.
  await assert.rejects(f.provider.paymentIntents.capture('pi_local',{amount_to_capture:1000},{idempotencyKey:legacyKey}),/multi-capture/);
  assert.equal(f.state.stock,0);assert.equal(f.state.captureSuccesses,0);
  await f.recover();assert.equal(f.order.status,'paid');assert.equal(f.state.stock,0);assert.equal(f.state.captureSuccesses,1);assert.equal(f.state.notifications,1);
  const capture=f.state.captures.at(-1);assert.equal(capture.id,'pi_local');assert.equal(capture.request.idempotencyKey,'hn-capture-v2-'+f.order.id);assert.equal(Object.hasOwn(capture.payload,'final_capture'),false);
  await f.run();assert.equal(f.state.captureSuccesses,1);assert.equal(f.state.notifications,1);
  const alreadyCaptured=fixture({intent:{status:'succeeded',amount_received:1000,amount_capturable:0}});
  await alreadyCaptured.sb.rpc('claim_authorized_checkout',{});await alreadyCaptured.recover();assert.equal(alreadyCaptured.state.captures.length,0);assert.equal(alreadyCaptured.order.status,'paid');assert.equal(alreadyCaptured.state.stock,0);
});
test('dernière pièce déjà vendue : annuler uniquement l’autorisation, aucun encaissement ni stock inventé',async()=>{
  const f=fixture({stock:0,lostCancel:true});assert.equal((await f.run()).statusCode,200);assert.equal(f.order.status,'payment_failed');assert.equal(f.intent.status,'canceled');assert.equal(f.state.stock,0);assert.equal(f.state.captures.length,0);assert.equal(f.state.cancels.length,1);assert.equal(f.state.notifications,0);
  assert.equal((await f.run()).statusCode,200);assert.equal(f.state.cancels.length,1);assert.equal(f.state.stock,0);
});
test('réponses fournisseur ou SQL perdues : même paiement, même clé, reprise sans second encaissement',async()=>{
  for(const options of [{lostCapture:true},{lostSQL:true},{captureFailure:true}]){
    const f=fixture(options);try{await f.run();}catch{}await f.recover();await f.run();
    assert.equal(f.state.stock,0);assert.equal(f.order.status,'paid');assert.equal(f.state.notifications,1);assert.equal(new Set(f.state.captures.map(c=>c.request.idempotencyKey)).size,1);assert(f.state.captures.every(c=>c.id==='pi_local'));
  }
  const failed=fixture({stock:0,cancelFailure:true});await assert.rejects(failed.run());assert.equal(failed.state.claim.state,'cancelling');assert.equal(failed.state.stock,0);await failed.recover();assert.equal(failed.state.claim.state,'cancelled');assert.equal(failed.state.captures.length,0);
});
test('identité, montant, devise, mode et autorisation sont relus avant toute allocation ou opération financière',async()=>{
  for(const options of [{session:{metadata:{order_id:'other'}}},{session:{client_reference_id:'other'}},{session:{amount_total:1}},{session:{currency:'usd'}},{session:{mode:'subscription'}},{intent:{metadata:{order_id:'other'}}},{intent:{currency:'usd'}},{intent:{amount:1}},{intent:{amount_capturable:1}},{intent:{capture_method:'automatic'}},{intent:{status:'processing'}}]){
    const f=fixture(options);await assert.rejects(f.run());assert.equal(f.state.claims,0);assert.equal(f.state.stock,1);assert.equal(f.state.captures.length,0);assert.equal(f.state.cancels.length,0);assert.equal(f.state.notifications,0);
  }
  const legacy=fixture({order:{payment_flow:'automatic'}});await legacy.run();assert.equal(legacy.state.providerReads,0);assert.equal(legacy.state.claims,0);
});
test('un premier webhook manqué est récupéré, mais une page de paiement encore ouverte ne bloque aucun stock',async()=>{
  const authorized=fixture({unclaimed:true});await authorized.recover();assert.equal(authorized.order.status,'paid');assert.equal(authorized.state.stock,0);assert.equal(authorized.state.captures.length,1);
  const open=fixture({unclaimed:true,session:{status:'open',payment_intent:null}});await open.recover();assert.equal(open.state.stock,1);assert.equal(open.state.claims,0);assert.equal(open.state.captures.length,0);assert.equal(open.order.status,'pending');
  const expired=fixture({unclaimed:true,session:{status:'expired',payment_intent:null}});await expired.recover();assert.equal(expired.state.stock,1);assert.equal(expired.state.claims,0);assert.equal(expired.state.captures.length,0);
});
test('commande gratuite : disponibilité atomique, aucun PaymentIntent ni faux encaissement',async()=>{
  for(const stock of [0,1]){
    const f=fixture({stock,order:{total_cents:0},session:{payment_intent:null,payment_status:'no_payment_required'}});await f.run();assert.equal(f.state.stock,0);assert.equal(f.state.captures.length,0);assert.equal(f.state.cancels.length,0);assert.equal(f.state.notifications,stock);assert.equal(f.order.status,stock?'paid':'payment_failed');
  }
});
test('une autorisation annulée après un incident d’encaissement libère uniquement son allocation',async()=>{
  const f=fixture({captureFailure:true});await assert.rejects(f.run());assert.equal(f.state.stock,0);assert.equal(f.state.claim.state,'capturing');
  f.intent.status='canceled';await f.run();assert.equal(f.state.stock,1);assert.equal(f.order.status,'payment_failed');assert.equal(f.state.notifications,0);assert.equal(f.state.captures.length,1);
});

test('SQL réel rejouable : paniers sans réservation, course dernière pièce, autorisations, réessais, coûts historiques et accès privés',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;');
    const names=['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql','migration_catalog_cleanup.sql','migration_inventory_journal.sql','migration_partial_refunds.sql','migration_catalog_categories.sql','migration_catalog_return_cleanup.sql','migration_physical_sales.sql','migration_physical_prices.sql'];
    for(const name of names)await db.exec(fs.readFileSync('supabase/'+name,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    const migration=fs.readFileSync('supabase/migration_authorized_checkout.sql','utf8');await db.exec(migration);await db.exec(migration);
    const p=randomUUID(),v=randomUUID();await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image)values($1,'authorized','AUTH','Jacket','Veste','سترة','','','',1000,'jacket','images/hero.jpg')",[p]);await db.query("insert into product_variants(id,product_id,color,size,stock)values($1,$2,'Beige','M',1)",[v,p]);await db.query("insert into variant_costs(variant_id,unit_cost_cents,currency)values($1,300,'eur')",[v]);
    async function draft(flow='authorize_capture',age=0,email='fixture@example.test'){
      const id=randomUUID();await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,subtotal_cents,total_cents,currency,payment_flow,checkout_lang,cart_restore_token,created_at)values($1,$2,$3,'Fixture','Rue test','Paris','','75000','FR','standard',1000,1000,'eur',$4,'fr',$5,now()-$6::integer*interval '1 hour')",[id,'HN-'+id,email,flow,'a'.repeat(48),age]);await db.query("insert into order_items(order_id,product_id,product_slug,product_name,image,quantity,unit_price_cents,variant_id,net_total_cents)values($1,$2,'authorized','Veste','images/hero.jpg',1,1000,$3,1000)",[id,p,v]);return id;
    }
    const stock=async()=>(await db.query('select stock from product_variants where id=$1',[v])).rows[0].stock;
    const claim=async id=>(await db.query("select claim_authorized_checkout($1,$2,$3,1000,'eur') as r",[id,'cs_'+id,'pi_'+id])).rows[0].r;
    const finish=async(id,outcome)=>(await db.query('select finish_authorized_checkout($1,$2,$3,$4) as r',[id,'cs_'+id,'pi_'+id,outcome])).rows[0].r;
    const first=await draft(),second=await draft();assert.equal(await stock(),1);
    const result=await Promise.all([claim(first),claim(second)]);assert.equal(result.filter(r=>r.state==='capturing').length,1);assert.equal(result.filter(r=>r.state==='cancelling').length,1);assert.equal(await stock(),0);
    assert.equal((await db.query("select release_order($1,'abandoned') as ok",[first])).rows[0].ok,false);assert.equal(await stock(),0);
    assert.equal((await claim(first)).state,'capturing');await assert.rejects(db.query("select claim_authorized_checkout($1,$2,$3,999,'eur')",[first,'cs_'+first,'pi_'+first]));
    await finish(second,'cancelled');assert.equal(await stock(),0);await finish(first,'captured');await finish(first,'captured');assert.equal(await stock(),0);
    const paid=(await db.query('select status,inventory_reserved,payment_intent_id from orders where id=$1',[first])).rows[0];assert.equal(paid.status,'paid');assert.equal(paid.inventory_reserved,false);assert.equal(paid.payment_intent_id,'pi_'+first);
    assert.equal((await db.query('select c.unit_cost_cents from order_item_costs c join order_items i on i.id=c.order_item_id where i.order_id=$1',[first])).rows[0].unit_cost_cents,300);
    await assert.rejects(finish(first,'cancelled'));await assert.rejects(db.query("update orders set payment_flow='automatic' where id=$1",[first]));
    await db.query('update product_variants set stock=1 where id=$1',[v]);const failed=await draft();await claim(failed);assert.equal(await stock(),0);await finish(failed,'cancelled');await finish(failed,'cancelled');assert.equal(await stock(),1);
    // Existing automatic checkouts keep their original hold and release behavior.
    const legacy=await draft('automatic');await db.query('select reserve_order($1)',[legacy]);assert.equal(await stock(),0);await db.query("select release_order($1,'abandoned')",[legacy]);assert.equal(await stock(),1);
    const old=await draft('authorize_capture',3,'reminder@example.test'),old2=await draft('authorize_capture',4,'reminder@example.test');
    const claims=await Promise.all([db.query('select claim_checkout_reminder($1) as ok',[old]),db.query('select claim_checkout_reminder($1) as ok',[old2])]);assert.equal(claims.filter(r=>r.rows[0].ok).length,1);assert.equal((await db.query('select claim_checkout_reminder($1) as ok',[old])).rows[0].ok,false);
    const current=await draft('authorize_capture',0,'recent@example.test');assert.equal((await db.query('select claim_checkout_reminder($1) as ok',[current])).rows[0].ok,false);
    const paidHistory=await draft('authorize_capture',3,'buyer@example.test'),replaced=await draft('authorize_capture',4,'buyer@example.test');await db.query("update orders set status='paid',paid_at=now() where id=$1",[paidHistory]);assert.equal((await db.query('select claim_checkout_reminder($1) as ok',[replaced])).rows[0].ok,false);
    const before=await stock();await db.exec(migration);assert.equal(await stock(),before);assert.equal((await db.query('select authorized_checkout_schema_version() as v')).rows[0].v,1);
    for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_table_privilege($1,'order_payment_captures','select') as ok",[role])).rows[0].ok,false);assert.equal((await db.query("select has_function_privilege($1,'claim_authorized_checkout(uuid,text,text,integer,text)','execute') as ok",[role])).rows[0].ok,false);}
    assert.equal((await db.query("select has_table_privilege('service_role','order_payment_captures','delete') as ok")).rows[0].ok,false);
  }finally{await db.close();}
});
