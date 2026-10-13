const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const vm=require('node:vm');
const {stockApp}=require('../netlify/functions/lib/stock-app');
test('la vente physique exige une confirmation et ne fait qu’une RPC avec les identifiants et quantités bornés',async()=>{
  const id=randomUUID(),op=randomUUID(),calls=[];
  const sb={rpc:async(name,args)=>{calls.push({name,args});return {data:{operation_id:op,total_cents:1200,currency:'eur',order_number:'HN-P-LOCAL'}};}};
  const body={operation_id:op,items:[{variant_id:id,quantity:1}],quote:{total_cents:1200,currency:'eur'},note:'',payment_method:'cash',confirmation:'ENCAISSE'};
  assert.equal((await stockApp(sb,'recordPhysicalSale',{...body,confirmation:''})).statusCode,400);assert.equal(calls.length,0);
  assert.equal((await stockApp(sb,'recordPhysicalSale',{...body,items:[{variant_id:id,quantity:1.5}]})).statusCode,400);
  assert.equal((await stockApp(sb,'recordPhysicalSale',body)).statusCode,200);assert.equal(calls[0].name,'record_physical_sale');assert.equal(calls[0].args.p_operation,op);
  sb.rpc=async()=>({error:{message:'physical_quote_changed',details:'private'}});
  const failure=await stockApp(sb,'recordPhysicalSale',body);assert.equal(failure.statusCode,409);assert.doesNotMatch(failure.body,/private/);
  sb.rpc=async()=>({data:{operation_id:op,total_cents:1,currency:'eur'}});assert.equal((await stockApp(sb,'recordPhysicalSale',body)).statusCode,503);
});
test('un code QR ou code-barres ne déclenche qu’une lecture et refuse les valeurs étrangères',async()=>{
  const id=randomUUID(),calls=[];
  const sb={from:table=>({select(){assert.equal(table,'product_variants');return this;},eq(field,value){calls.push([field,value]);return this;},maybeSingle:async()=>({data:{id,stock:5}})})};
  assert.equal((await stockApp(sb,'stockLookup',{kind:'qr',code:'https://foreign.test/'})).statusCode,400);assert.equal(calls.length,0);
  assert.equal((await stockApp(sb,'stockLookup',{kind:'qr',code:id})).statusCode,200);assert.deepEqual(calls[0],['id',id]);
  assert.equal((await stockApp(sb,'stockLookup',{kind:'barcode',code:'HN0000001'})).statusCode,200);assert.deepEqual(calls[1],['barcode','HN0000001']);
});
test('les nouvelles actions demandent la session admin et le quota avant le module',async()=>{
  for(const action of ['stockLookup','quotePhysicalSale','recordPhysicalSale','listPhysicalSales','listStockVariants'])for(const allowed of [false,true]){
    const exports={},calls=[];
    const shared={json:(statusCode,data)=>({statusCode,body:JSON.stringify(data)}),isConfigured:()=>true,getSupabase:()=>({}),readBody:()=>({action}),requireAdmin:async()=>({ok:allowed}),rateLimit:async()=>{calls.push('limit');return null;}};
    vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,process:{env:{}},Buffer,require:name=>name==='./shared'?shared:name==='./lib/stock-app'?{stockApp:async()=>{calls.push('module');return shared.json(200,{});}}:name==='crypto'?require('node:crypto'):name==='./lib/product-assistant'?{categories:require('../public/js/categories').codes}:name==='../../public/js/product-media'?require('../public/js/product-media'):name==='../../public/js/product-sizes'?require('../public/js/product-sizes'):class Stripe{}});
    assert.equal((await exports.handler({httpMethod:'POST'})).statusCode,allowed?200:401);assert.deepEqual(calls,allowed?['limit','module']:[]);
  }
});
