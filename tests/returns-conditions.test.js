const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cheerio=require('cheerio');
const conditions=require('../public/js/returns-conditions');
const {loadReturnsPolicy,renderReturnsPage}=require('../scripts/returns-conditions');
const policy={days:15,withdrawal_payer:'customer',fault_payer:'store'};
test('conditions publiques : trois langues, coordonnées confirmées, frais distincts, notification sans compte et garanties préservées',()=>{
  for(const lang of ['fr','en','ar']){
    const doc=cheerio.load(conditions.render(policy,lang));
    assert.equal(doc('h2').length,11);assert.equal(doc('script,input[required],textarea[required]').length,0);assert(doc('address').text().includes('AOUS'));assert(doc('address').text().includes('17 allée de l’Arlequin'));assert(doc('address').text().includes('92000 Nanterre'));
    assert(doc('a[href="mailto:care@hannanour.com"]').length);assert(doc('a[href="/'+lang+'/contact.html"]').length);assert(doc('a[href="/'+lang+'/account.html#returns"]').length);
    const text=doc.text();assert(text.includes(conditions.copy(lang).customerFees));assert(text.includes(conditions.copy(lang).faultFees));assert(text.includes(conditions.copy(lang).restocking));assert(text.includes(conditions.copy(lang).exchange));assert(text.includes(conditions.copy(lang).history));assert(text.includes('15'));assert(text.includes('14'));assert(text.includes('30'));
    assert.doesNotMatch(text,/demonstration|No order you submit|no payment will be taken|as is|sous deux jours|within two days/i);
  }
  assert.match(conditions.render(policy,'fr'),/14 jours suivant la date à laquelle nous sommes informés/);assert.match(conditions.render(policy,'fr'),/la première de ces dates étant retenue/);
});
test('un réglage modifié suit les jours et le payeur actuels, un réglage absent ne promet jamais une durée commerciale inventée',()=>{
  const changed={days:30,withdrawal_payer:'store'};const html=conditions.render(changed,'fr'),text=cheerio.load(html).text();assert(text.includes('30 jours calendaires'));assert(text.includes(conditions.copy('fr').storeFees));assert(!text.includes(conditions.copy('fr').customerFees));
  for(const value of [null,{}, {days:0,withdrawal_payer:'customer'},{days:13,withdrawal_payer:'customer'},{days:366,withdrawal_payer:'customer'},{days:15,withdrawal_payer:'<script>'}]){
    assert.equal(conditions.validPolicy(value),false);const doc=cheerio.load(conditions.render(value,'fr'));assert(doc.text().includes(conditions.copy('fr').unknownDays));assert.equal(doc('script').length,0);assert(!doc.text().includes('15 jours calendaires'));
  }
  assert.equal(conditions.copy('__proto__').title,conditions.copy('fr').title);
});
test('pré-rendu : lire uniquement la politique, refuser une donnée invalide et publier le texte complet sans JavaScript ni compte',async()=>{
  const calls=[];let value=policy;
  const sb={from(table){calls.push(['from',table]);return{select(columns){calls.push(['select',columns]);return this;},eq(key,id){calls.push(['eq',key,id]);return this;},limit(count){calls.push(['limit',count]);return this;},abortSignal(){return this;},then(resolve){return Promise.resolve({data:[{value}],error:null}).then(resolve);}};}};
  assert.equal(await loadReturnsPolicy(null),null);assert.deepEqual(await loadReturnsPolicy(sb),policy);assert.deepEqual(calls,[['from','settings'],['select','value'],['eq','key','return_policy'],['limit',1]]);
  value={days:2,withdrawal_payer:'customer'};await assert.rejects(loadReturnsPolicy(sb),/politique valide/);
  for(const lang of ['fr','en','ar']){
    const doc=cheerio.load(fs.readFileSync('public/terms.html','utf8'));const originalHeader=doc('header').html(),originalFooter=doc('footer').html();renderReturnsPage(doc,policy,lang);doc('script').remove();
    assert.equal(doc('header').html(),originalHeader);assert.equal(doc('footer').html(),originalFooter);assert.equal(doc('h1').text(),conditions.copy(lang).title);assert.equal(doc('#returnConditions').attr('data-policy-days'),'15');assert.equal(doc('#returnConditions h2').length,11);assert(doc('#returnConditions').text().length>3000);assert.equal(doc('meta[name=description]').attr('content'),conditions.copy(lang).description);assert(!doc('#returnConditions').is('[hidden]'));
  }
});

function browser(options={}){
  const doc=cheerio.load(conditions.render(policy,'fr')),section={innerHTML:doc.html(),getAttribute:name=>name==='data-policy-days'?'15':'customer'};
  const title={textContent:''},crumb={textContent:''},meta={},status={textContent:''},events={},windowEvents={},requests=[];let lang='fr';
  const document={hidden:false,getElementById:id=>id==='returnConditions'?section:status,querySelector:selector=>selector==='h1.page-header-title'?title:meta,querySelectorAll:()=>[crumb],addEventListener:(name,fn)=>events[name]=fn};
  const HN={lang:()=>lang,tr:key=>key==='brandName'?'Hanna & Nour':key,requireConfig:force=>{requests.push(force);return options.result instanceof Error?Promise.reject(options.result):Promise.resolve(options.result||{return_policy:policy});}};
  const window={HN,HN_RETURN_CONDITIONS:conditions,addEventListener:(name,fn)=>windowEvents[name]=fn};
  vm.runInNewContext(fs.readFileSync('public/js/returns-page.js','utf8'),{window,document});
  return{section,title,status,events,windowEvents,requests,setLang:value=>lang=value};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('la page suit les réponses fraîches et les langues, une panne ou une valeur invalide ne remplace jamais les conditions publiées par un cache',async()=>{
  const live=browser({result:{return_policy:{days:30,withdrawal_payer:'store'}}});await settle();assert(live.section.innerHTML.includes('30 jours calendaires'));assert.equal(live.status.textContent,'');live.setLang('ar');live.events.langchange();assert.equal(live.title.textContent,conditions.copy('ar').title);assert(live.section.innerHTML.includes('/ar/contact.html'));
  live.windowEvents.pageshow({persisted:true});await settle();assert.deepEqual(live.requests,[false,true]);
  for(const result of [Error('offline'),{return_policy:{days:1,withdrawal_payer:'customer'}}]){
    const failed=browser({result});const original=failed.section.innerHTML;await settle();assert.equal(failed.section.innerHTML,original);assert.equal(failed.status.textContent,conditions.copy('fr').unavailable);
  }
});
