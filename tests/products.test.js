const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function catalogue(count, rows = [{ id: 'test-product', slug: 'cape', product_variants: [] }]) {
  const exports = {}, state = { filters: [], range: null };
  const query = { select(columns) { state.columns = columns; return this; }, in(key, values) { state.filters.push([key,Array.from(values)]);return this; }, eq(key,value) {state.filters.push([key,value]);return this;},order(){return this;},range(start,end){state.range=[start,end];return this;},
    abortSignal(){return this;},then(resolve,reject){return Promise.resolve({data:rows,error:null,count}).then(resolve,reject);} };
  const sb = { rpc(name,args,options) {
    if(name === 'product_review_stats')return Promise.resolve({ data: [], error:null });
    assert.equal(name,'search_products'); state.args=args;state.options=options;
    assert.equal(options.count,'exact');return query;
  } };
  vm.runInNewContext(fs.readFileSync('netlify/functions/products.js','utf8'), { exports,AbortSignal,require:name=>name==='../../public/js/catalog-selection'?require('../public/js/catalog-selection'):({json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),getSupabase:()=>sb,isConfigured:()=>true,CORS_HEADERS:{}}) });
  return { handler:exports.handler,state };
}
test('le comptage exact est demandé sur la RPC et non sur select ; un produit ne donne plus total zéro',async()=>{
  const mock=catalogue(1), response=await mock.handler({httpMethod:'GET',queryStringParameters:{limit:'1'}});
  assert.equal(response.statusCode,200);const body=JSON.parse(response.body);
  assert.equal(body.products.length,1);assert.equal(body.total,1);assert.equal(body.has_more,false);
});
test('total et pagination suivent les mêmes filtres, y compris sur une page vide',async()=>{
  const mock=catalogue(49), response=await mock.handler({httpMethod:'GET',queryStringParameters:{page:'1',limit:'48',category:'jacket',sizes:'M',slug:'cape',bestseller:'true'}});
  assert.equal(JSON.parse(response.body).has_more,true);assert.deepEqual(mock.state.range,[0,47]);
  assert.equal(mock.state.args.p_categories[0],'jacket');assert.equal(mock.state.args.p_sizes[0],'M');
  assert.deepEqual(mock.state.filters,[['slug',['cape']],['is_bestseller',true]]);
  const last=catalogue(49);const body=JSON.parse((await last.handler({httpMethod:'GET',queryStringParameters:{page:'2',limit:'48'}})).body);
  assert.equal(body.total,49);assert.equal(body.has_more,false);assert.deepEqual(last.state.range,[48,95]);
  const empty=catalogue(0,[]);assert.equal(JSON.parse((await empty.handler({httpMethod:'GET'})).body).total,0);
});
test('une absence de compteur est une erreur de service, jamais un faux catalogue vide',async()=>{
  const mock=catalogue(null);assert.equal((await mock.handler({httpMethod:'GET'})).statusCode,500);
});
test('le catalogue transporte les variantes une seule fois tout en conservant leur stock et état réels',async()=>{
  const variants=[{id:'v',stock:3,active:true},{id:'old',stock:10,active:false}];
  const mock=catalogue(1,[{id:'p',slug:'veste',price_cents:1000,product_variants:variants}]);
  const product=JSON.parse((await mock.handler({httpMethod:'GET'})).body).products[0];
  assert.equal(Object.hasOwn(product,'product_variants'),false);assert.deepEqual(product.variants,variants);assert.equal(product.price_cents,1000);
});
test('Nouveautés et Promotions filtrent avant pagination avec un total exact et aucun prix de promotion inventé',async()=>{
  const rows=[{id:'a',slug:'new-one',badge:'New',price_cents:2000,compare_at_price_cents:null},{id:'b',slug:'new-two',badge:'Nouveau',price_cents:3000,compare_at_price_cents:4000},{id:'c',slug:'sale-only',badge:'',price_cents:1000,compare_at_price_cents:2000},{id:'d',slug:'false-sale',badge:'Sale',price_cents:2000,compare_at_price_cents:1000}];
  for(const [selection,expected] of [['new',['new-one','new-two']],['sale',['new-two','sale-only']]]){
    for(const page of [1,2,3]){
      const mock=catalogue(rows.length,rows),response=await mock.handler({httpMethod:'GET',queryStringParameters:{collection:selection,limit:'1',page:String(page)}});assert.equal(response.statusCode,200);const body=JSON.parse(response.body);assert.equal(body.total,2);assert.equal(body.has_more,page===1);assert.deepEqual(body.products.map(p=>p.slug),expected.slice(page-1,page));assert.deepEqual(mock.state.range,[0,499]);
    }
  }
  const empty=catalogue(1,[rows[3]]);assert.equal(JSON.parse((await empty.handler({httpMethod:'GET',queryStringParameters:{collection:'sale'}})).body).total,0);
  const bounded=catalogue(2001,rows);assert.equal((await bounded.handler({httpMethod:'GET',queryStringParameters:{collection:'sale'}})).statusCode,500);
  const invalid=catalogue(1,rows);assert.equal((await invalid.handler({httpMethod:'GET',queryStringParameters:{collection:'anything'}})).statusCode,400);
});
