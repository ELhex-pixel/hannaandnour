const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cheerio=require('cheerio');
const {summarize}=require('../netlify/functions/lib/admin-analytics');
const preferencesSource=fs.readFileSync('public/js/analytics-preferences.js','utf8');
function browser(options={}){
  const values=options.values||new Map(),session=new Map(options.admin?[['hn-admin-token','private-admin-token']]:[]),events={},notices=[],beacons=[],calls=[];
  const localStorage={getItem:key=>{if(options.denied)throw Error('storage denied');return values.get(key)||null;},setItem:(key,value)=>{if(options.denied)throw Error('storage denied');values.set(key,value);},removeItem:key=>{if(options.denied)throw Error('storage denied');values.delete(key);}};
  const sessionStorage={getItem:key=>session.get(key)||null,removeItem:key=>session.delete(key)};
  const window={localStorage,sessionStorage,location:{pathname:options.path||'/fr/shop.html'},navigator:{sendBeacon:(...args)=>beacons.push(args)},addEventListener:(name,fn)=>events[name]=fn};
  const document={body:{hasAttribute:()=>!!options.preview},dispatchEvent:event=>notices.push(event.type)};
  const context={window,document,sessionStorage,localStorage,CustomEvent:function(type){this.type=type;},Blob,fetch:(...args)=>{calls.push(args);return Promise.resolve();},apiUrl:name=>'/api/'+name};
  vm.createContext(context);vm.runInContext(preferencesSource,context);
  const store=fs.readFileSync('public/js/store.js','utf8');vm.runInContext(store.slice(store.indexOf('  function track('),store.indexOf('  function readLS(')),context);
  return{api:window.HN_ANALYTICS,values,session,window,events,notices,beacons,calls,track:(type='pageview')=>context.track(type,'local-product')};
}
test('un visiteur ordinaire ou connecté comme client reste compté ; le suivi ne transporte ni identité ni jeton admin',async()=>{
  const f=browser();assert.equal(f.api.shouldTrack(),true);for(const type of ['pageview','product_view','add_to_cart','checkout_attempt'])f.track(type);assert.equal(f.beacons.length,4);
  for(const[,blob]of f.beacons){const body=JSON.parse(await blob.text());assert.equal(body.path,'/fr/shop.html');assert.deepEqual(Object.keys(body).sort(),['path','product_slug','type']);assert(!JSON.stringify(body).includes('token'));}
  f.window.navigator={};f.track();assert.equal(f.calls.length,1);
});
test('la session admin marque ce navigateur entre onglets et après déconnexion, chaque événement est arrêté avant le réseau',()=>{
  const f=browser({admin:true});assert.equal(f.values.get('hn-analytics-excluded'),'1');assert.equal(f.api.state().device,true);
  for(const type of ['pageview','product_view','add_to_cart','checkout_attempt'])f.track(type);assert.equal(f.beacons.length,0);assert.equal(f.calls.length,0);assert(![...f.values.values()].includes('private-admin-token'));
  f.session.clear();f.track();assert.equal(f.beacons.length,0);
  const tab=browser({values:f.values});tab.track();assert.equal(tab.beacons.length,0);
  tab.api.include();f.events.storage({key:'hn-analytics-excluded'});assert.equal(f.api.shouldTrack(),true);f.track();assert.equal(f.beacons.length,1);
});
test('une exclusion activée depuis un autre onglet s’applique dès l’événement suivant sans recharger la boutique',()=>{
  const values=new Map(),shop=browser({values}),admin=browser({values});shop.track();assert.equal(shop.beacons.length,1);admin.api.exclude();shop.events.storage({key:'hn-analytics-excluded'});shop.track();assert.equal(shop.beacons.length,1);
  assert.equal(shop.api.state().excluded,true);assert(shop.notices.includes('hn:analytics-preference'));
});
test('réactiver ne contourne pas une session admin et un stockage refusé ne promet pas une exclusion persistante',()=>{
  const admin=browser({admin:true});admin.api.include();assert.equal(admin.api.state().device,false);assert.equal(admin.api.state().session,true);assert.equal(admin.api.shouldTrack(),false);admin.session.clear();assert.equal(admin.api.shouldTrack(),true);
  const denied=browser({denied:true});assert.equal(denied.api.shouldTrack(),true);denied.api.exclude();assert.equal(denied.api.state().persistent,false);assert.equal(denied.api.shouldTrack(),false);denied.track();assert.equal(denied.beacons.length,0);
});
test('admin, Stock, impression et preview ne deviennent jamais des visites clients',()=>{
  for(const path of ['/admin','/admin.html','/fr/admin.html','/en/admin','/stock.html','/ar/print.html']){const f=browser({path});f.track();assert.equal(f.beacons.length,0,path);}
  const preview=browser({preview:true});preview.track();assert.equal(preview.beacons.length,0);
});
function handler(options={}){
  const exports={},rows=[],limits=[];
  const shared={json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),isConfigured:()=>true,readBody:e=>JSON.parse(e.body),getSupabase:()=>({from:()=>({insert:async row=>{rows.push(row);return{error:options.error||null};}})}),rateLimit:async(...args)=>{limits.push(args);return null;}};
  vm.runInNewContext(fs.readFileSync('netlify/functions/track.js','utf8'),{exports,console:{error(){}},require:name=>name==='./lib/analytics-path'?require('../netlify/functions/lib/analytics-path'):shared});
  return{rows,limits,run:body=>exports.handler({httpMethod:'POST',headers:{},body:JSON.stringify(body)})};
}
test('serveur : les chemins de gestion sont ignorés avant écriture et quota, les vues publiques restent enregistrées',async()=>{
  for(const path of ['/admin','/fr/admin.html','/stock','/print.html?doc=label','/api/admin','/.netlify/functions/auth']){
    const f=handler();assert.equal((await f.run({type:'pageview',path})).statusCode,202);assert.equal(f.rows.length,0);assert.equal(f.limits.length,0);
  }
  const normal=handler();assert.equal((await normal.run({type:'pageview',path:'/fr/shop.html?private=value'})).statusCode,202);assert.equal(normal.rows.length,1);assert.equal(normal.rows[0].path,'/fr/shop.html');
  const failed=handler({error:{message:'private database secret'}});const r=await failed.run({type:'pageview',path:'/shop'});assert.equal(r.statusCode,503);assert(!r.body.includes('secret'));
});
test('les classements excluent les anciennes pages de gestion sans effacer l’historique ou les événements de vente',()=>{
  const event=(path,type='pageview')=>({path,event_type:type,product_slug:'fixture',created_at:new Date().toISOString()});
  const summary=summarize([event('/fr/admin.html'),event('/stock'),event('/print.html'),event('/api/admin'),event('/shop'),event('/fr/products/fixture.html','product_view'),event('/admin','purchase')]);
  assert.equal(summary.all.counts.pageview,1);assert.equal(summary.all.counts.product_view,1);assert.equal(summary.all.counts.purchase,1);assert.deepEqual(summary.all.topPaths,[{path:'/fr/shop.html',views:1}]);
});
test('le panneau explique les pages vues sans prétendre afficher des personnes uniques et ne modifie aucune donnée financière',()=>{
  const doc=cheerio.load(fs.readFileSync('public/admin.html','utf8'));assert.equal(doc('#panel-stats #analyticsDeviceStatus').length,1);assert.equal(doc('#excludeAnalyticsDevice').length,1);assert.equal(doc('#includeAnalyticsDevice').length,1);
  assert(doc('#panel-stats').text().includes('visiteurs uniques'));assert(doc('#panel-stats').text().includes('Les anciennes visites'));const scripts=doc('script[src]').map((_,node)=>doc(node).attr('src')).get();assert(scripts.indexOf('js/analytics-preferences.js')<scripts.indexOf('js/admin-api.js'));
  const source=fs.readFileSync('public/js/admin-analytics-preferences.js','utf8');assert(!/fetch\(|\.call\(|startActivityPeriod|resetAnalytics/.test(source));
});
