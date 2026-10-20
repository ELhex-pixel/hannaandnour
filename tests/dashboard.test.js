const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cheerio=require('cheerio');
const {salesReport,adminSales}=require('../netlify/functions/lib/admin-sales');
const {canonicalPath,summarize,adminAnalytics}=require('../netlify/functions/lib/admin-analytics');
const view=require('../public/js/admin-dashboard-view');
const now=new Date('2026-10-13T12:00:00Z'),eur={code:'eur',symbol:'€'};
function order(changes={}){return{paid_at:'2026-10-12T10:00:00Z',status:'paid',sale_channel:'online',currency:'eur',subtotal_cents:2000,discount_cents:0,total_cents:2700,refunded_cents:0,order_returns:[],order_items:[{id:'i',product_slug:'veste',product_name:'Veste',quantity:2,net_total_cents:2000,unit_price_cents:1000,order_item_costs:{unit_cost_cents:400,currency:'eur'}}],...changes};}
test('le tableau affiche les encaissements, le net réel, les achats historiques et les deux canaux sans mélanger les devises',()=>{
  const a=order(),b=order({sale_channel:'physical',total_cents:2400,refunded_cents:500}),outside=order({paid_at:'2026-09-01T10:00:00Z'});
  b.order_items[0].order_item_costs.unit_cost_cents=600;
  const r=salesReport([a,b,outside,order({currency:'usd',total_cents:999999})],[],'d7',5,eur,now);
  assert.equal(r.totals.revenueCents,5100);assert.equal(r.totals.netRevenueCents,4600);assert.equal(r.totals.purchaseCents,2000);
  assert.equal(r.totals.onlineOrders,1);assert.equal(r.totals.physicalOrders,1);assert.equal(r.products[0].purchaseMinCents,400);assert.equal(r.products[0].purchaseMaxCents,600);
  assert.equal(r.products[0].averageSaleCents,1000);assert.equal(r.totals.marginCents,null);assert.deepEqual(r.excluded_currencies,['usd']);
  const $=cheerio.load(view.finance(r));
  const cards=$('.dashboard-finance-grid .dashboard-kpi').map((_,node)=>$(node).text()).get();
  assert.match(cards[0],/51,00/);assert.match(cards[1],/46,00/);assert.match(cards[2],/20,00/);assert.match(cards[3],/Non calculable/);
  assert.match($('.dashboard-table').text(),/4,00.*6,00/);assert.match($.text(),/Ce n’est pas le bénéfice net/);
});
test('un prix d’achat absent ou dans une autre devise reste inconnu, zéro réel reste zéro, et les retours ne sont pas des remboursements',()=>{
  const missing=order();missing.order_items[0].order_item_costs=null;
  const r=salesReport([order(),missing],[],'all',5,eur,now);
  assert.equal(r.totals.purchaseCents,null);assert.equal(r.totals.purchaseKnownCents,800);assert.equal(r.totals.purchaseMissingUnits,2);
  assert.match(cheerio.load(view.finance(r)).text(),/Prix d’achat manquant pour 2 unité/);
  const wrong=order();wrong.order_items[0].order_item_costs.currency='usd';assert.equal(salesReport([wrong],[],'all',5,eur,now).totals.purchaseCents,null);
  const zero=order();zero.order_items[0].order_item_costs.unit_cost_cents=0;assert.equal(salesReport([zero],[],'all',5,eur,now).totals.purchaseCents,0);
  const returned=order({order_returns:[{order_item_id:'i',quantity:1,total_refund_cents:1000,sellable_quantity:1}]});
  const ret=salesReport([returned],[],'d7',5,eur,now);assert.equal(ret.totals.netRevenueCents,2700);assert.equal(ret.totals.purchaseCents,800);assert.equal(ret.totals.marginCents,600);
  const empty=salesReport([],[],'d7',5,eur,now);assert.match(cheerio.load(view.finance(empty)).text(),/Aucune vente/);
});
test('les prix d’achat actuels des variantes sans vente restent consultables sans remplacer les coûts historiques',()=>{
  const products=[{slug:'veste',name_fr:'Veste actuelle',active:true,product_variants:[{id:'v1',color:'Noir',size:'M',stock:5,active:true,variant_costs:{unit_cost_cents:900,currency:'eur'}},{id:'v2',color:'Blanc',size:'L',stock:0,active:true,variant_costs:null},{id:'v3',active:false,stock:100,variant_costs:{unit_cost_cents:1,currency:'eur'}}]}];
  const r=salesReport([order()],products,'d30',5,eur,now);
  assert.equal(r.totals.purchaseCents,800);assert.equal(r.products[0].purchaseMinCents,400);assert.equal(r.purchase_prices.length,2);
  const $=cheerio.load(view.finance(r));assert.match($('.dashboard-current-costs').text(),/9,00/);assert.match($('.dashboard-current-costs').text(),/Non renseigné/);
  assert.match($('.dashboard-product-section').text(),/4,00/);assert.equal($('.dashboard-current-costs tr').length,3);
});
test('les statistiques regroupent les alias de pages, respectent les langues et les périodes, et retirent paramètres sensibles',()=>{
  for(const path of ['/shop','/shop.html','/fr/shop','/fr/shop.html'])assert.equal(canonicalPath(path),'/fr/shop.html');
  assert.equal(canonicalPath('/'),'/fr/index.html');assert.equal(canonicalPath('/en/shop'),'/en/shop.html');
  assert.equal(canonicalPath('/cart?token=private&email=secret@example.test'),'/fr/cart.html');assert.equal(canonicalPath('//foreign.test/path'),'(page non renseignée)');
  const recent=path=>({event_type:'pageview',path,created_at:'2026-10-12T12:00:00Z'});
  const summary=summarize([recent('/shop'),recent('/fr/shop.html'),recent('/en/shop'),{...recent('/shop'),created_at:'2026-09-20T12:00:00Z'},{...recent('/shop'),created_at:'2026-08-01T12:00:00Z'},{...recent('/shop'),created_at:'invalid'}],now.getTime());
  assert.equal(summary.d7.counts.pageview,3);assert.equal(summary.d30.counts.pageview,4);assert.equal(summary.all.counts.pageview,5);
  assert.deepEqual(summary.d7.topPaths,[{path:'/fr/shop.html',views:2},{path:'/en/shop.html',views:1}]);
  assert.equal(view.ratio(4,802),'0,5 %');assert.equal(view.ratio(0,0),'—');
});
test('les classements lisibles échappent les noms, annoncent les lectures partielles et n’affichent pas les paramètres d’URL',()=>{
  const payload={limited:true,summary:{d30:{counts:{pageview:802,product_view:58,add_to_cart:29,checkout_attempt:4,purchase:4},topProducts:[{slug:'veste',views:12}],topPaths:[{path:'/fr/cart.html?email=private',views:25}]}}};
  const $=cheerio.load(view.analytics(payload,'d30',{veste:'<img src=x onerror=unsafe>'}));
  assert.equal($('img,[onerror],script').length,0);assert.match($.text(),/Panier · FR/);assert.match($.text(),/Lecture partielle/);assert.match($.text(),/0,5 %/);assert.doesNotMatch($.text(),/email=private/);
});
test('la lecture analytique pagine sans écrire et filtre les erreurs fournisseur',async()=>{
  const calls=[];const row={event_type:'pageview',path:'/shop',created_at:new Date().toISOString()};
  const sb={from:name=>({select(fields){if(name==='analytics_events')assert(!fields.includes('referrer'));return this;},order(){return this;},limit:async()=>({data:[]}),range:async(a,b)=>{calls.push([a,b]);return{data:a===0?Array.from({length:1000},()=>row):[row]};}})};
  const response=await adminAnalytics(sb);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).summary.d7.counts.pageview,1001);assert.deepEqual(calls,[[0,999],[1000,1999]]);
  sb.from=()=>({select(){return this;},order(){return this;},range:async()=>({error:{message:'private SQL token'}})});
  const failure=await adminAnalytics(sb);assert.equal(failure.statusCode,503);assert.doesNotMatch(failure.body,/SQL|token|private/);
});
test('une panne du bilan ne révèle pas les messages SQL privés ni de faux totaux',async()=>{
  const sb={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({error:{message:'private settings token'}})})};
  const result=await adminSales(sb,{period:'d7'});assert.equal(result.statusCode,503);assert.doesNotMatch(result.body,/token|settings|private/);assert.equal(JSON.parse(result.body).totals,undefined);
});
test('la nouvelle lecture de visites exige la session admin et le quota avant toute lecture',async()=>{
  for(const allowed of [false,true]){
    const exports={},calls=[];
    const shared={json:(statusCode,data)=>({statusCode,body:JSON.stringify(data)}),isConfigured:()=>true,getSupabase:()=>({}),readBody:()=>({action:'analyticsSummary'}),requireAdmin:async()=>({ok:allowed}),rateLimit:async()=>{calls.push('quota');return null;}};
    vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js','utf8'),{exports,process:{env:{}},Buffer,require:name=>name==='./shared'?shared:name==='./lib/admin-analytics'?{adminAnalytics:async()=>{calls.push('read');return shared.json(200,{});}}:name==='crypto'?require('node:crypto'):name==='./lib/product-assistant'?{categories:require('../public/js/categories').codes}:name==='../../public/js/product-media'?require('../public/js/product-media'):name==='../../public/js/product-sizes'?require('../public/js/product-sizes'):class Stripe{}});
    assert.equal((await exports.handler({httpMethod:'POST'})).statusCode,allowed?200:401);assert.deepEqual(calls,allowed?['quota','read']:[]);
  }
});
function dashboard(){
  const nodes={},requests=[],events={},listeners={};let owner='local-admin';
  function el(id){return nodes[id]||(nodes[id]={value:id==='statsPeriod'?'d30':'',innerHTML:'',textContent:'',disabled:false,children:[],addEventListener(name,handler){listeners[id+':'+name]=handler;},appendChild(node){this.children.push(node);}});}
  const api={token:()=>owner,call:(action,body)=>new Promise((resolve,reject)=>requests.push({action,body,resolve,reject}))};
  const window={HN_ADMIN:api,HN_DASHBOARD_VIEW:{finance:data=>'finance:'+data.totals.revenueCents,analytics:(data,period)=>'visits:'+period+':'+data.summary[period].counts.pageview}};
  const document={getElementById:el,createElement:()=>({}),addEventListener(name,handler){events[name]=handler;}};
  vm.runInNewContext(fs.readFileSync('public/js/admin-dashboard.js','utf8'),{window,document,Promise,Date});
  return{nodes,requests,events,listeners,window,load:window.HN_DASHBOARD.load,logout(){owner='';events['hn:admin-logout']();}};
}
const financial=revenue=>({totals:{revenueCents:revenue},currency:{code:'eur'},products:[]});
const traffic=pages=>({summary:{d30:{counts:{pageview:pages}}}});
test('une réponse tardive d’une période précédente ne remplace jamais les derniers chiffres',async()=>{
  const d=dashboard(),first=d.load(),second=d.load();
  d.requests[2].resolve(financial(900));d.requests[3].resolve(traffic(90));await second;
  assert.equal(d.nodes.dashboardFinance.innerHTML,'finance:900');
  d.requests[0].resolve(financial(100));d.requests[1].resolve(traffic(10));await first;
  assert.equal(d.nodes.dashboardFinance.innerHTML,'finance:900');assert.equal(d.nodes.dashboardTraffic.innerHTML,'visits:d30:90');
});
test('une panne financière n’invente aucun montant et les données sont effacées à la déconnexion',async()=>{
  const d=dashboard(),request=d.load();d.requests[0].reject(new Error('Database unavailable'));d.requests[1].resolve(traffic(42));await request;
  assert.equal(d.nodes.dashboardFinance.innerHTML,'');assert.match(d.nodes.dashboardFinance.children.at(-1).textContent,/montants ne sont pas disponibles/);assert.equal(d.nodes.dashboardTraffic.innerHTML,'visits:d30:42');
  const late=d.load();d.logout();d.requests[2].resolve(financial(999));d.requests[3].resolve(traffic(99));await late;
  assert.equal(d.nodes.dashboardFinance.textContent,'');assert.equal(d.nodes.dashboardTraffic.textContent,'');assert.equal(d.nodes.refreshStatsBtn.disabled,false);
});
test('le tableau de bord épingle une même période aux deux lectures et refuse des réponses de périmètres différents',async()=>{
  const d=dashboard(),reporting={id:'fixture-period',scope:'history'};
  d.window.HN_ACTIVITY_PERIOD={context:async()=>({reporting_scope:'history',expected_reporting_period:reporting.id})};
  const request=d.load();await new Promise(resolve=>setImmediate(resolve));assert.equal(d.requests.length,2);
  for(const item of d.requests){assert.equal(item.body.reporting_scope,'history');assert.equal(item.body.expected_reporting_period,reporting.id);}
  d.requests[0].resolve({...financial(100),reporting});d.requests[1].resolve({...traffic(10),reporting:{...reporting,scope:'current'}});await request;
  assert.equal(d.nodes.dashboardFinance.innerHTML,'');assert.equal(d.nodes.dashboardTraffic.innerHTML,'');assert.match(d.nodes.dashboardFinance.children.at(-1).textContent,/Période non confirmée/);
});
