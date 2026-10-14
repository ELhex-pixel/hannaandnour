const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const cheerio=require('cheerio');
const {compactAsset,optimizePage}=require('../scripts/performance');
const {renderContent}=require('../scripts/seo');
test('la version compacte conserve les montants en centimes et les textes internationaux sans changer les sources',async()=>{
  const source=fs.readFileSync('public/js/stock-prices.js');
  const compact=await compactAsset(source,'js');assert(compact.length<source.length);
  const window={};vm.runInNewContext(compact.toString(),{window});assert.equal(window.HN_STOCK_PRICES.parse('7,50'),750);assert.equal(window.HN_STOCK_PRICES.parse('1,001'),null);
  assert(source.equals(fs.readFileSync('public/js/stock-prices.js')));
});
test('les images locales ont un choix responsive et le thème reste immédiat avant les scripts différés',()=>{
  const $=cheerio.load('<head><link rel="stylesheet" href="/fonts/fonts.abc.css"><script src="/assets/theme.abc.js"></script></head><body><div class="hero-image"><img src="/images/hero.webp"></div><img src="/images/collection.webp"><script src="/assets/store.abc.js"></script><script src="/assets/main.abc.js"></script></body>');
  const sources=[{src:'/images/hero.480.webp',width:480},{src:'/images/hero.webp',width:1400}];
  optimizePage($,'index.html','fr',{'/images/hero.webp':{width:1400,height:1867,sources}});
  assert.equal($('.hero-image img').attr('fetchpriority'),'high');assert.equal($('.hero-image img').attr('loading'),'eager');assert.match($('.hero-image img').attr('srcset'),/480w/);assert.equal($('.hero-image img').attr('width'),'1400');
  assert.equal($('img').last().attr('loading'),'lazy');assert.equal($('script[src*=theme]').is('[defer]'),false);assert.equal($('script[src*=store]').is('[defer]'),true);
  assert.equal($('link[rel=preload][as=font]').length,1);
  optimizePage($,'index.html','ar',{});assert.equal($('#arabicFont').attr('href'),'/fonts/cairo.css');
});
test('le résumé sans JS reste lisible mais sa photo publique passe par le CDN léger et le chargement paresseux',()=>{
  const $=cheerio.load('<head></head><body><main></main></body>');
  const row={slug:'veste-test',name_fr:'Veste',description_fr:'Description réelle',image:'https://rqgoawbzbgzuvpxnzxsu.supabase.co/storage/v1/object/public/product-images/uploads/test.png'};
  renderContent($,'https://example.test','product',row,'fr');
  assert.equal($('[data-seo-summary] h1').text(),'Veste');assert.match($('[data-seo-summary] img').attr('src'),/^\/\.netlify\/images\?/);assert.equal($('[data-seo-summary] img').attr('loading'),'lazy');assert(!$.html().includes('price_cents'));
});
function home(items,slugs){
  const grids={},calls=[];let finish;
  const HN={requireConfig:()=>Promise.resolve({home:{bestsellers:slugs,collections:[]},reviews:{show_demo:false}}),fetchProducts:()=>new Promise(resolve=>{finish=()=>resolve(items);}),loading(){},loaded(target){target.ready=true;},card:p=>p.slug,tr:key=>key,loadError(){},loadProductSlugs:async values=>{calls.push(values);return values.map(slug=>({slug,active:true}));}};
  const document={querySelector:key=>grids[key]||(grids[key]={innerHTML:'',textContent:''})};
  vm.runInNewContext(fs.readFileSync('public/js/home.js','utf8'),{window:{HN},document,Promise});
  return {grids,calls,finish:()=>finish()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('l’accueil ne relit pas des anciens slugs absents d’un petit catalogue et rend les collections sans attendre les produits',async()=>{
  const mock=home([{slug:'reel',active:true,is_bestseller:true}],['ancien-supprime']);await tick();
  assert.equal(mock.grids['[data-feed="collections"]'].ready,true);mock.finish();await tick();assert.equal(mock.calls.length,0);assert.equal(mock.grids['[data-feed="bestsellers"]'].innerHTML,'reel');
  const large=home(Array.from({length:48},(_,i)=>({slug:'reel-'+i,active:true})),['reel-hors-premiere-page']);large.finish();await tick();assert.equal(large.calls.length,1);assert.equal(large.grids['[data-feed="bestsellers"]'].innerHTML,'reel-hors-premiere-page');
});
test('le scanner lourd est chargé uniquement sur demande et une fermeture pendant le chargement ne demande pas la caméra',async()=>{
  const scripts=[],window={};let scans=0;
  const document={currentScript:{getAttribute:()=>'/assets/stock-codes-engine.hash.js'},createElement:()=>({remove(){}}),head:{appendChild:script=>scripts.push(script)}};
  vm.runInNewContext(fs.readFileSync('public/js/stock-codes.js','utf8'),{window,document,Promise,setTimeout,clearTimeout});
  assert.equal(scripts.length,0);window.HN_STOCK_CODES.stop();assert.equal(scripts.length,0);
  const pending=window.HN_STOCK_CODES.start('sale',{},()=>assert.fail('No scan expected'));assert.equal(scripts.length,1);assert.equal(scripts[0].src,'/assets/stock-codes-engine.hash.js');
  window.HN_STOCK_CODES.stop();window.HN_STOCK_ENGINE={stop(){},start(){scans++;},qr:async text=>'QR:'+text};scripts[0].onload();await pending;assert.equal(scans,0);
  assert.equal(await window.HN_STOCK_CODES.qr('local'),'QR:local');assert.equal(scripts.length,1);
});
test('les premières lectures publiques démarrent dans le head et sont consommées une seule fois, pas réutilisées comme cache',async()=>{
  const requests=[],location=new URL('https://example.test/fr/products/cape-courte.html');
  const window={},document={currentScript:{getAttribute:()=> 'product.html'}};
  const fetch=async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({request:requests.length})};};
  vm.runInNewContext(fs.readFileSync('public/js/early-data.js','utf8'),{window,document,location,URL,URLSearchParams,AbortController,Promise,setTimeout,clearTimeout,fetch});
  assert.equal(requests.length,2);assert(requests.every(r=>r.options.cache==='no-store'&&!r.options.method));
  assert.equal(requests[1].url,'https://example.test/.netlify/functions/products?slug=cape-courte');
  const first=window.HN_EARLY_DATA.take('/.netlify/functions/config');assert(first);assert.equal(window.HN_EARLY_DATA.take('/.netlify/functions/config'),null);await first;
  const product=window.HN_EARLY_DATA.take('/.netlify/functions/products?slug=cape-courte');assert(product);await product;
  assert.equal(window.HN_EARLY_DATA.take('/.netlify/functions/products?slug=cape-courte'),null);
  const context={window,fetch,AbortController,Promise,setTimeout,clearTimeout,tr:key=>key};vm.createContext(context);
  const store=fs.readFileSync('public/js/store.js','utf8');vm.runInContext(store.slice(store.indexOf('  function request('),store.indexOf('  function loadingMarkup(')),context);
  const before=requests.length;await context.request('/.netlify/functions/config');assert.equal(requests.length,before+1);assert.equal(requests.at(-1).options.cache,'no-store');
});
