const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../public/js/shipping-rules'),dict=require('../public/js/i18n');

test('le détecteur Netlify ne renvoie que le pays du contexte serveur et ignore les en-têtes/paramètres forgés',async()=>{
  const {default:handler}=await import('../netlify/functions/shipping-country.mjs');
  const request=new Request('https://example.test/api/shipping-country?country=FR',{headers:{'x-country':'DE','x-forwarded-for':'private-ip','x-nf-geo':JSON.stringify({country:{code:'FR'}})}});
  const response=await handler(request,{geo:{country:{code:'nl',name:'Private name'},city:'Private city',latitude:42,longitude:2},ip:'private-ip'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{country:'NL'});
  assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('Netlify-CDN-Cache-Control'),'no-store');
  for(const value of [undefined,'France','<script>','FR,BE',123]){
    const r=await handler(request,{geo:{country:{code:value}}});assert.deepEqual(await r.json(),{country:null});
  }
  assert.deepEqual(await(await handler(request)).json(),{country:null});
  assert.equal((await handler(new Request(request.url,{method:'POST'}),{geo:{country:{code:'FR'}}})).status,405);
});

function countryClient({choice=null,geo=null,storageDenied=false}={}){
  const values=new Map(),events=[],requests=[];let resolveRequest,rejectRequest,timeout;
  if(choice!==null)values.set('hn-shipping-choice',JSON.stringify(choice));if(geo!==null)values.set('hn-shipping-country-geo',geo);
  const storage={getItem:k=>{if(storageDenied)throw Error('denied');return values.get(k)||null;},setItem:(k,v)=>{if(storageDenied)throw Error('denied');values.set(k,v);}};
  const window={sessionStorage:storage,location:{protocol:'https:'},HN_CONFIG:{API_BASE:'/api'}};
  const context={window,AbortController,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},document:{dispatchEvent:e=>events.push(e)},setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){},fetch:(url,options)=>{requests.push({url,options});return new Promise((resolve,reject)=>{resolveRequest=resolve;rejectRequest=reject;});}};
  vm.runInNewContext(fs.readFileSync('public/js/shipping-country.js','utf8'),context);
  return{api:window.HN_SHIPPING_COUNTRY,values,events,requests,reply:async country=>{resolveRequest({ok:true,json:async()=>({country})});await window.HN_SHIPPING_COUNTRY.ready;},fail:async()=>{rejectRequest(Error('offline'));await window.HN_SHIPPING_COUNTRY.ready;},timeout:async()=>{timeout();await window.HN_SHIPPING_COUNTRY.ready;}};
}
test('la détection est bornée, mémorise uniquement le pays et laisse le choix manuel prioritaire après une réponse tardive',async()=>{
  const auto=countryClient();assert.equal(auto.api.current(),null);assert.equal(auto.api.isReady(),false);assert.equal(auto.requests.length,1);assert.equal(auto.requests[0].url,'/api/shipping-country');assert.equal(auto.requests[0].options.cache,'no-store');
  await auto.reply('NL');assert.equal(auto.api.current(),'NL');assert.equal(auto.api.isReady(),true);assert.equal(auto.values.get('hn-shipping-country-geo'),'NL');assert.equal(auto.values.has('hn-shipping-choice'),false);
  const delayed=countryClient();delayed.api.choose('BE');await delayed.reply('NL');assert.equal(delayed.api.current(),'BE');assert.equal(delayed.api.isManual(),true);assert.equal(delayed.values.has('hn-shipping-country-geo'),false);assert.equal(JSON.parse(delayed.values.get('hn-shipping-choice')).country,'BE');
  const existing=countryClient({choice:{country:'ES',method:'pickup'},geo:'NL'});assert.equal(existing.api.current(),'ES');assert.equal(existing.requests.length,0);
  const cached=countryClient({geo:'NL'});assert.equal(cached.api.current(),'NL');assert.equal(cached.requests.length,0);
  const expired=countryClient();await expired.timeout();assert.equal(expired.api.current(),null);assert.equal(expired.api.isReady(),true);
  const offline=countryClient();await offline.fail();assert.equal(offline.api.current(),null);assert.equal(offline.api.isReady(),true);
  const denied=countryClient({storageDenied:true});await denied.reply('FR');denied.api.choose('BE');assert.equal(denied.api.current(),'BE');
  auto.api.choose('');const cleared=countryClient({choice:JSON.parse(auto.values.get('hn-shipping-choice')),geo:'NL'});assert.equal(cleared.api.current(),null);assert.equal(cleared.requests.length,0);
  const invalid=countryClient();await invalid.reply('<script>');assert.equal(invalid.api.current(),null);assert.equal(invalid.values.size,0);
});

function translator(lang){
  const source=fs.readFileSync('public/js/i18n.js','utf8');
  const context={DICT:dict,lang,Intl,window:{HN_SHIPPING:R,HN:{symbol:()=> '€'}},document:{querySelectorAll:()=>[]}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function t(key, params)'),source.indexOf('  function applyTranslations()')),context);
  return context;
}
test('le bandeau avec promo, le footer et la fiche produit suivent exclusivement le pays et ses règles dans les trois langues',()=>{
  const rules=R.initial({standard_cents:599,pickup_cents:599,express_cents:1500,nextday_cents:2000});
  rules.countries.NL.standard.fee_cents=1599;rules.countries.NL.pickup.fee_cents=712;rules.countries.NL.pickup.free_threshold_cents=12000;
  for(const lang of ['fr','en','ar']){
    const ui=translator(lang);ui.setShippingRules(rules,'FR');
    const fr=ui.t('trustFree');assert(fr.includes(dict[lang].pickupCountryFR));assert(fr.includes('5.99'));assert(fr.includes('80'));assert.equal(ui.t('metaShipText'),fr);
    const promo=ui.t('announcePromo',{code:'WELCOME2026',pct:15});assert(promo.includes(fr));assert(promo.includes('WELCOME2026'));assert(promo.includes('15'));assert(!promo.includes('{shipping}'));
    ui.setShippingRules(rules,'NL');const nl=ui.t('trustFree');assert(nl.includes(dict[lang].pickupCountryNL));assert(nl.includes('15.99'));assert(nl.includes('120'));assert(!nl.includes('80'));assert(ui.t('announcePromo',{code:'WELCOME2026',pct:15}).includes(nl));
    const disabled=JSON.parse(JSON.stringify(rules));disabled.countries.NL.pickup.free_enabled=false;ui.setShippingRules(disabled,'NL');assert(ui.t('trustFree').includes('7.12'));assert(!ui.t('trustFree').includes('120'));
    disabled.countries.NL.pickup.enabled=false;ui.setShippingRules(disabled,'NL');assert(ui.t('trustFree').includes('15.99'));assert(!ui.t('trustFree').includes('7.12'));
    disabled.countries.NL.enabled=false;ui.setShippingRules(disabled,'NL');assert.equal(ui.t('trustFree'),dict[lang].shippingCountryUnavailable.replace('{country}',dict[lang].pickupCountryNL));
    ui.setShippingRules(rules,'US');assert(!ui.t('announcePromo',{code:'WELCOME2026',pct:15}).includes('80'));
    ui.setShippingRules(rules,null);assert.equal(ui.t('trustFree'),dict[lang].shippingCountryGeneric);
    ui.setShippingRules(null,'FR');assert.equal(ui.t('trustFree'),dict[lang].shippingCountryGeneric);
  }
});
