const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const prices=require('../public/js/stock-prices');
const {stockApp}=require('../netlify/functions/lib/stock-app');
test('les prix acceptent virgule et point sans arrondi de centimes ni valeur vide inventée',()=>{
  for(const [text,cents] of [['7,50',750],['12.99',1299],['0',0],['15',1500],['1,2',120],['1000000',100000000]])assert.equal(prices.parse(text),cents);
  for(const text of ['',null,'-1','1,999','1e2','Infinity','10 €','1000000,01','0x10'])assert.equal(prices.parse(text),null);
});
test('un prix personnalisé est transmis, le prix catalogue conserve le format historique et les identifiants',()=>{
  const id=randomUUID();
  assert.deepEqual(prices.item({variant_id:id,quantity:2,price_override:false,price_text:'10.00'}),{variant_id:id,quantity:2});
  assert.deepEqual(prices.item({variant_id:id,quantity:2,price_override:true,price_text:'7,50',price_note:' Remise magasin '}),{variant_id:id,quantity:2,unit_price_cents:750,price_note:'Remise magasin'});
  assert.throws(()=>prices.item({variant_id:id,quantity:1,price_override:true,price_text:'',price_note:''}),/prix de vente/);
});
test('le serveur refuse les prix invalides avant RPC et conserve le format des anciennes tentatives',async()=>{
  const id=randomUUID(),calls=[];const sb={rpc:async(name,args)=>{calls.push({name,args});return{data:{total_cents:0}};}};
  for(const value of [-1,1.5,'700',100000001,null])assert.equal((await stockApp(sb,'quotePhysicalSale',{items:[{variant_id:id,quantity:1,unit_price_cents:value}]})).statusCode,400);
  assert.equal(calls.length,0);
  assert.equal((await stockApp(sb,'quotePhysicalSale',{items:[{variant_id:id,quantity:2,unit_price_cents:700,price_note:'Promo magasin'}]})).statusCode,200);
  assert.deepEqual(calls[0].args.p_items,[{variant_id:id,quantity:2,unit_price_cents:700,price_note:'Promo magasin'}]);
  await stockApp(sb,'quotePhysicalSale',{items:[{variant_id:id,quantity:1}]});assert.deepEqual(calls[1].args.p_items,[{variant_id:id,quantity:1}]);
});
test('la recherche des étiquettes reste paginée et recherche les modèles et variantes avec un filtre sûr',async()=>{
  const id=randomUUID(),calls=[];
  const sb={from:table=>({select(fields){calls.push([table,'select',fields]);return this;},eq(){return this;},is(){return this;},or(value){calls.push([table,'or',value]);return this;},order(){return this;},limit:async()=>({data:[{id}]}),range:async(a,b)=>{calls.push(['range',a,b]);return{data:[],count:21};}})};
  const result=await stockApp(sb,'listStockVariants',{query:'Noir,(*)',page:2});assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).total,21);assert.deepEqual(calls.at(-1),['range',20,39]);
  assert(calls.some(c=>c[0]==='products'&&c[1]==='or'));assert(calls.some(c=>c[0]==='product_variants'&&c[1]==='or'&&c[2].includes(id)));
  assert(!calls.find(c=>c[0]==='product_variants'&&c[1]==='or')[2].includes('One Size'));
  calls.length=0;await stockApp(sb,'listStockVariants',{query:'Taille unique'});assert(calls.find(c=>c[0]==='product_variants'&&c[1]==='or')[2].includes('One Size'));
  assert.equal((await stockApp(sb,'listStockVariants',{query:'a'.repeat(81)})).statusCode,400);
});
