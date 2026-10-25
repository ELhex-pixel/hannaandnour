const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const json=(statusCode,body)=>({statusCode,body:JSON.stringify(body)});

test('SQL réel : limite par client, courses, finalisation idempotente, échec libéré et historique payé conservé',async()=>{
  const db=new PGlite();
  try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;');
    const names=['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql','migration_catalog_cleanup.sql','migration_inventory_journal.sql','migration_partial_refunds.sql','migration_catalog_categories.sql','migration_catalog_return_cleanup.sql','migration_physical_sales.sql','migration_physical_prices.sql','migration_authorized_checkout.sql'];
    for(const name of names)await db.exec(fs.readFileSync('supabase/'+name,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    const p=crypto.randomUUID(),v=crypto.randomUUID(),user=crypto.randomUUID();
    await db.query('insert into auth.users(id)values($1)',[user]);
    await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image)values($1,'promo-test','PROMO','Jacket','Veste','سترة','','','',1000,'jacket','images/hero.jpg')",[p]);
    await db.query("insert into product_variants(id,product_id,color,size,stock)values($1,$2,'Beige','M',50)",[v,p]);
    await db.query("insert into promo_codes(code,percent_off)values('TWICE',10),('ONCE',10),('HISTORY',10),('UNLIMITED',10),('GLOBAL',10)");
    async function draft(code,email='a@example.test',uid=null){
      const id=crypto.randomUUID();
      await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,total_cents,currency,payment_flow,checkout_lang,promo_code,user_id)values($1,$2,$3,'Fixture','Rue test','Paris','','75000','FR','standard',900,'eur','authorize_capture','fr',$4,$5)",[id,'HN-'+id,email,code,uid]);
      await db.query("insert into order_items(order_id,product_id,product_slug,product_name,image,quantity,unit_price_cents,variant_id,net_total_cents)values($1,$2,'promo-test','Veste','images/hero.jpg',1,1000,$3,900)",[id,p,v]);return id;
    }
    const old=await draft('HISTORY','history@example.test');
    await db.query("update orders set status='paid',paid_at=now()where id=$1",[old]);
    const migration=fs.readFileSync('supabase/migration_promo_customer_limits.sql','utf8');
    await db.exec(migration);await db.exec(migration);
    assert.equal((await db.query('select promo_customer_limits_schema_version()as v')).rows[0].v,1);
    assert.equal((await db.query('select stock from product_variants where id=$1',[v])).rows[0].stock,50);
    assert.equal((await db.query("select count(*)::integer as n from promo_codes where max_uses_per_customer is null")).rows[0].n,5);
    await db.exec("update promo_codes set max_uses_per_customer=case when code='TWICE'then 2 else 1 end where code in('TWICE','ONCE','HISTORY');update promo_codes set single_use=true where code='GLOBAL';");
    const can=async(code,email,uid=null)=>(await db.query('select promo_customer_can_use($1,$2,$3)as ok',[code,uid,email])).rows[0].ok;
    const stock=async()=>(await db.query('select stock from product_variants where id=$1',[v])).rows[0].stock;
    const claim=async id=>(await db.query("select claim_authorized_checkout($1,$2,$3,900,'eur')as r",[id,'cs_'+id,'pi_'+id])).rows[0].r;
    const finish=async(id,outcome)=>(await db.query('select finish_authorized_checkout($1,$2,$3,$4)as r',[id,'cs_'+id,'pi_'+id,outcome])).rows[0].r;
    assert.equal(await can('HISTORY',' HISTORY@example.test '),false);
    assert.equal(await can('HISTORY','another@example.test'),true);
    const a=await draft('TWICE','A@example.test',user),b=await draft('TWICE',' a@example.test '),c=await draft('TWICE','a@example.test');
    assert.equal(await can('TWICE','a@example.test'),true); // Unpaid drafts consume nothing.
    const claims=await Promise.all([claim(a),claim(b),claim(c)]);
    assert.equal(claims.filter(r=>r.state==='capturing').length,2);
    assert.equal(claims.filter(r=>r.state==='cancelling').length,1);
    assert.equal(await stock(),48);
    assert.equal((await claim(a)).state,'capturing');assert.equal(await stock(),48);
    assert.equal((await db.query("select release_order($1,'abandoned')as ok",[a])).rows[0].ok,false);
    assert.equal(await can('TWICE','a@example.test'),false);
    await finish(a,'captured');await finish(a,'captured');
    await finish(b,'cancelled');await finish(b,'cancelled');await finish(c,'cancelled');
    assert.equal(await stock(),49);assert.equal(await can('TWICE','a@example.test'),true);
    const again=await draft('TWICE','a@example.test');await claim(again);await finish(again,'captured');
    assert.equal(await can('TWICE','a@example.test'),false);
    await db.query("update orders set status='refunded'where id=$1",[again]);
    assert.equal(await can('TWICE','a@example.test'),false); // Refund does not restore promo use.
    const other=await draft('TWICE','other@example.test');assert.equal((await claim(other)).state,'capturing');await finish(other,'cancelled');
    const accountOrder=await draft('ONCE','old@example.test',user);await claim(accountOrder);await finish(accountOrder,'captured');
    assert.equal(await can('ONCE','changed@example.test',user),false);
    assert.equal(await can('ONCE','OLD@example.test'),false);
    assert.equal(await can('ONCE','different@example.test'),true);
    assert.equal(await can('UNLIMITED','a@example.test'),true);
    const g1=await draft('GLOBAL','first@example.test'),g2=await draft('GLOBAL','second@example.test');
    assert.equal((await claim(g1)).state,'capturing');assert.equal((await claim(g2)).state,'cancelling');
    await finish(g1,'cancelled');await finish(g2,'cancelled');
    assert.equal((await db.query("select used_count from promo_codes where code='GLOBAL'")).rows[0].used_count,0);
    const unavailable=await draft('TWICE','unused@example.test');await db.query('update products set active=false,catalog_deleted_at=now()where id=$1',[p]);
    const before=await stock();assert.equal((await claim(unavailable)).state,'cancelling');assert.equal(await stock(),before);
    for(const value of [0,-1,1000001])await assert.rejects(db.query("update promo_codes set max_uses_per_customer=$1 where code='TWICE'",[value]));
    await db.exec(migration);assert.equal(await stock(),before);assert.equal(await can('TWICE','a@example.test'),false);
    for(const role of ['anon','authenticated'])for(const fn of ['promo_customer_can_use(text,uuid,text)','promo_customer_limits_schema_version()','reserve_order(uuid)']){
      assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\')as ok',[role,fn])).rows[0].ok,false);
    }
  }finally{await db.close();}
});

function checkoutFixture({allowed=true,error=null,auth=true,withToken=false}={}){
  const state={rpc:[],orders:[],stripe:0};
  const sb={rpc:async(name,args)=>{state.rpc.push({name,args});return{data:allowed,error};},from:()=>({insert:async row=>{state.orders.push(row);return{error:null};},update(){return this;},eq(){return this;},then(resolve){return Promise.resolve({error:null}).then(resolve);}})};
  const value={promo:{code:'LOCAL',max_uses_per_customer:2},method:'standard',return_policy:{version:'v1'},currency:{code:'eur'},totals:{total:900,subtotal:1000,discount:100,shipping:0,tax:0},items:[{slug:'veste',qty:1,price_cents:1000,product:{id:crypto.randomUUID(),name_en:'Veste'}}]};
  const shared={json,isConfigured:()=>true,getSupabase:()=>sb,readBody:e=>JSON.parse(e.body),rateLimit:async()=>null,getBearer:()=>withToken?'verified-session':'',requireUser:async()=>({ok:auth,user:{id:'verified-user'}}),siteUrl:'https://example.test'};
  class Stripe{constructor(){state.stripe++;this.checkout={sessions:{create:async()=>({id:'cs_fixture',url:'https://example.test/pay'})}};}}
  const exports={};
  vm.runInNewContext(fs.readFileSync('netlify/functions/checkout.js','utf8'),{exports,console:{error(){}},process:{env:{STRIPE_SECRET_KEY:'fixture'}},require:name=>name==='crypto'?crypto:name==='stripe'?Stripe:name==='./shared'?shared:name==='./lib/customer-email'?{locale:()=> 'fr'}:name==='./lib/checkout-cancellation'?{cancellationToken:()=> 'fixture'}:{quote:async()=>value,publicQuote:v=>v,discountedLines:()=>[{quantity:1,unit_amount:900,item:value.items[0]}]}});
  const run=(extra={})=>exports.handler({httpMethod:'POST',body:JSON.stringify({email:' A@EXAMPLE.TEST ',customer_name:'Test',address1:'Rue',city:'Paris',postal_code:'75000',country:'FR',expected_total_cents:900,expected_currency:'eur',expected_policy_version:'v1',user_id:'forged',used_count:0,...extra})});
  return{state,run,value};
}
test('le serveur refuse une limite atteinte avant Stripe et ne prend jamais l’identité ou le compteur du navigateur',async()=>{
  for(const withToken of [false,true]){
    const f=checkoutFixture({allowed:false,withToken});const response=await f.run();
    assert.equal(response.statusCode,409);assert.equal(JSON.parse(response.body).error,'promo_customer_limit');
    assert.equal(f.state.stripe,0);assert.equal(f.state.orders.length,0);
    assert.deepEqual(JSON.parse(JSON.stringify(f.state.rpc)),[{name:'promo_customer_can_use',args:{p_code:'LOCAL',p_user_id:withToken?'verified-user':null,p_email:'a@example.test'}}]);
  }
  const denied=checkoutFixture({auth:false,withToken:true});assert.equal((await denied.run()).statusCode,401);assert.equal(denied.state.rpc.length,0);
  for(const options of [{allowed:null},{error:{message:'private SQL'}}]){
    const f=checkoutFixture(options),r=await f.run();assert.equal(r.statusCode,503);assert.equal(f.state.stripe,0);assert(!r.body.includes('private SQL'));
  }
  const ok=checkoutFixture();assert.equal((await ok.run()).statusCode,200);assert.equal(ok.state.stripe,1);assert.equal(ok.state.orders[0].payment_flow,'authorize_capture');
  const preview=checkoutFixture({allowed:false});assert.equal((await preview.run({action:'quote'})).statusCode,200);assert.equal(preview.state.rpc.length,0);assert.equal(preview.state.orders.length,0);
});

function adminFixture({authorized=true,limited=false,error=null}={}){
  const state={rows:[],tables:[],limits:0};
  const shared={json,isConfigured:()=>true,readBody:e=>JSON.parse(e.body),requireAdmin:async()=>({ok:authorized}),rateLimit:async()=>{state.limits++;return limited?json(429,{error:'limited'}):null;},getSupabase:()=>({from:table=>{state.tables.push(table);return{upsert:async row=>{state.rows.push(row);return{error};}};}})};
  const exports={};vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,Buffer,console:{error(){}},process:{env:{}},require:name=>name==='crypto'?crypto:name==='./shared'?shared:name==='stripe'?class{}:{}});
  return{state,run:extra=>exports.handler({httpMethod:'POST',body:JSON.stringify({action:'savePromo',code:'LOCAL',percent_off:10,...extra})})};
}
test('l’admin valide les limites, conserve les anciennes règles et les compteurs, et exige session et quota',async()=>{
  for(const limit of [1,2,1000000,null]){
    const f=adminFixture();assert.equal((await f.run({max_uses_per_customer:limit,used_count:0,reserved_order_id:'forged'})).statusCode,200);
    const row=f.state.rows[0];assert.equal(row.max_uses_per_customer,limit);assert(!Object.hasOwn(row,'used_count'));assert(!Object.hasOwn(row,'single_use'));assert(!Object.hasOwn(row,'reserved_order_id'));
  }
  const legacy=adminFixture();await legacy.run({});assert(!Object.hasOwn(legacy.state.rows[0],'max_uses_per_customer'));
  for(const limit of [0,-1,1.5,1000001,'2','',true,{},[]]){
    const f=adminFixture();assert.equal((await f.run({max_uses_per_customer:limit})).statusCode,400);assert.equal(f.state.rows.length,0);
  }
  const renamed=adminFixture();assert.equal((await renamed.run({original_code:'OLD'})).statusCode,400);assert.equal(renamed.state.rows.length,0);
  const denied=adminFixture({authorized:false});assert.equal((await denied.run({max_uses_per_customer:2})).statusCode,401);assert.equal(denied.state.limits,0);assert.equal(denied.state.tables.length,0);
  const limited=adminFixture({limited:true});assert.equal((await limited.run({max_uses_per_customer:2})).statusCode,429);assert.equal(limited.state.tables.length,0);
  const failed=adminFixture({error:{message:'private SQL'}}),r=await failed.run({max_uses_per_customer:2});assert.equal(r.statusCode,503);assert(!r.body.includes('private SQL'));
});

test('le formulaire charge et envoie la limite par client, refuse les fractions et préserve le brouillon en cas d’échec',async()=>{
  const source=fs.readFileSync('public/js/admin.js','utf8'),nodes={},writes=[],messages=[];let rejectSave=false;
  const node=id=>nodes[id]||(nodes[id]={value:'',checked:false,disabled:false,style:{},textContent:'',innerHTML:'',handlers:{},classList:{add(){},remove(){}},addEventListener(type,fn){this.handlers[type]=fn;}});
  const context={document:{getElementById:node,addEventListener(){}},setVal:(id,v)=>{node(id).value=String(v);},getVal:id=>String(node(id).value).trim(),toast:m=>messages.push(m),confirm:()=>true,fmtDate:()=>'',esc:String,call:async(action,body)=>{
    if(action==='listPromos')return{promos:[]};writes.push(JSON.parse(JSON.stringify(body)));if(rejectSave)throw Error('Échec enregistré');return{ok:true};
  }};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  var promosAll = []'),source.indexOf('  /* ---------------- Blog'))+source.slice(source.indexOf('  var editingPromo = null;'),source.indexOf('  /* ---------------- Stats')),context);
  context.wirePromos();
  const save=()=>node('savePromoBtn').handlers.click.call(node('savePromoBtn'));
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  context.openPromoEditor({code:'LOCAL',percent_off:10,active:true,max_uses_per_customer:2,single_use:true});
  assert.equal(node('p-customer-limit').value,'2');assert.equal(node('p-code').readOnly,true);
  for(const invalid of ['0','-1','1.5','2e2','1000001']){node('p-customer-limit').value=invalid;save();}
  assert.equal(writes.length,0);
  node('p-customer-limit').value='1';save();save();await settle();assert.equal(writes.length,1);assert.equal(writes[0].max_uses_per_customer,1);assert(!Object.hasOwn(writes[0],'single_use'));
  node('p-customer-limit').value='';save();await settle();assert.equal(writes[1].max_uses_per_customer,null);
  rejectSave=true;node('p-customer-limit').value='2';save();await settle();assert.equal(node('p-customer-limit').value,'2');assert.equal(node('savePromoBtn').disabled,false);assert(messages.includes('Échec enregistré'));
  context.openPromoEditor(null);assert.equal(node('p-code').readOnly,false);assert.equal(node('p-customer-limit').value,'');
});
