const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cheerio=require('cheerio');
const dict=require('../public/js/i18n');

function bottomNav(lang='fr',path='/fr/shop.html'){
  const nodes={},all=[],events={},media={matches:true,addEventListener(type,handler){this.change=handler;}},state={count:0};
  function node(tag){const n={tag,children:[],attributes:{},hidden:false,classList:{contains:()=>false,toggle(){}},appendChild(child){this.children.push(child);},setAttribute(key,val){this.attributes[key]=val;},getAttribute(key){return this.attributes[key];},removeAttribute(key){delete this.attributes[key];},addEventListener(){},querySelector:selector=>selector==='.mobile-nav-label'?n.children.find(child=>child.className==='mobile-nav-label'):null,querySelectorAll:selector=>selector==='[data-mobile-page]'?n.children:[]};all.push(n);return n;}
  const body=node('body');body.toggleAttribute=(key,on)=>{if(on)body.attributes[key]='';else delete body.attributes[key];};
  nodes.header=node('header');
  const context={window:{HN:{tr:key=>dict[lang][key],pageUrl:page=>'/'+lang+'/'+page,cart:{count:()=>state.count}},location:{pathname:path},matchMedia:query=>query.includes('767')?media:{matches:true}},
    document:{body,getElementById:id=>nodes[id]||all.find(n=>n.id===id)||null,createElement:node,querySelector:()=>null,addEventListener(type,handler){events[type]=handler;}},setTimeout,requestAnimationFrame:fn=>{fn();return 1;}};
  vm.runInNewContext(fs.readFileSync('public/js/mobile-ui.js','utf8'),context);
  return{state,body,media,events,nav:all.find(n=>n.id==='mobileBottomNav'),badge:all.find(n=>n.className==='mobile-nav-count')};
}
test('les cinq accès mobiles conservent la langue et mettent à jour le badge sans requête serveur',()=>{
  for(const lang of ['fr','en','ar']){
    const mock=bottomNav(lang,'/'+lang+'/shop.html');
    assert.equal(mock.nav.children.length,5);
    const [home,shop,search,cart,account]=mock.nav.children;
    assert.equal(home.href,'/'+lang+'/index.html');assert.equal(shop.attributes['aria-current'],'page');assert.equal(account.href,'/'+lang+'/account.html');
    assert.equal(search.tag,'button');assert.equal(search.attributes['data-search-open'],'');assert.equal(cart.href,'/'+lang+'/cart.html');
    assert.equal(mock.badge.hidden,true);mock.state.count=3;mock.events['hn:cart']();assert.equal(mock.badge.textContent,'3');assert.equal(mock.badge.hidden,false);
    mock.state.count=0;mock.events['hn:cart']();assert.equal(mock.badge.hidden,true);
    mock.media.matches=false;mock.media.change();assert.equal(mock.nav.hidden,true);assert(!('data-mobile-nav' in mock.body.attributes));
  }
});

test('les accès mobiles sont marqués actifs sur les fiches, le panier et le compte',()=>{
  for(const [path,page] of [['/en/products/cape.html','shop'],['/en/checkout.html','cart'],['/en/account.html','account']]){
    const mock=bottomNav('en',path);assert.equal(mock.nav.children.find(n=>n.attributes['aria-current']==='page').attributes['data-mobile-page'],page);
  }
});

test('le build charge les styles et accès mobiles après main.js sur les pages publiques',()=>{
  for(const page of ['index','shop','product','cart','checkout','account']){
    const $=cheerio.load(fs.readFileSync('public/'+page+'.html','utf8'));
    const scripts=$('script[src]').map((_,n)=>$(n).attr('src')).get();
    assert(scripts.indexOf('js/mobile-ui.js')>scripts.indexOf('js/main.js'));
    assert.equal($('link[href="css/mobile.css"]').length,1);
  }
  const admin=cheerio.load(fs.readFileSync('public/admin.html','utf8'));assert.equal(admin('script[src="js/mobile-ui.js"]').length,0);
});
