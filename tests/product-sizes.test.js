const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const {randomUUID} = require('node:crypto');
const sizes = require('../public/js/product-sizes');
const {prepareVariantSizes} = require('../netlify/functions/lib/variant-sizes');

test('One Size et Taille unique donnent un seul choix, sans confondre les autres tailles', () => {
  assert.deepEqual(sizes.unique(['One Size','Taille unique','one-size','TAILLE UNIQUE','M','m','38/40']), ['Taille unique','M','38/40']);
  assert.equal(sizes.key('One Size'), sizes.key('Taille unique'));
  assert.notEqual(sizes.key('M'), sizes.key('L'));
  assert.notEqual(sizes.key('36/38'), sizes.key('38/40'));
});

test('l’admin prépare trois lignes Taille unique, garde les trois IDs actifs et leurs quantités', () => {
  const colors=['Gris clair','Noir','Gris'];
  const old=colors.map(color=>({id:randomUUID(),color,size:'Taille unique',stock:0,active:false,barcode:'OLD-'+color}));
  const current=colors.map((color,index)=>({id:randomUUID(),color,size:'One Size',stock:[2,8,2][index],active:true,barcode:'CURRENT-'+color}));
  const editing={variants:old.concat(current)}, before=JSON.stringify(editing);
  const grid={innerHTML:''}, inputs={'f-colors':colors.join(', '),'f-sizes':'One Size, Taille unique'}, context={
    SIZES:sizes,productsAll:[{sizes:['One Size','Taille unique'],variants:editing.variants}],editing,editorRevision:1,variantGridRevision:-1,inlineStock:null,
    getVal:id=>inputs[id]||'',setVal:(id,value)=>{inputs[id]=value;},strToList:value=>value.split(',').map(s=>s.trim()).filter(Boolean),
    esc:value=>String(value==null?'':value).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),colorCellHtml:color=>'<input class="v-color" value="'+color+'">',toast(){},
    document:{getElementById:()=>grid,querySelectorAll:()=>[]}
  };
  const source=fs.readFileSync('public/js/admin.js','utf8');vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function sizeChoices('),source.indexOf('  function colorCellHtml('))+source.slice(source.indexOf('  function variantSizeHtml('),source.indexOf('  function changeVariantSize(')),context);
  context.buildVariantGrid(); const $=cheerio.load(grid.innerHTML);
  assert.equal($('.variant-row').length,3);
  assert.equal($('.v-size option[value="Taille unique"]').length,3);
  assert.equal($('.v-size option[value="One Size"]').length,0);
  assert.deepEqual($('.v-stock').map((_,node)=>$(node).attr('value')).get(),['2','8','2']);
  assert.deepEqual($('.v-adjust').map((_,node)=>$(node).attr('data-editor-inventory')).get(),current.map(v=>v.id));
  context.document.querySelectorAll=()=>$('.variant-row').map((_,row)=>({querySelector:selector=>{
    const node=$(row).find(selector);return{value:selector==='.v-size'?node.find('option[selected]').attr('value'):node.attr('value')};
  }})).get();
  const payload=Array.from(context.collectVariants(),row=>({...row}));
  assert.deepEqual(payload.map(row=>[row.size,row.stock,row.expected_stock,row.barcode]),current.map(v=>[v.size,v.stock,v.stock,v.barcode]));
  context.addSize('one size');context.addSize('Taille unique');
  assert.equal(sizes.unique(inputs['f-sizes'].split(',')).length,1);
  assert.equal(JSON.stringify(editing),before);
});

test('la sauvegarde réutilise la variante active historique au lieu de créer une nouvelle identité', async () => {
  const rows=[{id:'old',color:'Noir',size:'Taille unique',stock:0,active:false,barcode:'OLD'}, {id:'current',color:'Noir',size:'One Size',stock:8,active:true,barcode:'CURRENT'}];
  const reads=[];
  const sb={from:table=>({select:fields=>{reads.push([table,fields]);return{eq:async()=>({data:rows,error:null})};}})};
  const incoming=[{color:'Noir',size:'Taille unique',stock:8,expected_stock:8,active:true}];
  const prepared=await prepareVariantSizes(sb,'product',incoming);
  assert.deepEqual(prepared[0],{...incoming[0],size:'One Size',barcode:'CURRENT'});
  assert.equal(rows[1].stock,8); assert.equal(rows[0].active,false);
  await assert.rejects(prepareVariantSizes(sb,'product',[...incoming,{...incoming[0],size:'One Size'}]),/variant_size_duplicate/);
  assert.equal(reads.length,1);
  const fresh=await prepareVariantSizes({from(){throw new Error('No read');}},null,[{color:'Vin',size:'One Size',stock:3}]);
  assert.equal(fresh[0].size,'Taille unique');
});

test('des tailles synonymes actives en conflit ne sont ni additionnées ni écrasées', async () => {
  const rows=[{id:'one',color:'Noir',size:'One Size',stock:8,active:true},{id:'two',color:'Noir',size:'Taille unique',stock:2,active:true}],before=JSON.stringify(rows);
  const sb={from:()=>({select:()=>({eq:async()=>({data:rows})})})};
  await assert.rejects(prepareVariantSizes(sb,'product',[{color:'Noir',size:'Taille unique',stock:10}]),/variant_size_conflict/);
  assert.equal(JSON.stringify(rows),before);
});
test('le serveur refuse deux tailles uniques équivalentes avant toute écriture de produit ou stock',async()=>{
  const exports={},writes=[];
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,getSupabase:()=>({from(){writes.push(true);throw new Error('No database read or write expected');}}),readBody:event=>JSON.parse(event.body),requireAdmin:async()=>({ok:true}),rateLimit:async()=>null};
  vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,Buffer,process:{env:{}},console:{error(){}},require:name=>name==='./shared'?shared:name==='crypto'?require('node:crypto'):name==='../../public/js/product-media'?require('../public/js/product-media'):name==='../../public/js/product-sizes'?sizes:name==='./lib/variant-sizes'?{prepareVariantSizes}:name==='./lib/product-assistant'?{categories:require('../public/js/categories').codes}:class Stripe{}});
  const response=await exports.handler({httpMethod:'POST',body:JSON.stringify({action:'saveProduct',name_en:'Test',category:'jacket',price_cents:2000,image:'images/hero.jpg',sizes:['One Size','Taille unique'],variants:[{color:'Noir',size:'One Size',stock:2},{color:'Noir',size:'Taille unique',stock:8}]})});
  assert.equal(response.statusCode,400);assert.match(response.body,/même taille/);assert.equal(writes.length,0);
});
test('le devis sélectionne le vrai stock actif quand les anciennes tailles équivalentes sont désactivées',async()=>{
  const {quote}=require('../netlify/functions/lib/commerce');
  const rows=[{id:'old',product_id:'product',color:'Noir',size:'Taille unique',stock:0,active:false},{id:'active',product_id:'product',color:'Noir',size:'One Size',stock:8,active:true}];
  const sb={from:table=>({select(){return this;},in(){return this;},eq(){return this;},then(resolve){resolve({data:table==='products'?[{id:'product',slug:'cape',price_cents:2000,name_en:'Cape',active:true}]:table==='product_variants'?rows:[]});}})};
  for(const size of ['Taille unique','One Size']){
    const value=await quote(sb,{items:[{slug:'cape',color:'Noir',size,qty:2}]});
    assert.equal(value.items[0].variantId,'active');assert.equal(value.items[0].size,'One Size');assert.equal(value.totals.subtotal,4000);
  }
  assert.equal(rows[1].stock,8);assert.equal(rows[0].stock,0);
});
