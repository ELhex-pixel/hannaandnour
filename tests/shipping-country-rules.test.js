const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const R=require('../public/js/shipping-rules'),commerce=require('../public/js/commerce'),backend=require('../netlify/functions/lib/commerce');
const {adminShippingRules}=require('../netlify/functions/lib/shipping-rules');
const clone=value=>JSON.parse(JSON.stringify(value));
function sample(){const rules=R.initial({standard_cents:599,pickup_cents:599,express_cents:1500,nextday_cents:2000});rules.countries.NL.standard.fee_cents=1599;rules.countries.NL.pickup.fee_cents=712;return rules;}

test('les sept pays sont configurables, les nouveaux restent sans tarif et le standard ne devient jamais gratuit au seuil',()=>{
  const rules=sample();assert.deepEqual(R.countries,['FR','BE','NL','DE','ES','IT','DZ']);
  for(const c of ['DE','IT','DZ']){assert.equal(rules.countries[c].enabled,false);for(const m of R.methods){assert.equal(rules.countries[c][m].enabled,false);assert.equal(rules.countries[c][m].fee_cents,null);}}
  for(const c of R.pickupCountries)assert.equal(rules.countries[c].pickup.free_enabled,true);
  for(const c of ['FR','BE','NL','ES'])for(const subtotal of [1,7999,8000,8500,20000]){
    assert.equal(R.price(rules,c,'standard',subtotal),c==='NL'?1599:599);
    assert.equal(R.price(rules,c,'pickup',subtotal),subtotal>=8000?0:c==='NL'?712:599);
  }
  const settings={tax_rate:0,shipping_rules:rules};
  const discounted=commerce.calculate([{price_cents:8500,qty:1}],settings,'pickup',10,'NL');
  assert.deepEqual(discounted,{subtotal:8500,discount:850,shipping:0,tax:0,total:7650});
  assert.equal(commerce.calculate([{price_cents:8500,qty:1}],settings,'standard',10,'NL').total,9249);
  rules.countries.NL.pickup.free_enabled=false;assert.equal(R.price(rules,'NL','pickup',20000),712);
  rules.countries.NL.pickup.free_enabled=true;rules.countries.NL.pickup.free_threshold_cents=12000;assert.equal(R.price(rules,'NL','pickup',8500),712);
  rules.countries.NL.enabled=false;assert.throws(()=>R.price(rules,'NL','standard',8500),/unavailable/);
  rules.countries.FR.express.enabled=false;assert.throws(()=>R.price(rules,'FR','express',8500));
  for(const country of ['US','UK','ZZ','',null])assert.throws(()=>R.price(rules,country,'standard',8500));
});

test('pas de gratuité par tarif vide, zéro ou règle forgée ; chaque mode activé exige un prix positif',()=>{
  for(const fee of [null,undefined,0,-1,1.2,'599',true,100000001]){const rules=sample();rules.countries.FR.standard.fee_cents=fee;assert.throws(()=>R.clean(rules));}
  for(const threshold of [null,0,-1,1.2,'8000']){const rules=sample();rules.countries.FR.pickup.free_threshold_cents=threshold;assert.throws(()=>R.clean(rules));}
  const dz=sample();dz.countries.DZ.enabled=true;dz.countries.DZ.pickup.enabled=true;dz.countries.DZ.pickup.fee_cents=800;assert.throws(()=>R.clean(dz),/Pickup/);
  const standard=sample();standard.countries.FR.standard.free_enabled=true;standard.countries.FR.standard.free_threshold_cents=1;
  assert.equal(R.price(R.clean(standard),'FR','standard',20000),599);
  const malformed=sample();delete malformed.countries.FR;malformed.countries.US={};assert.throws(()=>R.clean(malformed));
});

function quoteDb(rules){
  const state={rules:clone(rules),reads:0};
  const sb={from(table){const q={select(){state.reads++;return this;},in(){return this;},eq(){return this;},then(resolve){return Promise.resolve({data:table==='settings'?[{key:'shipping',value:{tax_rate:0,standard_cents:599,pickup_cents:599}},{key:'shipping_rules',value:state.rules},{key:'currency',value:{code:'eur'}},{key:'cart_offer',value:{enabled:true,percent_off:10}}]:table==='products'?[{id:'p',slug:'fixture',price_cents:8500,active:true,name_fr:'Fixture'}]:[]}).then(resolve);}};return q;}};
  return{state,sb};
}
test('le devis serveur relit le pays et les règles, ignore les prix forgés et refuse les destinations/modes décochés',async()=>{
  const f=quoteDb(sample()),body={items:[{slug:'fixture',qty:1}],country:'NL',shipping_method:'pickup',shipping_cents:0,free_threshold_cents:1};
  const q=await backend.quote(f.sb,body);assert.equal(q.totals.total,7650);assert.equal(q.shipping.country,'NL');assert.equal(q.shipping.methods.standard,1599);assert.equal(q.shipping.methods.pickup,0);
  f.state.rules.countries.NL.pickup.free_enabled=false;assert.equal((await backend.quote(f.sb,body)).totals.shipping,712);
  f.state.rules.countries.NL.pickup.fee_cents=999;assert.equal((await backend.quote(f.sb,body)).totals.shipping,999);
  f.state.rules.countries.NL.pickup.enabled=false;await assert.rejects(backend.quote(f.sb,body),/Shipping unavailable/);
  f.state.rules.countries.NL.enabled=false;await assert.rejects(backend.quote(f.sb,{...body,shipping_method:'standard'}),/Shipping unavailable/);
  await assert.rejects(backend.quote(f.sb,{...body,country:'US',shipping_method:'standard'}),/Shipping unavailable/);
  await assert.rejects(backend.quote(f.sb,{...body,country:'FR',pickup:{country_code:'BE'}}),/Shipping unavailable/);
  const exposed=backend.publicQuote(q);assert.equal(exposed.shipping.country,'NL');assert(!JSON.stringify(exposed).includes('revision'));
});

test('le paiement refuse un pays décoché et les codes postaux hors zone avant toute session bancaire',async()=>{
  const f=quoteDb(sample()),exports={};let stripe=0;
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,getSupabase:()=>f.sb,readBody:e=>JSON.parse(e.body),rateLimit:async()=>null,getBearer:()=>'',siteUrl:'https://example.test'};
  vm.runInNewContext(fs.readFileSync('netlify/functions/checkout.js','utf8'),{exports,process:{env:{STRIPE_SECRET_KEY:'fixture'}},console:{error(){}},require:name=>name==='crypto'?crypto:name==='stripe'?class{constructor(){stripe++;throw Error('No real provider');}}:name==='./shared'?shared:name==='./lib/customer-email'?{locale:()=> 'fr'}:name==='../../public/js/pickup-points'?require('../public/js/pickup-points'):backend});
  const body={items:[{slug:'fixture',qty:1}],country:'FR',shipping_method:'standard',email:'fixture@example.test',customer_name:'Fixture',address1:'Rue test',city:'Paris',postal_code:'97100'};
  const q=await backend.quote(f.sb,body);body.expected_total_cents=q.totals.total;body.expected_currency=q.currency.code;body.expected_policy_version=q.return_policy.version;
  for(const extra of [{postal_code:'97100'},{postal_code:'00000'},{postal_code:'75000',country:'US'},{postal_code:'10115',country:'DE'}]){
    const result=await exports.handler({httpMethod:'POST',body:JSON.stringify({...body,...extra})});assert.equal(result.statusCode,400);assert.equal(stripe,0);
  }
});

function adminDb(){
  const state={row:null,writes:0,lost:false,legacy:{standard_cents:599,pickup_cents:599,tax_rate:0.2,show_tax:false},tables:[]};
  const sb={from(table){state.tables.push(table);assert.equal(table,'settings');let key,expected,write;
    const q={select(){return this;},eq(field,value){if(field==='key')key=value;if(field==='value->>revision')expected=value;return this;},insert(value){key=value.key;write=value;return this;},update(value){write=value;return this;},async maybeSingle(){
      if(!write)return{data:key==='shipping_rules'?state.row?{value:clone(state.row)}:null:{value:clone(state.legacy)}};
      if(state.row&&expected===undefined)return{error:{code:'23505'}};
      if(state.row&&state.row.revision!==expected)return{data:null};
      state.writes++;state.row=clone(write.value);if(state.lost){state.lost=false;throw Error('Lost response');}return{data:{value:clone(state.row)}};
    }};return q;}};return{state,sb};
}
test('les réglages par pays gardent la taxe, refusent un éditeur périmé et reprennent la même opération après réponse perdue',async()=>{
  const f=adminDb(),first=JSON.parse((await adminShippingRules(f.sb,'getShippingRules',{})).body);assert.equal(first.revision,null);assert.equal(f.state.writes,0);
  const payload={rules:sample(),operation_id:crypto.randomUUID(),expected_revision:null};
  f.state.lost=true;assert.equal((await adminShippingRules(f.sb,'saveShippingRules',payload)).statusCode,503);assert.equal(f.state.writes,1);
  const retry=await adminShippingRules(f.sb,'saveShippingRules',payload);assert.equal(retry.statusCode,200);assert.equal(JSON.parse(retry.body).already,true);assert.equal(f.state.writes,1);
  const stale=await adminShippingRules(f.sb,'saveShippingRules',{...payload,operation_id:crypto.randomUUID()});assert.equal(stale.statusCode,409);assert.equal(f.state.writes,1);
  const changed=clone(payload);changed.rules.countries.FR.standard.fee_cents=799;assert.equal((await adminShippingRules(f.sb,'saveShippingRules',changed)).statusCode,409);
  const next={...changed,operation_id:crypto.randomUUID(),expected_revision:payload.operation_id};assert.equal((await adminShippingRules(f.sb,'saveShippingRules',next)).statusCode,200);assert.equal(f.state.row.countries.FR.standard.fee_cents,799);assert.equal(f.state.writes,2);assert.deepEqual(f.state.legacy,{standard_cents:599,pickup_cents:599,tax_rate:0.2,show_tax:false});
  const bad=sample();bad.countries.FR.standard.fee_cents=null;assert.equal((await adminShippingRules(f.sb,'saveShippingRules',{...next,rules:bad})).statusCode,400);assert.equal(f.state.writes,2);
});

test('les fonctions de réglage exigent la session admin et le quota avant toute lecture ou écriture',async()=>{
  for(const limited of [false,true]){
    const exports={},state={reads:0,limits:0};
    const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,getSupabase:()=>({from(){state.reads++;throw Error('Unexpected read');}}),readBody:e=>JSON.parse(e.body),requireAdmin:async()=>({ok:limited}),rateLimit:async()=>{state.limits++;return{statusCode:429};}};
    vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,Buffer,process:{env:{}},console:{error(){}},require:name=>name==='./shared'?shared:name==='crypto'?crypto:{}});
    for(const action of ['getShippingRules','saveShippingRules'])assert.equal((await exports.handler({httpMethod:'POST',body:JSON.stringify({action})})).statusCode,limited?429:401);
    assert.equal(state.reads,0);assert.equal(state.limits,limited?2:0);
  }
});

test('migration réelle rejouable : snapshots DE/IT acceptés, identité transporteur conservée et anciens frais inchangés',async()=>{
  const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role;create function commerce_schema_version()returns integer language sql as $$select 1$$;create table orders(id integer primary key,delivery_type text,country text,pickup_point text,total_cents integer);insert into orders values(1,'pickup','FR','Ancien relais',1234);");
    await db.exec(fs.readFileSync('supabase/migration_checkout_pickup.sql','utf8'));
    const sql=fs.readFileSync('supabase/migration_shipping_country_rules.sql','utf8');await db.exec(sql);await db.exec(sql);
    const point=c=>({id:1000001,carrier:'mondial_relay',carrier_service_point_id:c+'-001',name:'Fixture',type:'locker',fingerprint:'a'.repeat(64),address:{country_code:c,street:'Rue',city:'Ville',postal_code:c==='DE'?'10115':'00118'},availability_checked_at:'2026-10-25T12:00:00.000Z'});
    for(const[id,c]of [[2,'DE'],[3,'IT']])await db.query("insert into orders(id,delivery_type,country,pickup_point_data)values($1,'pickup',$2,$3)",[id,c,point(c)]);
    for(const bad of [point('DZ'),{...point('DE'),carrier:'chronopost'},{...point('DE'),fingerprint:null}])await assert.rejects(db.query("insert into orders(id,delivery_type,country,pickup_point_data)values(4,'pickup','DE',$1)",[bad]));
    await assert.rejects(db.query('update orders set pickup_point_data=null where id=2'),/immutable/);
    assert.equal((await db.query('select total_cents from orders where id=1')).rows[0].total_cents,1234);
    assert.equal((await db.query("select has_function_privilege('anon','shipping_country_rules_schema_version()','execute')as ok")).rows[0].ok,false);
  }finally{await db.close();}
});
