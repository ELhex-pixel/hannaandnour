const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const id = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });
function fixture(options = {}) {
  const order = { id, user_id: user, status:'pending', paid_at:null, payment_intent_id:null, refunded_cents:0, sale_channel:'online', total_cents:1000, currency:'eur', inventory_reserved:true, stripe_session_id:'cs_local', cart_restore_token:'a'.repeat(48), ...options.order };
  const session = { id:'cs_local',client_reference_id:id,metadata:{order_id:id},mode:'payment',amount_total:1000,currency:'eur',status:'open',payment_status:'unpaid', ...options.session };
  const state = { reads:0,retrieves:0,expires:0,releases:0,stock:9,scopes:[],rpcCalls:[] };
  const sb = options.sb || {
    from() {
      const filters = {};
      return { select() { return this; }, eq(key,value) { filters[key]=value; state.scopes.push([key,value]); return this; }, async maybeSingle() { state.reads++; if(options.readError)throw Error('private SQL'); return {data:filters.id===order.id&&(!filters.user_id||filters.user_id===order.user_id)?{...order}:null,error:null}; } };
    },
    async rpc(name,args) {
      state.rpcCalls.push(name); assert.equal(name,'release_order'); assert.equal(args.p_order_id,id); assert.equal(args.p_status,'abandoned');
      if(options.databaseRace){order.status='paid';order.paid_at='2026-10-21';order.inventory_reserved=false;return{data:false};}
      if(options.rpcError)throw Error('private SQL');
      if(order.inventory_reserved){state.releases++;state.stock++;order.inventory_reserved=false;}
      order.status='abandoned';
      if(options.lostDatabaseReply){options.lostDatabaseReply=false;throw Error('response lost');}
      return{data:true,error:null};
    }
  };
  class Stripe {
    constructor() { this.checkout={sessions:{
      retrieve:async()=>{state.retrieves++;if(options.readStripeError)throw Error('private Stripe key');return{...session};},
      expire:async()=>{state.expires++;if(options.paymentRace){session.status='complete';session.payment_status='paid';throw Error('already paid');}if(!options.expireFailure)session.status='expired';if(options.expireFailure||options.lostExpireReply)throw Error('response lost');return{...session};}
    }}; }
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('netlify/functions/lib/checkout-cancellation.js','utf8'),{module,Buffer,process:{env:{STRIPE_SECRET_KEY:'fixture-only'}},require:name=>name==='crypto'?crypto:name==='stripe'?Stripe:{json}});
  const api=module.exports, body={order_id:id,cancel_token:api.cancellationToken(id,order.cart_restore_token)};
  return{api,body,sb,state,order,session,run:(payload=body,owner)=>api.cancelCheckout(sb,payload,owner)};
}

test('annulation : seule la session précise expirée et impayée peut libérer le stock, une seule fois',async()=>{
  const f=fixture();assert.equal((await f.run()).statusCode,200);assert.equal(f.state.expires,1);assert.equal(f.state.retrieves,2);assert.equal(f.state.releases,1);assert.equal(f.state.stock,10);assert.equal(f.order.status,'abandoned');
  assert.equal((await f.run()).statusCode,200);assert.equal(f.state.releases,1);assert.equal(f.state.retrieves,2);
  const expired=fixture({session:{status:'expired'}});assert.equal((await expired.run()).statusCode,200);assert.equal(expired.state.expires,0);assert.equal(expired.state.releases,1);
});
test('annulation : jeton de finalité séparée et compte propriétaire exact, sans accès par email ou simple numéro',async()=>{
  const f=fixture();assert.notEqual(f.body.cancel_token,f.order.cart_restore_token);
  for(const payload of [{order_id:'HN-number'}, {...f.body,cancel_token:'b'.repeat(64)}, {...f.body,cancel_token:f.order.cart_restore_token}]){
    assert((await f.run(payload)).statusCode>=400);assert.equal(f.state.retrieves,0);assert.equal(f.state.releases,0);
  }
  assert.equal((await f.run({order_id:id},'wrong-user')).statusCode,404);assert.equal(f.state.retrieves,0);
  assert.equal((await f.run({order_id:id},user)).statusCode,200);assert(f.state.scopes.some(([key,value])=>key==='user_id'&&value===user));
});
test('annulation : paiement, traitement asynchrone, vente physique et données incohérentes ne restituent aucune unité',async()=>{
  for(const options of [
    {order:{status:'paid'}},{order:{paid_at:'2026-10-21'}},{order:{payment_intent_id:'pi_local'}},{order:{status:'refunded'}},{order:{sale_channel:'physical'}},
    {session:{status:'complete',payment_status:'paid'}},{session:{status:'complete',payment_status:'unpaid'}},{session:{payment_status:'no_payment_required'}},
    {session:{id:'cs_other'}},{session:{client_reference_id:'other'}},{session:{metadata:{order_id:'other'}}},{session:{amount_total:1}},{session:{currency:'usd'}},{session:{mode:'subscription'}}
  ]){
    const f=fixture(options);assert((await f.run()).statusCode>=400);assert.equal(f.state.expires,0);assert.equal(f.state.releases,0);assert.equal(f.state.stock,9);
  }
});
test('annulation : une réponse perdue se rapproche, une panne ou une course avec le paiement ne libère pas aveuglément',async()=>{
  for(const key of ['lostExpireReply','lostDatabaseReply']){
    const f=fixture({[key]:true});const first=await f.run();assert.equal(first.statusCode,key==='lostDatabaseReply'?503:200);assert.equal((await f.run()).statusCode,200);assert.equal(f.state.releases,1);assert.equal(f.state.stock,10);
  }
  for(const options of [{readError:true},{readStripeError:true},{expireFailure:true},{rpcError:true},{paymentRace:true},{databaseRace:true},{order:{stripe_session_id:null}}]){
    const f=fixture(options),response=await f.run();assert(response.statusCode>=400);assert.equal(f.state.releases,0);assert.equal(f.state.stock,9);assert(!response.body.includes('private'));
  }
});

test('annulation : POST protégé et quota avant la résolution, aucune mutation au simple GET',async()=>{
  for(const allowed of [false,true])for(const limited of [false,true]){
    let calls=0;const exports={};const shared={json,isConfigured:()=>true,getSupabase:()=>({}),readBody:e=>JSON.parse(e.body),getBearer:e=>e.headers.authorization,requireUser:async()=>({ok:allowed,user:{id:user}}),rateLimit:async()=>limited?json(429,{}):null};
    vm.runInNewContext(fs.readFileSync('netlify/functions/auth.js','utf8'),{exports,process:{env:{}},console:{error(){}},require:name=>name==='crypto'?crypto:name==='./lib/checkout-cancellation'?{cancelCheckout:async(sb,body,owner)=>{calls++;assert.equal(owner,user);return json(200,{cancelled:true});}}:name==='./shared'?shared:{}});
    const response=await exports.handler({httpMethod:'POST',headers:{authorization:'fixture-token'},body:JSON.stringify({action:'cancelCheckout',order_id:id,user_id:'forged'})});
    assert.equal(response.statusCode,limited?429:allowed?200:401);assert.equal(calls,!limited&&allowed?1:0);
    assert.equal((await exports.handler({httpMethod:'GET'})).statusCode,405);
  }
});

test('les jetons de retour ne sont pas conservés dans les chemins et référents analytiques',async()=>{
  const exports={},rows=[];const query={insert:async row=>rows.push(row)};
  const shared={json,isConfigured:()=>true,getSupabase:()=>({from:()=>query}),readBody:e=>JSON.parse(e.body),rateLimit:async()=>null};
  vm.runInNewContext(fs.readFileSync('netlify/functions/track.js','utf8'),{exports,console:{error(){}},require:()=>shared});
  const result=await exports.handler({httpMethod:'POST',headers:{referer:'https://example.test/fr/cart?checkout_cancel_token=private#secret'},body:JSON.stringify({type:'pageview',path:'/fr/cart?checkout_cancel_token=private#secret'})});
  assert.equal(result.statusCode,202);assert.equal(rows[0].path,'/fr/cart');assert.equal(rows[0].referrer,'https://example.test/fr/cart');assert(!JSON.stringify(rows).includes('private'));
});

test('récupération planifiée : cinq minutes, identité vérifiée et seuls les paiements expirés impayés libèrent leur réservation',async()=>{
  const orders=['expired','paid','async','unknown','foreign','unbound'].map((kind,index)=>({id:'order-'+index,stripe_session_id:kind==='unbound'?null:'cs_'+kind,stripe_creation_started:true,total_cents:1000,currency:'eur',created_at:new Date(Date.now()-3600000).toISOString(),kind}));
  let schedule,cutoff;const releases=[],paid=[];
  const sb={
    from(table){let columns;return{select(value){columns=value;return this;},delete(){return this;},lt(key,value){if(table==='orders')cutoff=value;return this;},lte(){return this;},eq(){return this;},in(){return this;},order(){return this;},limit(){return this;},then(resolve){return Promise.resolve({data:table==='orders'&&columns!=='id'?orders:[],error:null}).then(resolve);}};},
    async rpc(name,args){assert.equal(name,'release_order');releases.push(args.p_order_id);return{data:true};}
  };
  class Stripe{constructor(){this.checkout={sessions:{
    async list(){return{data:[],has_more:false};},
    async retrieve(sessionId){const order=orders.find(row=>row.stripe_session_id===sessionId);if(order.kind==='unknown')throw Error('private provider failure');return{id:sessionId,client_reference_id:order.kind==='foreign'?'other':order.id,metadata:{order_id:order.id},amount_total:1000,currency:'eur',status:order.kind==='paid'||order.kind==='async'?'complete':'expired',payment_status:order.kind==='paid'?'paid':'unpaid'};}
  }};}}
  const exports={};
  vm.runInNewContext(fs.readFileSync('netlify/functions/pending-cleanup.js','utf8'),{exports,Date,console:{error(){}},process:{env:{STRIPE_SECRET_KEY:'fixture-only'}},require:name=>name==='@netlify/functions'?{schedule:(cron,handler)=>{schedule=cron;return handler;}}:name==='stripe'?Stripe:name==='./shared'?{isConfigured:()=>true,getSupabase:()=>sb}:name==='./stripe-webhook'?{markPaid:async session=>paid.push(session.client_reference_id)}:name==='./lib/authorized-checkout'?{recoverAuthorizedCheckouts:async()=>{},settleCheckout:(sb,session,notify)=>notify(session,sb)}:{}});
  const result=await exports.handler();assert.equal(result.statusCode,200);assert.equal(schedule,'*/5 * * * *');assert(Math.abs(new Date(cutoff).getTime()-(Date.now()-35*60000))<2000);assert.deepEqual(releases,['order-0']);assert.deepEqual(paid,['order-1']);
});

test('réservation réelle PostgreSQL : abandon et réessai restituent une fois, la confirmation payée gagne la course',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;');
    const files=['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql'];
    for(const file of files)await db.exec(fs.readFileSync('supabase/'+file,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    const product=crypto.randomUUID(),variant=crypto.randomUUID();
    await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image) values($1,'cancel-test','CANCEL','Jacket','Veste','سترة','Fixture','Fixture','Fixture',1000,'jacket','images/hero.jpg')",[product]);
    await db.query("insert into product_variants(id,product_id,color,size,stock) values($1,$2,'Beige','M',10)",[variant,product]);
    await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,total_cents,currency,stripe_session_id,cart_restore_token) values($1,'HN-CANCEL','fixture@example.test','Fixture','Fixture','Paris','','75000','FR','standard',1000,'eur','cs_local',$2)",[id,'a'.repeat(48)]);
    await db.query("insert into order_items(order_id,product_id,product_slug,product_name,image,quantity,unit_price_cents,variant_id) values($1,$2,'cancel-test','Veste','images/hero.jpg',1,1000,$3)",[id,product,variant]);
    const stock=async()=>(await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock;
    await db.query('select reserve_order($1)',[id]);assert.equal(await stock(),9);
    const sb={from(){return{select(){return this;},eq(){return this;},async maybeSingle(){return{data:(await db.query('select * from orders where id=$1',[id])).rows[0]};}};},async rpc(name,args){return{data:(await db.query('select release_order($1,$2) as ok',[args.p_order_id,args.p_status])).rows[0].ok};}};
    const f=fixture({sb});assert.equal((await f.run()).statusCode,200);assert.equal(await stock(),10);assert.equal((await f.run()).statusCode,200);assert.equal(await stock(),10);
    // Even a delayed paid webhook must debit exactly once, never oversell/restock.
    await db.query("select finalize_order_payment($1,'cs_local',1000,'eur','pi_fixture')",[id]);assert.equal(await stock(),9);
    assert.equal((await f.run()).statusCode,409);assert.equal(await stock(),9);
    await db.query("select release_order($1,'abandoned')",[id]);assert.equal(await stock(),9);
  }finally{await db.close();}
});
