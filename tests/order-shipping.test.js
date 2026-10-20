const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto'),{PGlite}=require('@electric-sql/pglite');
const parcel=require('../public/js/shipping-parcel');
const {createShippingClient}=require('../netlify/functions/lib/sendcloud-shipping');
const shipping=require('../netlify/functions/lib/order-shipping');
const orderId='11111111-1111-4111-8111-111111111111',operationId='22222222-2222-4222-8222-222222222222';
const secret='fixture-secret-NOT-REAL',credentials={SENDCLOUD_PUBLIC_KEY:'public-NOT-REAL',SENDCLOUD_SECRET_KEY:'secret-NOT-REAL'};
const packet={packaging:'pouch',weight_g:1200,length_mm:400,width_mm:300,height_mm:50};
const sender={name:'Sender Test',address_line_1:'Rue Test',house_number:'1',postal_code:'75001',city:'Paris',country_code:'FR',email:'sender@example.test',phone_number:'0000000000'};
const point={id:1000001,name:'Relais Test',fingerprint:'a'.repeat(64),type:'servicepoint',address:{street:'Straat Test',house_number:'2',postal_code:'1234 AB',city:'Amsterdam',country_code:'NL'}};
function option(price='6.62'){return{code:'mondial_relay:service_point,dualapi/kg=1-2',name:'Point Relais 1–2 kg',carrier:{code:'mondial_relay'},contract:{id:7},functionalities:{returns:false,labelless:false,form_factor:'parcel',first_mile:'dropoff',last_mile:'service_point'},requirements:{export_documents:false,fields:['to_email','to_telephone']},quote_error:null,quotes:[{weight:{min:{value:'1.001',unit:'kg'},max:{value:'2.001',unit:'kg'}},price:{total:{value:price,currency:'EUR'}}}]};}
function guard(){return{order_id:orderId,order_number:'HN-TEST',status:'paid',sale_channel:'online',shipping_status:'new',prepared_at:new Date().toISOString(),refunded_cents:0,stock_issue:false,inventory_reserved:false,admin_archived:false,refund_busy:false,return_count:0,customer_name:'Private Customer',email:'customer@example.test',phone:'0000000000',total_cents:2999,currency:'eur',tracking_number:null,carrier:null,delivery_type:'pickup',pickup_point_data:structuredClone(point),items:[{id:randomUUID(),quantity:1,prepared_quantity:1,stock_debited:true}]};}
function fixture(){
  const state={g:guard(),operations:new Map(),provider:new Map(),creates:0,lookups:0,price:'6.62',lost:false,finishLost:false,now:Date.now()};
  const sb={from(table){assert.equal(table,'order_shipping_operations');let id,order;return{select(){return this;},eq(field,value){if(field==='id')id=value;else order=value;return this;},in(){return this;},order(){return this;},async limit(){return{data:[...state.operations.values()].filter(r=>r.order_id===order&&['pending','ready'].includes(r.state)).slice(-1)};},async maybeSingle(){return{data:state.operations.get(id)||null};}};},async rpc(name,args){
    if(name==='shipping_order_guard')return{data:structuredClone(state.g)};
    if(name==='claim_order_shipping'){const row={id:args.p_id,order_id:args.p_order,request:structuredClone(args.p_request),provider_request:structuredClone(args.p_provider_request),order_guard:structuredClone(args.p_guard),state:'pending'};state.operations.set(row.id,row);return{data:structuredClone(row)};}
    if(name==='finish_order_shipping'){if(state.finishLost){state.finishLost=false;return{error:{message:'private SQL error'}};}const row=state.operations.get(args.p_id);row.state=args.p_result.state;row.result={...args.p_result,order_attention:state.g.status!=='paid'};return{data:structuredClone(row)};}
    throw new Error('Unexpected SQL');
  }};
  const client={senders:async()=>({senders:[{...sender,id:1}],incomplete:false}),sender:async()=>structuredClone(sender),options:async body=>{state.lastQuoteRequest=body;return[option(state.price)];},existing:async id=>{state.lookups++;return state.provider.get(id)||null;},announce:async payload=>{
    state.creates++;const id=payload.external_reference_id.replace('hn-label-',''),result={...structuredClone(payload),id:randomUUID(),carrier:{code:'mondial_relay'},errors:[],parcels:[{...structuredClone(payload.parcels[0]),id:12345,status:{code:'READY_TO_SEND'},announced_at:new Date().toISOString(),tracking_number:'MR-TRACK-TEST',documents:[{document_type:'label'}]}]};state.provider.set(id,result);if(state.lost){state.lost=false;throw new Error('Lost response with private credential');}return result;
  },label:async()=>Buffer.from('%PDF-1.4\nfixture')};
  const dependencies={client,pickupClient:{verifyCheckoutPoint:async()=>({point})},secret,now:()=>state.now};
  const call=async(action,body={})=>{const response=await shipping.adminOrderShipping(sb,action,{order_id:orderId,...body},dependencies);return{...response,data:JSON.parse(response.body)};};
  return{state,call,client,async quote(){const r=await call('quoteOrderShipping',{sender_id:1,parcel:packet});assert.equal(r.statusCode,200);return r.data.options[0];}};
}
test('colis : kg et cm sont convertis exactement, aucune mesure implicite ni arrondissement de poids',()=>{
  assert.deepEqual(parcel.parse({packaging:'pouch',weight:'1,200',length:'40',width:'30',height:'5'}),packet);
  assert.equal(parcel.provider(packet).weight.value,'1.200');assert.equal(parcel.provider(packet).dimensions.length,'40.0');
  for(const weight of ['',0,'-1','1.2345','1e3','100.001'])assert.throws(()=>parcel.parse({packaging:'box',weight,length:'40',width:'30',height:'5'}));
  assert.throws(()=>parcel.parse({packaging:'',weight:'1',length:'40',width:'30',height:'5'}));
});
test('services : seules les offres relais compatibles, tarifées et sans champ requis inconnu peuvent être confirmées',()=>{
  const valid=option();const rows=[valid,{...valid,carrier:{code:'other'}},{...valid,quotes:[]},{...valid,quote_error:{code:'private-price'}},{...valid,functionalities:{...valid.functionalities,last_mile:'home_delivery'}},{...valid,requirements:{fields:['unknown'],export_documents:false}}];
  const options=shipping.options(rows,packet,'servicepoint');assert.equal(options.length,1);assert.equal(options[0].price_cents,662);assert.equal(shipping.options([valid],packet,'locker').length,0);
  assert.equal(shipping.options([{...valid,quotes:[{price:{total:{value:'6.621',currency:'EUR'}}}]}],packet,'servicepoint').length,0);
});
test('Sendcloud v3 : chemins/méthodes fixes, clés en en-tête, reprise 409 et téléchargement PDF borné sans URL fournisseur arbitraire',async()=>{
  const calls=[];const client=createShippingClient({env:credentials,fetchImpl:async(url,options)=>{calls.push({url:new URL(url),options});if(url.includes('/documents/'))return new Response('%PDF-1.4\nfixture',{headers:{'Content-Type':'application/pdf'}});if(url.includes('/shipments/announce'))return new Response(JSON.stringify({id:'existing-fixture'}),{status:409});return new Response(JSON.stringify({data:[]}));}});
  await client.senders();await client.options({parcels:[parcel.provider(packet)]});await client.existing(operationId);assert.equal((await client.announce({external_reference_id:'hn-label-'+operationId})).id,'existing-fixture');assert.match((await client.label(12345,'A6')).toString(),/^%PDF-/);
  for(const call of calls){assert.equal(call.url.origin,'https://panel.sendcloud.sc');assert(call.url.pathname.startsWith('/api/v3/'));assert.equal(call.options.redirect,'error');assert.equal(call.options.cache,'no-store');assert(call.options.signal instanceof AbortSignal);assert.equal(call.options.headers.Authorization,'Basic '+Buffer.from(credentials.SENDCLOUD_PUBLIC_KEY+':'+credentials.SENDCLOUD_SECRET_KEY).toString('base64'));assert(!call.url.href.includes('NOT-REAL'));}
  assert.equal(calls[2].url.searchParams.get('external_reference_id'),'hn-label-'+operationId);assert.equal(calls[3].options.method,'POST');await assert.rejects(client.label('https://other.test','A6'));await assert.rejects(client.label(123,'A5'));
  const bad=createShippingClient({env:credentials,fetchImpl:async()=>new Response('<html>private</html>',{headers:{'Content-Type':'application/pdf'}})});await assert.rejects(bad.label(123,'A6'));
});
test('les devis ne créent aucune étiquette et le tarif/colis signé est relu avant tout affranchissement',async()=>{
  const f=fixture(),q=await f.quote();assert.equal(f.state.creates,0);assert.equal(f.state.operations.size,0);assert(!JSON.stringify(q).includes('customer@example.test'));assert(!JSON.stringify(q).includes('Sender Test'));
  for(const side of ['from_address','to_address'])assert.deepEqual(Object.keys(f.state.lastQuoteRequest[side]).sort(),['address_line_1','city','country_code','postal_code']);
  assert.deepEqual(Object.keys(f.state.lastQuoteRequest.parcels[0]).sort(),['dimensions','weight']);assert(!JSON.stringify(f.state.lastQuoteRequest).includes('customer@example.test'));
  const tampered=structuredClone(q);tampered.quote.option.price_cents=1;assert.equal((await f.call('createOrderShipping',{operation_id:operationId,confirmation:'CREER_ETIQUETTE',...tampered})).statusCode,409);assert.equal(f.state.creates,0);
  f.state.price='7.00';assert.equal((await f.call('createOrderShipping',{operation_id:operationId,confirmation:'CREER_ETIQUETTE',...q})).statusCode,409);assert.equal(f.state.operations.size,0);
  f.state.price='6.62';const ready=await f.call('createOrderShipping',{operation_id:operationId,confirmation:'CREER_ETIQUETTE',...q});assert.equal(ready.statusCode,200);assert.equal(ready.data.operation.state,'ready');assert.equal(f.state.creates,1);assert(!ready.body.includes('customer@example.test'));assert.equal(f.state.g.total_cents,2999);assert.equal(f.state.g.shipping_status,'new');
});
test('réponse fournisseur ou confirmation SQL perdue : même opération, même référence et aucune seconde étiquette',async()=>{
  for(const kind of ['lost','finishLost']){
    const f=fixture(),q=await f.quote();f.state[kind]=true;const request={operation_id:operationId,confirmation:'CREER_ETIQUETTE',...q};
    const first=await f.call('createOrderShipping',request);assert.equal(first.statusCode,503);assert.equal(first.data.code,'shipping_pending');assert.equal(f.state.creates,1);assert.equal(f.state.operations.get(operationId).state,'pending');
    f.state.now+=20*60000;const recovered=await f.call('createOrderShipping',request);assert.equal(recovered.statusCode,200);assert.equal(recovered.data.operation.state,'ready');assert.equal(f.state.creates,1);assert(!recovered.body.includes('private SQL'));assert(!first.body.includes('credential'));
    const again=await f.call('createOrderShipping',request);assert.equal(again.data.operation.state,'ready');assert.equal(f.state.creates,1);
  }
});
test('réponse partielle ou étrangère ne confirme jamais une étiquette ; un devis expiré ne démarre aucun affranchissement',async()=>{
  const expired=fixture(),q=await expired.quote();expired.state.now+=11*60000;assert.equal((await expired.call('createOrderShipping',{operation_id:operationId,confirmation:'CREER_ETIQUETTE',...q})).statusCode,409);assert.equal(expired.state.creates,0);
  for(const change of [s=>{s.order_number='OTHER';},s=>{s.parcels[0].documents=[];},s=>{s.errors=[{detail:'private provider text'}];},s=>{s.parcels[0].weight.value='9.000';}]){
    const f=fixture(),choice=await f.quote(),original=f.client.announce;f.client.announce=async body=>{const response=await original(body);change(response);return response;};const result=await f.call('createOrderShipping',{operation_id:operationId,confirmation:'CREER_ETIQUETTE',...choice});assert.equal(result.statusCode,503);assert.equal(result.data.code,'shipping_pending');assert.equal(f.state.operations.get(operationId).state,'pending');assert(!result.body.includes('private provider'));
  }
});
test('commande non préparée, remboursement en cours, relais modifié et confirmation incomplète bloquent la création',async()=>{
  for(const changes of [{prepared_at:null},{refund_busy:true},{status:'refunded'},{sale_channel:'physical'},{tracking_number:'OTHER'},{phone:''}]){const f=fixture();Object.assign(f.state.g,changes);assert.equal((await f.call('quoteOrderShipping',{sender_id:1,parcel:packet})).statusCode,409);assert.equal(f.state.creates,0);}
  const f=fixture(),q=await f.quote();f.state.g.customer_name='Changed';assert.equal((await f.call('createOrderShipping',{operation_id:operationId,confirmation:'CREER_ETIQUETTE',...q})).statusCode,409);assert.equal(f.state.operations.size,0);
});
test('toutes les actions étiquettes exigent session admin et quota avant le module fournisseur',async()=>{
  for(const action of ['getOrderShipping','quoteOrderShipping','createOrderShipping','downloadOrderShippingLabel'])for(const scenario of ['denied','limited','allowed']){
    const exports={},calls=[];const shared={json:(statusCode,data)=>({statusCode,body:JSON.stringify(data)}),isConfigured:()=>true,getSupabase:()=>({}),readBody:()=>({action}),requireAdmin:async()=>({ok:scenario!=='denied'}),rateLimit:async()=>{calls.push('quota');return scenario==='limited'?{statusCode:429}:null;}};
    vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,process:{env:{}},Buffer,require:name=>name==='./shared'?shared:name==='./lib/order-shipping'?{adminOrderShipping:async()=>{calls.push('shipping');return shared.json(200,{});}}:name==='crypto'?require('node:crypto'):name==='./lib/product-assistant'?{categories:require('../public/js/categories').codes}:name==='../../public/js/product-media'?require('../public/js/product-media'):name==='../../public/js/product-sizes'?require('../public/js/product-sizes'):class Stripe{}});
    assert.equal((await exports.handler({httpMethod:'POST'})).statusCode,{denied:401,limited:429,allowed:200}[scenario]);assert.deepEqual(calls,scenario==='denied'?[]:scenario==='limited'?['quota']:['quota','shipping']);
  }
});
test('SQL local : claim unique, reprise immuable et suivi conservé sans toucher stock, paiement ou statut d’expédition',async()=>{
  const db=new PGlite();try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;alter default privileges in schema public grant all on tables to service_role;
      create function checkout_pickup_schema_version() returns integer language sql as $$select 1$$;create function admin_refunds_schema_version() returns integer language sql as $$select 1$$;
      create table orders(id uuid primary key,order_number text,status text,sale_channel text,shipping_status text,prepared_at timestamptz,refunded_cents integer,stock_issue boolean,inventory_reserved boolean,admin_archived boolean,delivery_type text,pickup_point_data jsonb,customer_name text,email text,phone text,total_cents integer,currency text,tracking_number text,carrier text);
      create table order_items(id uuid primary key,order_id uuid references orders(id),quantity integer,prepared_quantity integer,stock_debited boolean);
      create table order_refund_operations(id uuid,order_id uuid,status text);create table order_returns(id uuid,order_id uuid);create table return_requests(id uuid,order_id uuid,status text);
      create table product_variants(stock integer);insert into product_variants values(15);`);
    const sql=fs.readFileSync('supabase/migration_order_shipping.sql','utf8');await db.exec(sql);await db.exec(sql);
    await db.query("insert into orders values($1,'HN-TEST','paid','online','new',now(),0,false,false,false,'pickup',$2,'Client','client@example.test','000000',2999,'eur',null,null)",[orderId,point]);await db.query('insert into order_items values($1,$2,1,1,true)',[randomUUID(),orderId]);
    const g=(await db.query('select shipping_order_guard($1) as guard',[orderId])).rows[0].guard,request={quote:{parcel:packet}},payload={external_reference_id:'hn-label-'+operationId,order_number:'HN-TEST'};
    const claim=(id=operationId,req=request,guard=g)=>db.query('select claim_order_shipping($1,$2,$3,$4,$5) as operation',[id,orderId,req,{...payload,external_reference_id:'hn-label-'+id},guard]);
    await db.query('update order_items set prepared_quantity=0 where order_id=$1',[orderId]);await assert.rejects(claim(),/shipping_quote_changed/);await db.query('update order_items set prepared_quantity=1 where order_id=$1',[orderId]);
    await claim();await claim();assert.equal((await db.query('select count(*)::integer as n from order_shipping_operations')).rows[0].n,1);await assert.rejects(claim(randomUUID()),/shipping_order_busy/);await assert.rejects(claim(operationId,{other:'request'}),/shipping_operation_mismatch/);
    await assert.rejects(db.query("update order_shipping_operations set provider_request='{}' where id=$1",[operationId]),/shipping_operation_immutable/);
    const result={operation_id:operationId,state:'ready',shipment_id:randomUUID(),parcel_id:12345,tracking_number:'MR-TEST'};await db.query('select finish_order_shipping($1,$2)',[operationId,result]);await db.query('select finish_order_shipping($1,$2)',[operationId,result]);
    const o=(await db.query('select * from orders')).rows[0];assert.equal(o.status,'paid');assert.equal(o.shipping_status,'new');assert.equal(o.total_cents,2999);assert.equal(o.tracking_number,'MR-TEST');assert.equal((await db.query('select stock from product_variants')).rows[0].stock,15);
    const other=randomUUID(),failedId=randomUUID();await db.query("insert into orders values($1,'HN-FAILED','paid','online','new',now(),0,false,false,false,'pickup',$2,'Client','client@example.test','000000',2999,'eur',null,null)",[other,point]);await db.query('insert into order_items values($1,$2,1,1,true)',[randomUUID(),other]);
    const otherGuard=(await db.query('select shipping_order_guard($1) as guard',[other])).rows[0].guard;
    const otherClaim=id=>db.query('select claim_order_shipping($1,$2,$3,$4,$5)',[id,other,request,{external_reference_id:'hn-label-'+id,order_number:'HN-FAILED'},otherGuard]);
    await otherClaim(failedId);await db.query('select finish_order_shipping($1,$2)',[failedId,{operation_id:failedId,state:'failed',shipment_id:randomUUID(),parcel_id:12346}]);await otherClaim(randomUUID());
    assert.equal((await db.query('select tracking_number from orders where id=$1',[other])).rows[0].tracking_number,null);
    await assert.rejects(db.query("update order_shipping_operations set state='pending' where id=$1",[failedId]),/shipping_operation_immutable/);
    assert.equal((await db.query("select has_table_privilege('service_role','order_shipping_operations','delete') as allowed")).rows[0].allowed,false);assert.equal((await db.query("select has_function_privilege('anon','claim_order_shipping(uuid,uuid,jsonb,jsonb,jsonb)','execute') as allowed")).rows[0].allowed,false);
  }finally{await db.close();}
});
