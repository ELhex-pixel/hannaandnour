const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const {randomUUID}=require('node:crypto');
const activity=require('../netlify/functions/lib/activity-periods');
const {salesReport,adminSales}=require('../netlify/functions/lib/admin-sales');
const {summarize,adminAnalytics}=require('../netlify/functions/lib/admin-analytics');
const cut='2026-10-20T12:00:00.123456+00:00',period=randomUUID(),currency={code:'eur',symbol:'€'};
const windows={current:{id:period,scope:'current',start:cut,end:null},history:{id:period,scope:'history',start:null,end:cut}};
function order(time){return{paid_at:time,status:'paid',currency:'eur',sale_channel:'physical',total_cents:1500,subtotal_cents:1000,discount_cents:0,refunded_cents:200,order_items:[{id:'i',product_slug:'veste',quantity:2,unit_price_cents:500,net_total_cents:1000,order_item_costs:null}],order_returns:[{order_item_id:'i',quantity:1,total_refund_cents:500,sellable_quantity:1}]};}
test('tous les compteurs, classements et produits vendus partagent la coupure exacte, y compris les microsecondes',()=>{
  const before='2026-10-20T12:00:00.123455Z',at='2026-10-20T12:00:00.123456Z',after='2026-10-20T12:00:00.123457Z';
  for(const [time,inCurrent] of [[before,false],[at,true],[after,true]]){assert.equal(activity.includes(time,windows.current),inCurrent);assert.equal(activity.includes(time,windows.history),!inCurrent);}
  const now=new Date('2026-10-21T12:00:00Z'),old=[order(before)];
  const reset=salesReport(old,[],'all',5,currency,now,windows.current),history=salesReport(old,[],'all',5,currency,now,windows.history);
  for(const field of ['orders','unitsSold','returnedUnits','revenueCents','refundedCents','netRevenueCents','purchaseMissingUnits','purchaseKnownCents','physicalOrders','onlineOrders'])assert.equal(reset.totals[field],0,field);
  assert.equal(reset.products.length,0);assert(reset.monthly.every(m=>m.revenueCents===0&&m.unitsSold===0&&m.returnedUnits===0));assert.equal(history.totals.orders,1);assert.equal(history.totals.purchaseCents,null);assert.equal(history.products[0].sold,2);
  const events=[{created_at:before,event_type:'pageview',path:'/shop'},{created_at:before,event_type:'product_view',product_slug:'veste'}];
  const visits=summarize(events,now.getTime(),windows.current);assert.equal(visits.all.counts.pageview,0);assert.equal(visits.all.counts.product_view,0);assert.deepEqual(visits.all.topPaths,[]);assert.deepEqual(visits.all.topProducts,[]);
  assert.equal(summarize(events,now.getTime(),windows.history).all.topProducts[0].views,1);
  const newSales=salesReport(old.concat(order(at)),[],'all',5,currency,now,windows.current);assert.equal(newSales.totals.orders,1);assert.equal(newSales.totals.unitsSold,2);assert.equal(newSales.totals.revenueCents,1500);
});
const apiCut=new Date(Date.now()-3600000).toISOString();
function database(head={id:period,started_at:apiCut}){
  const bounds=[],reads=[];
  const orders=[order(new Date(Date.now()-7200000).toISOString()),order(new Date(Date.now()-1800000).toISOString())],events=orders.map((o,i)=>({created_at:o.paid_at,event_type:'pageview',path:i?'/cart':'/shop'}));
  const sb={from(table){reads.push(table);return{select(){return this;},eq(){return this;},not(){return this;},in(){return this;},order(){return this;},gte(column,value){bounds.push([table,'gte',column,value]);return this;},lt(column,value){bounds.push([table,'lt',column,value]);return this;},async limit(){return{data:head?[head]:[]};},async maybeSingle(){return{data:null};},async range(){return{data:table==='orders'?orders:table==='analytics_events'?events:[]};}};}};
  return{sb,bounds,reads};
}
test('ventes et visites imposent le même périmètre avant pagination, et une période périmée échoue au lieu d’afficher un faux zéro',async()=>{
  const db=database(),body={period:'all',currency:'eur',reporting_scope:'current',expected_reporting_period:period};
  const sales=JSON.parse((await adminSales(db.sb,body)).body),visits=JSON.parse((await adminAnalytics(db.sb,body)).body);
  assert.equal(sales.totals.orders,1);assert.equal(visits.summary.all.counts.pageview,1);assert.deepEqual(sales.reporting,visits.reporting);assert(db.bounds.some(b=>b[0]==='orders'&&b[1]==='gte'&&b[3]===apiCut));assert(db.bounds.some(b=>b[0]==='analytics_events'&&b[1]==='gte'&&b[3]===apiCut));
  const bad=await adminSales(db.sb,{...body,expected_reporting_period:'initial'});assert.equal(bad.statusCode,409);assert.equal(JSON.parse(bad.body).code,'activity_period_changed');assert.equal(JSON.parse(bad.body).totals,undefined);
  const initial=database(null);const empty=JSON.parse((await adminAnalytics(initial.sb,{reporting_scope:'history'})).body);assert.equal(empty.summary.all.counts.pageview,0);assert(!initial.reads.includes('analytics_events'));
});
test('les nouvelles actions exigent session admin et quota avant toute lecture ou nouvelle période',async()=>{
  for(const action of ['getActivityPeriod','startActivityPeriod'])for(const scenario of ['denied','limited','allowed']){
    const exports={},calls=[];
    const shared={json:(statusCode,data)=>({statusCode,body:JSON.stringify(data)}),isConfigured:()=>true,getSupabase:()=>({}),readBody:()=>({action}),requireAdmin:async()=>({ok:scenario!=='denied'}),rateLimit:async()=>{calls.push('quota');return scenario==='limited'?{statusCode:429}:null;}};
    vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,process:{env:{}},Buffer,require:name=>name==='./shared'?shared:name==='./lib/activity-periods'?{adminActivityPeriods:async()=>{calls.push('period');return shared.json(200,{});}}:name==='crypto'?require('node:crypto'):name==='./lib/product-assistant'?{categories:require('../public/js/categories').codes}:name==='../../public/js/product-media'?require('../public/js/product-media'):name==='../../public/js/product-sizes'?require('../public/js/product-sizes'):class Stripe{}});
    assert.equal((await exports.handler({httpMethod:'POST'})).statusCode,{denied:401,limited:429,allowed:200}[scenario]);assert.deepEqual(calls,scenario==='denied'?[]:scenario==='limited'?['quota']:['quota','period']);
  }
});
test('migration locale rejouable : nouvelle coupure idempotente, concurrence protégée, historique et données métier conservés',async()=>{
  const db=new PGlite();try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create function commerce_schema_version() returns integer language sql as $$select 1$$;create table orders(id integer,status text,total_cents integer);insert into orders values(1,'paid',41262);create table analytics_events(id integer);insert into analytics_events values(1);create table product_variants(id integer,stock integer);insert into product_variants values(1,15);");
    await db.exec('alter default privileges in schema public grant all on tables to service_role;');
    const sql=fs.readFileSync('supabase/migration_activity_periods.sql','utf8');await db.exec(sql);await db.exec(sql);
    assert.equal((await db.query('select count(*)::integer as n from admin_activity_periods')).rows[0].n,0);
    const a=randomUUID(),b=randomUUID();const invoke=(id,previous,reason='Nouvelle activité')=>db.query("select start_admin_activity_period($1,$2,$3,'NOUVELLE_PERIODE') as result",[id,previous,reason]);
    const first=(await invoke(a,null)).rows[0].result;const repeat=(await invoke(a,null)).rows[0].result;assert.equal(repeat.started_at,first.started_at);assert.equal(repeat.already,true);
    const second=(await invoke(b,a)).rows[0].result;assert(Date.parse(second.started_at)>=Date.parse(first.started_at));await assert.rejects(invoke(randomUUID(),a),/activity_period_changed/);await assert.rejects(invoke(a,null,'Motif différent'),/activity_period_operation_mismatch/);
    await invoke(a,null);assert.equal((await db.query('select id from admin_activity_periods order by started_at desc limit 1')).rows[0].id,b);
    assert.equal((await db.query('select count(*)::integer as n from admin_activity_periods')).rows[0].n,2);assert.deepEqual((await db.query('select * from orders')).rows,[{id:1,status:'paid',total_cents:41262}]);assert.equal((await db.query('select stock from product_variants')).rows[0].stock,15);assert.equal((await db.query('select count(*)::integer as n from analytics_events')).rows[0].n,1);
    assert.equal((await db.query("select has_function_privilege('anon','start_admin_activity_period(uuid,uuid,text,text)','execute') as allowed")).rows[0].allowed,false);assert.equal((await db.query("select has_table_privilege('service_role','admin_activity_periods','delete') as allowed")).rows[0].allowed,false);
  }finally{await db.close();}
});
