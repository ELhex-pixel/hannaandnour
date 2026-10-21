const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cheerio=require('cheerio');
const translations=require('../public/js/i18n');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(responses,search='?session_id=cs_local'){
  const nodes={},titles=Array.from({length:3},()=>({textContent:'paymentCheckingTitle',setAttribute(){}})),state={reads:0,clears:0,timers:[]};
  const node=id=>nodes[id]||(nodes[id]={textContent:'',hidden:id==='paymentConfirmedIcon',style:{},handlers:{},setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn;}});
  const doc={hidden:false,getElementById:node,querySelectorAll:()=>titles,addEventListener(){}};
  const HN={api:name=>'/api/'+name,tr:key=>key,cart:{clear:()=>state.clears++},request:async()=>{const result=responses[Math.min(state.reads++,responses.length-1)];if(result instanceof Error)throw result;return{order:result};}};
  vm.runInNewContext(fs.readFileSync('public/js/success-page.js','utf8'),{window:{HN,location:{search}},document:doc,URLSearchParams,sessionStorage:{removeItem(){}},setTimeout:(fn,delay)=>{state.timers.push({fn,delay});return state.timers.length;},clearTimeout(){}});
  return{nodes,titles,state,node};
}
test('le retour Stripe ne confirme rien avant le statut payé et conserve le panier pendant l’autorisation',async()=>{
  const order={order_number:'HN-LOCAL',total_cents:1000,currency:'eur'};
  const f=fixture([{...order,status:'pending'},{...order,status:'paid'}]);await settle();assert.equal(f.state.clears,0);assert.equal(f.nodes.paymentConfirmedIcon,undefined);assert(f.titles.every(n=>n.textContent==='paymentCheckingTitle'));assert.equal(f.state.timers[0].delay,2000);
  f.state.timers[0].fn();await settle();assert.equal(f.state.clears,1);assert(f.titles.every(n=>n.textContent==='successTitle'));assert.equal(f.nodes.paymentConfirmedIcon.hidden,false);assert.equal(f.nodes.paymentRefresh.hidden,true);assert.equal(f.nodes.successOrderTotal.textContent,'10.00 EUR');
});
test('panne, rupture ou paiement non finalisé ne montrent pas une fausse confirmation et ne vident pas le panier',async()=>{
  for(const value of [new Error('network'),{status:'payment_failed',order_number:'HN-LOCAL',total_cents:1000,currency:'eur'},{status:'abandoned',order_number:'HN-LOCAL',total_cents:1000,currency:'eur'}]){
    const f=fixture([value]);await settle();assert.equal(f.state.clears,0);assert.equal(f.nodes.paymentConfirmedIcon,undefined);assert(f.titles.every(n=>n.textContent!=='successTitle'));
  }
  const missing=fixture([], '');await settle();assert.equal(missing.state.reads,0);assert.equal(missing.node('paymentRefresh').hidden,true);
  const doc=cheerio.load(fs.readFileSync('public/success.html','utf8'));assert.equal(doc('#paymentConfirmedIcon').is('[hidden]'),true);assert(doc('[data-payment-title]').toArray().every(n=>doc(n).attr('data-i18n')==='paymentCheckingTitle'));
});
test('le compte remplace annulation/réservation par un message de reprise email dans les trois langues',()=>{
  const source=fs.readFileSync('public/js/account.js','utf8');
  for(const lang of ['fr','en','ar']){
    const box={innerHTML:''},context={HN:{},tr:key=>translations[lang][key]||key,esc:value=>String(value||'').replace(/</g,'&lt;'),orderMoney:value=>String(value),document:{getElementById:()=>box}};
    vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function emptyState('),source.indexOf('  /* ---------------- Auth-backed account')),context);
    context.renderOrders([{id:'fixture',status:'pending',shipping_status:'new',order_number:'HN-LOCAL',total_cents:1000,currency:'eur',order_items:[]}]);
    const doc=cheerio.load(box.innerHTML);assert.equal(doc('[data-cancel-checkout]').length,0);assert.equal(doc('button').length,0);assert.equal(doc('.order-status').length,1);assert(doc('.account-feedback').text().includes(translations[lang].orderReservationHelp));
    context.renderOrders([{id:'fixture',status:'pending',payment_flow:'authorize_capture',payment_intent_id:'pi_local',order_items:[]}]);assert(cheerio.load(box.innerHTML)('.account-feedback').text().includes(translations[lang].orderPaymentConfirming));
  }
});
