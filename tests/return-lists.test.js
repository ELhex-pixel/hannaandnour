const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {adminReturns}=require('../netlify/functions/lib/returns');
const {customerReturnList}=require('../netlify/functions/lib/customer-return-list');

test('base locale : les listes de retours sont paginées et privées, et une suppression admin conserve le retour client',async()=>{
  const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const files=['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql','migration_catalog_cleanup.sql','migration_inventory_journal.sql','migration_partial_refunds.sql','migration_catalog_categories.sql','migration_catalog_return_cleanup.sql'];
    for(const file of files)await db.exec(fs.readFileSync('supabase/'+file,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    const user=crypto.randomUUID(),other=crypto.randomUUID(),product=crypto.randomUUID(),variant=crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)',[user,other]);
    await db.query("insert into products(id,sku,slug,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image) values($1,'TEST','test-cape','Cape','Cape','Cape','','','',2000,'cape','images/test.jpg')",[product]);
    await db.query("insert into product_variants(id,product_id,color,size,stock) values($1,$2,'Vin','Unique',50)",[variant,product]);
    const orders=[];
    for(let index=0;index<13;index++){
      const id=crypto.randomUUID(),item=crypto.randomUUID(),owner=index===12?other:user;
      await db.query("insert into orders(id,order_number,user_id,email,customer_name,address1,city,state,postal_code,country,shipping_method,status,shipping_status,delivered_at,total_cents,created_at) values($1,$2,$3,'private@example.test','Privé','Rue privée','Paris','','75000','FR','standard','paid','delivered',now(),6000,now()-make_interval(days=>$4))",[id,index===12?'HN-OTHER':'HN-LIST-'+index,owner,index]);
      await db.query("insert into order_items(id,order_id,product_id,variant_id,product_slug,product_name,unit_price_cents,quantity,stock_debited,net_total_cents) values($1,$2,$3,$4,'test-cape',$5,2000,3,true,6000)",[item,id,product,variant,index===12?'Private other item':'Cape test']);
      orders.push({id,item});
    }
    async function request(index,quantity=1,op=crypto.randomUUID(),reason='Motif de test',owner=user){return(await db.query("select request_return_with_operation($1,$2,$3,$4,$5,14,'withdrawal',$6) as result",[owner,orders[index].id,orders[index].item,quantity,reason,op])).rows[0].result;}
    const first=await request(0),replayed=await request(0,1,first.id);
    assert.equal(replayed.id,first.id);assert.equal(replayed.already,true);
    await assert.rejects(request(0,2,first.id),/return_operation_mismatch/);
    await assert.rejects(request(0,3),/return_quantity_unavailable/);
    await assert.rejects(request(0,1,crypto.randomUUID(),'Motif de test',other),/Order ineligible/);
    await assert.rejects(request(12),/Order ineligible/);
    const approved=await request(1),received=await request(2),rejected=await request(3);
    await db.query("select decide_return_request($1,'approved','customer','Accord test')",[approved.id]);
    await db.query("select decide_return_request($1,'approved','customer','Accord test')",[received.id]);
    await db.query("select inspect_return_request($1,1,'Contrôle reçu')",[received.id]);
    await db.query("select decide_return_request($1,'rejected','customer','Refus documenté')",[rejected.id]);
    const customer=async(scope='all',offset=0,query='')=>(await db.query('select customer_return_orders($1,$2,$3,$4,5) as result',[user,query,scope,offset])).rows[0].result;
    const all=await customer();assert.equal(all.total,12);assert.equal(all.orders.length,5);
    assert(!JSON.stringify(all).includes('HN-OTHER'));assert(!JSON.stringify(all).includes('Rue privée'));
    const next=await customer('all',5);assert.equal(next.total,12);assert(!next.orders.some(order=>all.orders.some(first=>first.id===order.id)));
    assert.equal((await customer('open')).total,2);assert.equal((await customer('closed')).total,2);
    assert.equal((await customer('all',0,'HN-LIST-1')).total,3);
    assert.equal((await customer('all',0,'%')).total,0);
    const a=all.orders.find(order=>order.id===orders[0].id),r=all.orders.find(order=>order.id===orders[2].id);
    assert.equal(a.order_items[0].return_available_quantity,2);assert.equal(r.order_items[0].return_available_quantity,2);
    const admin=async(scope='all',offset=0)=>(await db.query("select admin_return_request_list('', $1,$2,2) as result",[scope,offset])).rows[0].result;
    assert.equal((await admin('open')).total,2);assert.equal((await admin()).total,4);
    const before=(await db.query('select * from order_returns order by id')).rows;
    const stockBefore=(await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock;
    for(const id of [first.id,approved.id])await assert.rejects(db.query("select hide_completed_return_request($1,'SUPPRIMER')",[id]),/return_not_finished/);
    await db.query("select hide_completed_return_request($1,'SUPPRIMER')",[received.id]);
    assert.equal((await db.query("select hide_completed_return_request($1,'SUPPRIMER') as result",[received.id])).rows[0].result.already,true);
    assert.equal((await admin()).total,3);assert.equal((await customer('closed')).total,2);
    assert.deepEqual((await db.query('select * from order_returns order by id')).rows,before);
    assert.equal((await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock,stockBefore);
    assert.equal((await customer()).orders.find(order=>order.id===orders[2].id).return_requests[0].status,'received');
    assert.equal((await request(2,1,received.id)).status,'received');
    // Installing/replaying the migration must preserve already hidden requests,
    // accepted return operations, stock and customer history.
    const hiddenAt=(await db.query('select admin_hidden_at from return_requests where id=$1',[received.id])).rows[0].admin_hidden_at;
    await db.exec(fs.readFileSync('supabase/migration_catalog_return_cleanup.sql','utf8'));
    assert.deepEqual((await db.query('select admin_hidden_at from return_requests where id=$1',[received.id])).rows[0].admin_hidden_at,hiddenAt);
    assert.equal((await admin()).total,3);
    assert.equal((await customer('closed')).total,2);
    assert.equal((await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock,stockBefore);
    for(const role of ['anon','authenticated'])for(const signature of ['customer_return_orders(uuid,text,text,integer,integer)','admin_return_request_list(text,text,integer,integer)','hide_completed_return_request(uuid,text)','request_return_with_operation(uuid,uuid,uuid,integer,text,integer,text,uuid)'])assert.equal((await db.query("select has_function_privilege($1,$2,'execute') as allowed",[role,signature])).rows[0].allowed,false);
    assert.equal((await db.query('select return_lists_schema_version() as version')).rows[0].version,1);
  }finally{await db.close();}
});

test('les API de listes utilisent la vraie pagination et filtrent les erreurs privées',async()=>{
  const calls=[],id=crypto.randomUUID();
  const sb={rpc:async(name,args)=>{calls.push({name,args});return{data:name==='customer_return_orders'?{orders:[],total:14}:{requests:[],total:14}};}};
  const customer=await customerReturnList(sb,id,{page:2,limit:5,scope:'open',query:' Test ',user_id:'forged'});
  assert.equal(customer.statusCode,200);assert.equal(JSON.parse(customer.body).total,14);assert.equal(calls[0].args.p_user_id,id);assert.equal(calls[0].args.p_offset,5);
  const admin=await adminReturns(sb,'listReturnRequests',{page:2,limit:10,scope:'received'});
  assert.equal(admin.statusCode,200);assert.equal(calls[1].args.p_offset,10);assert.equal(calls[1].args.p_scope,'received');
  assert.equal((await adminReturns(sb,'listReturnRequests',{scope:'invalid'})).statusCode,400);
  for(const response of [{error:{message:'private-test-error'}},{data:{requests:[],orders:[]}}]){
    const failed={rpc:async()=>response};
    for(const result of [await customerReturnList(failed,id,{}),await adminReturns(failed,'listReturnRequests',{})]){assert.equal(result.statusCode,503);assert(!result.body.includes('private-test-error'));}
  }
});

test('retirer un retour terminé appelle seulement la RPC de masquage et valide la confirmation',async()=>{
  const id=crypto.randomUUID(),calls=[];
  const sb={rpc:async(name,args)=>{calls.push({name,args});return{data:{id,already:false}};}};
  assert.equal((await adminReturns(sb,'hideCompletedReturn',{id})).statusCode,400);assert.equal(calls.length,0);
  assert.equal((await adminReturns(sb,'hideCompletedReturn',{id,confirmation:'SUPPRIMER'})).statusCode,200);
  assert.deepEqual(calls,[{name:'hide_completed_return_request',args:{p_id:id,p_confirmation:'SUPPRIMER'}}]);
  assert.equal((await adminReturns({rpc:async()=>({error:{message:'return_not_finished'}})},'hideCompletedReturn',{id,confirmation:'SUPPRIMER'})).statusCode,409);
});
test('la liste client authentifiée ignore un user_id fourni dans le corps et respecte le quota',async()=>{
  const exports={},user=crypto.randomUUID(),state={allowed:false,limited:false,calls:[]};
  const sb={rpc:async(name,args)=>{state.calls.push({name,args});return{data:{orders:[],total:0}};}};
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,getSupabase:()=>sb,readBody:event=>JSON.parse(event.body),getBearer:()=> 'fixture-token',requireUser:async()=>({ok:state.allowed,user:{id:user}}),rateLimit:async()=>state.limited?{statusCode:429}:null};
  vm.runInNewContext(fs.readFileSync('netlify/functions/auth.js','utf8'),{exports,process:{env:{}},console:{error(){}},require:name=>name==='./shared'?shared:name==='crypto'?crypto:require('../netlify/functions/'+name)});
  const run=()=>exports.handler({httpMethod:'POST',headers:{Authorization:'Bearer fixture-token'},body:JSON.stringify({action:'orders',return_portal:true,user_id:crypto.randomUUID(),scope:'all',page:1,limit:5})});
  assert.equal((await run()).statusCode,401);assert.equal(state.calls.length,0);
  state.allowed=true;state.limited=true;assert.equal((await run()).statusCode,429);assert.equal(state.calls.length,0);
  state.limited=false;assert.equal((await run()).statusCode,200);assert.equal(state.calls[0].args.p_user_id,user);
});

test('les demandes client transmettent le même identifiant au serveur et refusent une fausse confirmation',async()=>{
  const exports={},user=crypto.randomUUID(),op=crypto.randomUUID(),calls=[];
  const sb={rpc:async(name,args)=>{calls.push({name,args});return{data:{id:op,status:'requested',already:true,evidence_saved:false}};}};
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,getSupabase:()=>sb,readBody:event=>JSON.parse(event.body),getBearer:()=> 'fixture-token',requireUser:async()=>({ok:true,user:{id:user}}),rateLimit:async()=>null,getSetting:async()=>({returns_days:14})};
  vm.runInNewContext(fs.readFileSync('netlify/functions/returns.js','utf8'),{exports,console:{error(){}},require:name=>name==='./shared'?shared:name==='node:crypto'?crypto:require('../netlify/functions/'+name)});
  const body={order_id:crypto.randomUUID(),order_item_id:crypto.randomUUID(),quantity:1,reason:'Retour test',category:'withdrawal',operation_id:op,user_id:'forged'};
  const run=data=>exports.handler({httpMethod:'POST',headers:{Authorization:'Bearer fixture-token'},body:JSON.stringify(data)});
  for(let i=0;i<2;i++)assert.equal((await run(body)).statusCode,201);
  assert(calls.every(call=>call.name==='request_return_with_operation'&&call.args.p_operation_id===op&&call.args.p_user_id===user));
  assert.equal((await run({...body,operation_id:'invalid'})).statusCode,400);assert.equal(calls.length,2);
});
