const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function i18n(path='/en/shop.html',blocked=false){
  const storage=new Map([['hn-lang','fr']]),listeners={};
  const link=href=>({href,getAttribute(){return this.href;},setAttribute(name,value){this.href=value;}});
  const anchors=[link('cart.html'),link('account.html#returns'),link('https://external.example.test/shop.html'),link('#details')];
  const document={baseURI:'https://hannanour.com/',documentElement:{classList:{toggle(){}}},head:{appendChild(){}},getElementById:()=>null,
    createElement:()=>({}),querySelectorAll:selector=>selector==='a[href]'?anchors:[],addEventListener(type,handler){listeners[type]=handler;},dispatchEvent(){}};
  const location={href:'https://hannanour.com'+path,origin:'https://hannanour.com',protocol:'https:',pathname:path.split('?')[0].split('#')[0],search:path.includes('?')?'?'+path.split('?')[1].split('#')[0]:'',hash:path.includes('#')?'#'+path.split('#')[1]:''};
  const window={location};
  vm.runInNewContext(fs.readFileSync('public/js/i18n.js','utf8'),{window,document,URL,navigator:{language:'fr-FR'},localStorage:{getItem:key=>{if(blocked)throw new Error('Storage blocked');return storage.get(key);},setItem:(key,value)=>{if(blocked)throw new Error('Storage blocked');storage.set(key,value);}},CustomEvent:function(){}});
  return{window,document,storage,listeners,anchors,I18n:window.I18n};
}
test('ouvrir une page anglaise conserve l’anglais pour les liens mobile panier/compte',()=>{
  const mock=i18n();mock.listeners.DOMContentLoaded();
  assert.equal(mock.I18n.lang(),'en');assert.equal(mock.storage.get('hn-lang'),'en');
  assert.equal(mock.anchors[0].href,'/en/cart.html');assert.equal(mock.anchors[1].href,'/en/account.html#returns');
  const dynamic={href:'product.html?slug=cape-test',getAttribute(){return this.href;},setAttribute(name,value){this.href=value;}};
  mock.listeners.click({target:{closest:()=>dynamic}});
  assert.equal(dynamic.href,'/en/product.html?slug=cape-test');
});
test('changer de langue conserve la page, les filtres et l’ancre sur les routes propres et les fiches',()=>{
  for(const [path,expected] of [['/fr/shop?category=set#products','/en/shop.html?category=set#products'],['/fr/products/cape-test.html','/en/products/cape-test.html'],['/','/en/index.html']]){
    const mock=i18n(path);mock.I18n.setLang('en');assert.equal(mock.window.location.href,expected);
  }
});
test('la langue fonctionne sans stockage et ne réécrit pas les URL externes, les ancres ni les API',()=>{
  const mock=i18n('/en/shop.html',true);mock.listeners.DOMContentLoaded();
  assert.equal(mock.I18n.lang(),'en');mock.I18n.setLang('ar');assert.equal(mock.window.location.href,'/ar/shop.html');
  for(const value of ['https://external.example.test/shop.html','#details','mailto:care@hannanour.com','/api/products','/.netlify/functions/products','/admin'])assert.equal(mock.I18n.pageUrl(value),value);
});
