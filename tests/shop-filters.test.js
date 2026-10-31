const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cheerio=require('cheerio');
const {catalogFacets}=require('../netlify/functions/lib/catalog-facets');
function catalogue(rows,options={}){
  const reads=[];
  return{reads,sb:{from(table){const read={table};reads.push(read);return{
    select(fields,opts){read.fields=fields;read.count=opts.count;return this;},eq(key,value){read.active=[key,value];return this;},is(key,value){read.deleted=[key,value];return this;},order(key){read.order=key;return this;},range(start,end){read.range=[start,end];return this;},abortSignal(signal){assert(signal instanceof AbortSignal);return this;},then(resolve){
      return Promise.resolve({data:options.data||rows.slice(read.range[0],read.range[1]+1),count:Object.hasOwn(options,'count')?options.count:rows.length,error:options.error||null}).then(resolve);
    }
  };}}};
}
const product=(id,category='coat',sizes=['Taille unique'],occasions=[],price_cents=4500)=>({id:String(id),category,sizes,occasions,price_cents});
test('les facettes couvrent le catalogue entier, y compris les catégories absentes de la première page',async()=>{
  const rows=Array.from({length:500},(_,i)=>product(i));rows.push(product(500,'trousers',['M','L'],['Work'],2900));
  const f=catalogue(rows),value=await catalogFacets(f.sb);
  assert.deepEqual(value,{categories:['coat','trousers'],sizes:['L','M','Taille unique'],occasions:['Work'],min_price_cents:2900,max_price_cents:4500,total:501});
  assert.equal(f.reads.length,2);assert.deepEqual(f.reads.map(r=>r.range),[[0,499],[500,999]]);
  for(const read of f.reads){assert.equal(read.table,'products');assert.equal(read.count,'exact');assert.deepEqual(read.active,['active',true]);assert.deepEqual(read.deleted,['catalog_deleted_at',null]);assert.equal(read.fields,'id,category,sizes,occasions,price_cents');}
});
test('facettes vides et pannes sont distinctes ; un catalogue partiel ou invalide ne devient pas une liste trompeuse',async()=>{
  assert.deepEqual(await catalogFacets(catalogue([]).sb),{categories:[],sizes:[],occasions:[],min_price_cents:null,max_price_cents:null,total:0});
  for(const f of [catalogue([product(1)],{count:null}),catalogue([product(1)],{count:2001}),catalogue([product(1)],{count:2}),catalogue([product(1),product(1)]),catalogue([product(1,'coat',null)]),catalogue([product(1,'coat',[],[],null)]),catalogue([],{error:{code:'42501',message:'private'}})])await assert.rejects(catalogFacets(f.sb),/temporarily unavailable/);
});

function filters(facets,selections={}){
  const $=cheerio.load(fs.readFileSync('public/shop.html','utf8'));
  const nodes=new WeakMap();
  function wrap(el){if(!el)return null;if(nodes.has(el))return nodes.get(el);const node={getAttribute:key=>$(el).attr(key),setAttribute:(key,v)=>$(el).attr(key,v),classList:{toggle:(key,v)=>$(el).toggleClass(key,v)},closest:selector=>wrap($(el).closest(selector)[0])};
    Object.defineProperty(node,'hidden',{get:()=>$(el).is('[hidden]'),set:value=>value?$(el).attr('hidden',''):$(el).removeAttr('hidden')});
    Object.defineProperty(node,'innerHTML',{get:()=>$(el).html(),set:value=>$(el).html(value)});Object.defineProperty(node,'textContent',{get:()=>$(el).text(),set:value=>$(el).text(value)});nodes.set(el,node);return node;
  }
  const state={items:[],facets,categories:[],sizes:[],occasions:[],minCents:null,maxCents:null,...selections};
  const context={state,document:{getElementById:id=>wrap($('#'+id)[0]),querySelector:s=>wrap($(s)[0]),querySelectorAll:s=>$(s).toArray().map(wrap)}};
  vm.createContext(context);const source=fs.readFileSync('public/js/shop.js','utf8');
  vm.runInContext(source.slice(source.indexOf('  function escAttr('),source.indexOf('  function buildCard('))+source.slice(source.indexOf('  function setFilterControls()'),source.indexOf('  function debounce(')),context);
  context.buildFilterOptions();
  return{$,state,rebuild:()=>context.buildFilterOptions(),visible:group=>!$('[data-filter-group="'+group+'"]').is('[hidden]'),categories:()=>$('[data-group=category]').filter((_,el)=>!$(el).is('[hidden]')).map((_,el)=>$(el).attr('data-value')).get()};
}
test('la boutique masque les catégories absentes et les filtres qui n’offrent aucun choix utile',()=>{
  const f=filters({categories:['coat','trousers'],sizes:['Taille unique'],occasions:[],min_price_cents:2500,max_price_cents:4500,total:12});
  assert.deepEqual(f.categories(),['','coat','trousers']);assert.equal(f.visible('category'),true);assert.equal(f.visible('size'),false);assert.equal(f.visible('occasion'),false);assert.equal(f.visible('price'),true);
  f.state.facets={categories:['coat'],sizes:['Taille unique'],occasions:['Everyday'],min_price_cents:4500,max_price_cents:4500,total:2};f.rebuild();
  for(const group of ['category','size','occasion','price'])assert.equal(f.visible(group),false);
  assert.equal(f.$('#filterToggle').is('[hidden]'),true);
  f.state.facets={categories:['coat','jacket'],sizes:['M','L'],occasions:['Everyday','Work'],min_price_cents:2500,max_price_cents:4500,total:8};f.rebuild();
  for(const group of ['category','size','occasion','price'])assert.equal(f.visible(group),true);
  assert.equal(f.$('#filterToggle').is('[hidden]'),false);
});
test('un filtre sélectionné absent ou une panne garde le contrôle pour le retirer sans élargir les choix à une page partielle',()=>{
  const f=filters(null,{categories:['hijab'],sizes:['XXL'],occasions:['Travel'],minCents:1000,items:[product('partial','coat',['M'],['Work'])]});
  assert.deepEqual(f.categories(),['','hijab']);assert.equal(f.$('#sizeOptions [data-value=XXL]').length,1);assert.equal(f.$('#sizeOptions [data-value=M]').length,0);
  for(const group of ['category','size','occasion','price'])assert.equal(f.visible(group),true);
  f.state.categories=[];f.state.sizes=[];f.state.occasions=[];f.state.minCents=null;f.rebuild();
  for(const group of ['category','size','occasion','price'])assert.equal(f.visible(group),false);
});
