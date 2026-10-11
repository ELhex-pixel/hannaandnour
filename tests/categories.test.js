const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cheerio=require('cheerio');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const registry=require('../public/js/categories');
const dict=require('../public/js/i18n');

test('les 24 catégories sont identiques dans les menus admin, filtres boutique et validation serveur',()=>{
  assert.equal(registry.codes.length,24);assert.equal(new Set(registry.codes).size,24);
  const admin=cheerio.load(fs.readFileSync('public/admin.html','utf8'));
  for(const id of ['f-category','filterCategory']){
    const codes=admin('#'+id+' option').map((_,el)=>admin(el).attr('value')).get().filter(Boolean);
    assert.deepEqual(codes,registry.codes);assert.equal(admin('#'+id+' optgroup').length,5);
  }
  const shop=cheerio.load(fs.readFileSync('public/shop.html','utf8'));
  const shopCodes=shop('[data-group="category"]').map((_,el)=>shop(el).attr('data-value')).get().filter(Boolean);
  assert.deepEqual(shopCodes.sort(),registry.codes.slice().sort());
  assert.deepEqual(require('../netlify/functions/lib/product-assistant').categories,registry.codes);
  for(const category of registry.definitions){
    assert.equal(registry.has(category.code),true);assert.equal(registry.key(category.code),category.key);
    for(const lang of ['fr','en','ar'])assert(dict[lang][category.key],lang+':'+category.code);
  }
  assert.equal(registry.has('__proto__'),false);assert.equal(registry.has('constructor'),false);
  assert.equal(registry.key('unknown'),'allProducts');
});
test('Ensembles est sauvegardé tel quel et une catégorie inconnue est refusée avant toute écriture',async()=>{
  const exports={},state={writes:0,row:null};
  const sb={from:table=>{
    assert.equal(table,'products');return{insert(row){state.writes++;state.row={...row,id:'fixture-product'};return this;},select(){return this;},single:async()=>({data:{id:'fixture-product'},error:null}),eq(){return this;},is(){return this;},maybeSingle:async()=>({data:state.row,error:null})};
  }};
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,getSupabase:()=>sb,readBody:event=>JSON.parse(event.body),requireAdmin:async()=>({ok:true}),rateLimit:async()=>null};
  vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,Buffer,process:{env:{}},require:name=>name==='../../public/js/product-sizes'?require('../public/js/product-sizes'):name==='./shared'?shared:name==='crypto'?require('node:crypto'):name==='./lib/product-assistant'?{categories:registry.codes}:name==='../../public/js/product-media'?require('../public/js/product-media'):class Stripe{constructor(){throw new Error('No payment expected');}}});
  const body={action:'saveProduct',name_en:'Set',name_fr:'Ensemble',category:'set',price_cents:3990,image:'images/hero.jpg',gallery:[],colors:[],sizes:[],active:false};
  const response=await exports.handler({httpMethod:'POST',body:JSON.stringify(body)});
  assert.equal(response.statusCode,200);assert.equal(state.row.category,'set');assert.equal(state.writes,1);
  const denied=await exports.handler({httpMethod:'POST',body:JSON.stringify({...body,category:'unknown'})});assert.equal(denied.statusCode,400);assert.equal(state.writes,1);
});
test('la migration de catégories est rejouable, transactionnelle et ne modifie ni produits existants ni stock',async()=>{
  const db=new PGlite();try{
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    await db.exec(fs.readFileSync('supabase/schema.sql','utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    const product=randomUUID(),variant=randomUUID();
    const insert=async(id,sku,category)=>db.query("insert into products(id,sku,slug,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image)values($1,$2,$2,'Test','Test','Test','','','',1000,$3,'images/hero.jpg')",[id,sku,category]);
    await insert(product,'original','hijab');await db.query("insert into product_variants(id,product_id,color,size,stock)values($1,$2,'Noir','One Size',12)",[variant,product]);
    const before=(await db.query('select * from products where id=$1',[product])).rows[0],stock=(await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock;
    const sql=fs.readFileSync('supabase/migration_catalog_categories.sql','utf8');
    await assert.rejects(db.exec(sql.replace(/commit;\s*$/,'select 1/0;commit;')),/division by zero/);await db.exec('rollback');
    await assert.rejects(insert(randomUUID(),'refused-set','set'),/products_category_check/);
    await db.exec(sql);await db.exec(sql);
    for(const category of registry.codes)await insert(randomUUID(),'category-'+category,category);
    await assert.rejects(insert(randomUUID(),'bad-category','unsupported'),/products_category_check/);
    assert.deepEqual((await db.query('select * from products where id=$1',[product])).rows[0],before);
    assert.equal((await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock,stock);
    assert.equal((await db.query('select catalog_categories_schema_version() as version')).rows[0].version,1);
    for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'catalog_categories_schema_version()','execute') as allowed",[role])).rows[0].allowed,false);
  }finally{await db.close();}
});
