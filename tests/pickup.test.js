const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const rules=require('../public/js/pickup-points');

test('les pays et codes postaux relais sont bornés sans confondre identifiant et adresse libre',()=>{
  assert.deepEqual(rules.countries,['FR','BE','ES','NL']);assert.equal(rules.postal('NL','1234ab'),'1234 AB');assert.equal(rules.postal('FR','97100'),'');assert.equal(rules.postal('BE','1000'),'1000');
  for(const value of [null,{},'Relais texte',{id:1,country_code:'NL'},{id:1,country_code:'US',fingerprint:'a'.repeat(64)}])assert.equal(rules.selection(value),false);
});
function publicHandler({limited=false,disabled=false,failed=false}={}){
  const exports={},state={provider:0,limits:0,reads:0};
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),CORS_HEADERS:{},isConfigured:()=>true,getSupabase:()=>({from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){state.reads++;return{data:{value:{pickup_enabled:!disabled}}};}})}),rateLimit:async(_,event,scope)=>{state.limits++;assert.equal(scope,'service-points');return limited?{statusCode:429}:null;}};
  vm.runInNewContext(fs.readFileSync('netlify/functions/service-points.js','utf8'),{exports,require:name=>name==='./shared'?shared:name==='../../public/js/pickup-points'?rules:{createClient:()=>({checkoutPoints:async body=>{state.provider++;if(failed)throw new Error('private-secret');return{points:[],country:body.country_code};}})}});
  return{handler:exports.handler,state};
}
test('la recherche publique respecte méthode, pays, activation et quota avant Sendcloud, sans données privées',async()=>{
  for(const [scenario,status] of [[{},200],[{limited:true},429],[{disabled:true},409],[{failed:true},503]]){
    const mock=publicHandler(scenario),result=await mock.handler({httpMethod:'GET',queryStringParameters:{country_code:'NL',postal_code:'1234 AB'}});assert.equal(result.statusCode,status);assert.equal(mock.state.provider,scenario.limited||scenario.disabled?0:1);assert(!String(result.body).includes('private-secret'));
  }
  const mock=publicHandler();assert.equal((await mock.handler({httpMethod:'GET',queryStringParameters:{country_code:'US',postal_code:'10001'}})).statusCode,400);assert.equal((await mock.handler({httpMethod:'POST'})).statusCode,405);assert.equal(mock.state.limits,0);assert.equal(mock.state.reads,0);assert.equal(mock.state.provider,0);
});
test('migration locale rejouable : ancien retrait conservé, snapshot relais valide et immuable, droits privés',async()=>{
  const db=new PGlite();try{
    await db.exec("create role anon;create role authenticated;create role service_role;create function commerce_schema_version() returns integer language sql as $$select 1$$;create table orders(id integer primary key,delivery_type text,country text,pickup_point text,total_cents integer);insert into orders values(1,'pickup','FR','Ancien retrait',1234);");
    const sql=fs.readFileSync('supabase/migration_checkout_pickup.sql','utf8');await db.exec(sql);await db.exec(sql);
    const old=(await db.query('select * from orders where id=1')).rows[0];assert.equal(old.pickup_point,'Ancien retrait');assert.equal(old.total_cents,1234);assert.equal(old.pickup_point_data,null);
    const point={id:1000001,carrier:'mondial_relay',carrier_service_point_id:'NL-001',name:'Relais',type:'locker',fingerprint:'a'.repeat(64),address:{country_code:'NL',street:'Rue',city:'Ville',postal_code:'1234 AB'},availability_checked_at:'2026-10-20T12:00:00.000Z'};
    await db.query("insert into orders(id,delivery_type,country,pickup_point_data) values(2,'pickup','NL',$1)",[point]);
    for(const bad of [{},{...point,id:-1},{...point,address:{...point.address,country_code:'US'}},{...point,availability_checked_at:null}])await assert.rejects(db.query("insert into orders(id,delivery_type,country,pickup_point_data) values(3,'pickup','NL',$1)",[bad]));
    await assert.rejects(db.query('update orders set pickup_point_data=null where id=2'),/pickup_snapshot_immutable/);
    await db.query('update orders set total_cents=599 where id=2');assert.equal((await db.query('select pickup_point_data from orders where id=2')).rows[0].pickup_point_data.id,1000001);
    assert.equal((await db.query("select has_function_privilege('anon','checkout_pickup_schema_version()','execute') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('service_role','checkout_pickup_schema_version()','execute') as allowed")).rows[0].allowed,true);
  }finally{await db.close();}
});
