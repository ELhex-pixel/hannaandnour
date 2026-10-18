const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const { prepareLivePage } = require('../scripts/build');

test('Collections ne contient plus de produits/prix de démonstration, même avant JavaScript', () => {
  const source = fs.readFileSync('public/collections.html','utf8'), $ = cheerio.load(source);
  assert.equal($('.product-card').length,0);
  assert.equal($('.collection-card').length,0);
  assert.doesNotMatch(source,/data-slug="(?:silk-hijab|flowing-abaya|prayer-set|modest-dress)"|data-price-cents/);
  const scripts=$('script[src]').map((_,node)=>$(node).attr('src')).get();
  assert(scripts.includes('js/home.js')); assert(scripts.indexOf('js/home.js')>scripts.indexOf('js/store.js'));
  for (const feed of ['bestsellers','collections']) assert.equal($('[data-feed="'+feed+'"][aria-busy="true"]').length,1);
  prepareLivePage($,'collections.html');
  assert.equal($('body').attr('data-live-page'),'collections.html');
  assert.equal($('body').is('[data-image-cdn]'),true);
  assert.equal($('.product-card').length,0);
  assert.equal($('[data-feed="bestsellers"] .live-skeleton-card').length,4);
});

function feeds(configuration,products,lang='fr') {
  const grid={innerHTML:'legacy-card',textContent:'',busy:false},collections={innerHTML:'legacy-collection',textContent:'',busy:false},errors=[],requests=[];
  const HN={
    loading(target){target.innerHTML='loading';target.busy=true;},loaded(target){target.busy=false;},
    tr:key=>lang+':'+key,lang:()=>lang,card:row=>'<article data-slug="'+row.slug+'">'+row.name_fr+':'+row.price_cents+'</article>',
    requireConfig:async()=>{if(configuration instanceof Error)throw configuration;return configuration;},
    fetchProducts:async()=>{requests.push('products');if(products instanceof Error)throw products;return products;},
    loadProductSlugs:async()=>assert.fail('Small catalogue must not fetch absent demo slugs'),
    loadError(target,retry){target.innerHTML='retry';target.busy=false;errors.push({target,retry});}
  };
  const document={querySelector:selector=>selector==='[data-feed="bestsellers"]'?grid:selector==='[data-feed="collections"]'?collections:null};
  vm.runInNewContext(fs.readFileSync('public/js/home.js','utf8'),{window:{HN},document,Promise});
  return{grid,collections,errors,requests};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('la sélection Collections suit le catalogue frais et les choix admin, pas les anciennes cartes ni les produits archivés',async()=>{
  const data=[{slug:'reel',name_fr:'Veste actuelle',price_cents:4290,active:true},{slug:'archive',name_fr:'Archivé',price_cents:100,active:false,is_bestseller:true}];
  const ui=feeds({home:{bestsellers:['archive','silk-hijab','reel'],bestsellers_count:4},reviews:{show_demo:true}},data);
  await tick();assert.match(ui.grid.innerHTML,/Veste actuelle:4290/);assert.doesNotMatch(ui.grid.innerHTML,/silk-hijab|archive|3490/);assert.equal(ui.grid.busy,false);assert.equal(ui.errors.length,0);
});
test('un catalogue vide ou indisponible ne réaffiche jamais les cartes de démonstration',async()=>{
  for(const lang of ['fr','en','ar']){
    const empty=feeds({home:null},[],lang);await tick();assert.match(empty.grid.innerHTML,new RegExp(lang+':emptyCatalog'));assert.doesNotMatch(empty.grid.innerHTML,/legacy-card/);
  }
  const failure=feeds({home:null},new Error('Unavailable'));await tick();assert.equal(failure.grid.innerHTML,'retry');assert.equal(failure.errors.length,1);assert.equal(typeof failure.errors[0].retry,'function');
  const configuration=feeds(new Error('Currency unavailable'),[{slug:'reel',price_cents:4290}]);await tick();assert.equal(configuration.grid.innerHTML,'retry');assert.equal(configuration.collections.innerHTML,'retry');assert.equal(configuration.errors.length,2);
});
