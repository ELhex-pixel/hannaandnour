const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');

test('l’accueil commun expose les huit tâches et les liens ciblent des parcours existants', () => {
  const $ = cheerio.load(fs.readFileSync('public/admin.html','utf8'));
  const expected = ['/stock.html?view=sale','/stock.html?view=stock','#orders','/stock.html?view=labels','#products','#sales','#returns','#site'];
  assert.deepEqual($('#panel-dashboard .management-shortcut').map((_,node)=>$(node).attr('href')).get(),expected);
  assert.equal($('.admin-panel.active').attr('id'),'panel-dashboard');
  assert.equal($('.admin-tab.active').attr('data-tab'),'dashboard');
  for (const link of expected.filter(value=>value.startsWith('#'))) assert.equal($('#panel-'+link.slice(1)).length,1);
  for (const id of ['orders','products','returns','inventory','preparation','sales','home','blog','promos','stats','messages','settings','reviews','tiktok']) assert.equal($('#panel-'+id).length,1);
  const stock = cheerio.load(fs.readFileSync('public/stock.html','utf8'));
  assert.equal(stock('.stock-header a').attr('href'),'/admin.html#dashboard');
  assert.equal(stock('#paymentStep').is('[hidden]'),true);
  assert.equal(stock('#confirmSale').is('[disabled]'),true);
  assert.equal(stock('#saleBreakdown').is('[open]'),false);
  assert.equal(stock('#scanForm').parents('details').length,1);
});

test('les liens internes ouvrent seulement des rubriques autorisées avec une session et ferment le menu mobile', () => {
  let authenticated = true, clicks = [], focused = 0;
  const classes = () => ({contains:()=>false});
  const navigation = {open:true};
  const heading = {focus(){focused++;},scrollIntoView(){}};
  const listeners = {};
  const buttons = ['dashboard','products','returns'].map(value => {
    const callbacks=[];
    const button={getAttribute:()=>value,classList:classes(),closest:()=>null,addEventListener(type,callback){callbacks.push(callback);},click(){clicks.push(value);callbacks.forEach(fn=>fn());}};
    return button;
  });
  const window = {HN_ADMIN:{token:()=>authenticated?'local-token':''},location:{hash:'#products'},matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(name,callback){listeners[name]=callback;}};
  const document = {getElementById:id=>id==='adminNavigation'?navigation:id==='adminSectionTitle'?heading:id==='appView'?{style:{display:''}}:null,querySelector:()=>null,querySelectorAll:selector=>selector==='.admin-tab'?buttons:[],addEventListener(name,callback){listeners['document:'+name]=callback;}};
  vm.runInNewContext(fs.readFileSync('public/js/management.js','utf8'),{window,document});
  assert.equal(navigation.open,false);assert.deepEqual(clicks,[]);
  listeners.hashchange();assert.deepEqual(clicks,['products']);assert.equal(focused,1);
  window.location.hash='#returns';listeners.popstate();assert.deepEqual(clicks,['products','returns']);
  var prevented=0;
  listeners['document:click']({target:{closest:()=>({getAttribute:()=> '#dashboard'})},button:0,preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.deepEqual(clicks,['products','returns','dashboard']);
  window.location.hash='#" onclick="bad';listeners.hashchange();assert.equal(clicks.length,3);
  authenticated=false;window.location.hash='#products';listeners.hashchange();assert.equal(clicks.length,3);
});

function stockEntry(query='',hash='',stored=null) {
  const nodes={},jobs=[],calls=[];
  const context={revision:0,mode:'sale',location:{search:query,hash,href:'https://example.test/stock.html'+query+hash},URLSearchParams,
    el:id=>nodes[id]||(nodes[id]={hidden:false}),pending:null,readPending:()=>stored,drawCart(){},controls(){},say(){},token:()=> 'local-token',
    setMode(value,keep){context.mode=value;calls.push(['mode',value,keep]);},setTimeout:callback=>jobs.push(callback),run:fn=>fn(),lookup:value=>calls.push(['lookup',value]),listVariants:()=>calls.push(['labels']),history:()=>calls.push(['history'])};
  const source=fs.readFileSync('public/js/stock-app.js','utf8');
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function openApp()'),source.indexOf("  el('loginForm')"))+'\nopenApp();',context);
  return {context,jobs,calls};
}
test('les accès directs Stock et Étiquettes survivent à la connexion sans déclencher de vente', () => {
  for (const view of ['sale','stock','labels','history']) {
    const app=stockEntry('?view='+view);assert.equal(app.context.mode,view);
    app.jobs.forEach(fn=>fn());
    assert.equal(app.calls.filter(call=>call[0]==='labels').length,view==='labels'?1:0);
    assert.equal(app.calls.filter(call=>call[0]==='history').length,view==='history'?1:0);
  }
  const qr=stockEntry('', '#variant=11111111-1111-4111-8111-111111111111');qr.jobs.forEach(fn=>fn());assert.equal(qr.context.mode,'stock');assert.equal(qr.calls[1][0],'lookup');
  assert.equal(stockEntry('?view=unknown').context.mode,'sale');
});
test('un accès direct ne remplace pas une opération incertaine et une déconnexion annule les lectures différées', () => {
  const operation={action:'recordPhysicalSale',body:{operation_id:'local-operation',quote:{total_cents:1200}}};
  const app=stockEntry('?view=labels','',operation);
  assert.equal(app.context.pending,operation);assert.equal(app.context.mode,'sale');assert.equal(app.jobs.length,0);
  const labels=stockEntry('?view=labels');labels.context.revision++;labels.jobs.forEach(fn=>fn());assert.equal(labels.calls.length,1);
});
test('un QR ouvert par Safari conserve la variante après normalisation Netlify de stock.html vers stock', () => {
  const source = fs.readFileSync('public/js/stock-app.js','utf8');
  const id = '11111111-1111-4111-8111-111111111111';
  const context = {URL,location:{origin:'https://hannanour.com'},ID:/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function qrId('),source.indexOf('  function showVariant(')),context);
  for (const route of ['https://hannanour.com/stock.html','https://hannanour.com/stock']) assert.equal(context.qrId(route+'#variant='+id),id);
  for (const route of ['https://foreign.test/stock','https://hannanour.com/admin','https://hannanour.com/stock?variant=bad','https://user:password@hannanour.com/stock']) assert.throws(()=>context.qrId(route+'#variant='+id));
});
