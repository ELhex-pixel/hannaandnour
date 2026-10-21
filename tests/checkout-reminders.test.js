const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {message,orderLocale}=require('../netlify/functions/lib/customer-email');
function fixture(options={}){
  const state={queries:[],claims:[],emails:[],claimed:new Set(),reads:[]};
  const rows=options.rows||[{id:'fixture',order_number:'HN-LOCAL',email:'fixture@example.test',customer_name:'Local',cart_restore_token:'a'.repeat(48),checkout_lang:'fr',stripe_session_id:'cs_local',stripe_creation_started:true,total_cents:1000,currency:'eur'}];
  const sb={from(){const query={then(resolve){return Promise.resolve({data:rows,error:options.queryError}).then(resolve);}};for(const name of ['select','in','is','lte','gte','order','limit'])query[name]=(...args)=>{state.queries.push([name,...args]);return query;};return query;},async rpc(name,args){assert.equal(name,'claim_checkout_reminder');state.claims.push(args.p_order_id);if(options.noClaim||state.claimed.has(args.p_order_id))return{data:false};state.claimed.add(args.p_order_id);return{data:true};}};
  const provider={checkout:{sessions:{async retrieve(id){state.reads.push(id);if(options.providerFailure)throw Error('private key');return{id,client_reference_id:rows.find(r=>r.stripe_session_id===id).id,metadata:{order_id:rows.find(r=>r.stripe_session_id===id).id},mode:'payment',amount_total:1000,currency:'eur',status:'expired',payment_status:'unpaid',...options.session};}}}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('netlify/functions/lib/checkout-reminders.js','utf8'),{module,Date,process:{env:options.noEmail?{}:{RESEND_API_KEY:'fixture-only'}},console:{error(){}},require:name=>name==='stripe'?class{constructor(){throw Error('No real provider allowed');}}:name==='./customer-email'?{message,orderLocale}:{siteUrl:'https://example.test'}});
  const send=async mail=>{state.emails.push(mail);if(options.lostSend)throw Error('unknown SMTP outcome');return{ok:true};};
  return{state,rows,run:()=>module.exports.sendCheckoutReminders(sb,send,provider)};
}
test('une seule relance après deux heures, avant 72h, inclut le lien personnel et reprend la bonne langue',async()=>{
  for(const lang of ['fr','en','ar']){
    const f=fixture();f.rows[0].checkout_lang=lang;assert.equal(await f.run(),1);assert.equal(await f.run(),0);assert.equal(f.state.emails.length,1);assert.match(f.state.emails[0].html,new RegExp('/'+lang+'/cart.html\\?restore='));assert.match(f.state.emails[0].html,new RegExp('lang="'+lang+'"'));assert(f.state.queries.some(([method,key])=>method==='lte'&&key==='created_at'));assert(f.state.queries.some(([method,key])=>method==='gte'&&key==='created_at'));assert(f.state.queries.some(([method,list])=>method==='in'&&list==='status'));
  }
});
test('paiement déjà confirmé, autorisation en traitement, identité erronée ou lecture incertaine n’envoient aucun rappel',async()=>{
  for(const options of [{session:{status:'complete',payment_status:'paid'}},{session:{status:'complete',payment_status:'unpaid'}},{session:{client_reference_id:'other'}},{session:{metadata:{order_id:'other'}}},{session:{amount_total:1}},{session:{currency:'usd'}},{providerFailure:true},{noEmail:true},{noClaim:true}]){
    const f=fixture(options);assert.equal(await f.run(),0);assert.equal(f.state.emails.length,0);
  }
  const unknown=fixture({rows:[{id:'uncertain',email:'fixture@example.test',cart_restore_token:'a'.repeat(48),stripe_creation_started:true}]});assert.equal(await unknown.run(),0);assert.equal(unknown.state.claims.length,0);
});
test('le claim précède SMTP et une réponse d’envoi perdue ne lance pas un second email',async()=>{
  const f=fixture({lostSend:true});assert.equal(await f.run(),0);assert.equal(f.state.claims.length,1);assert.equal(f.state.emails.length,1);assert.equal(await f.run(),0);assert.equal(f.state.emails.length,1);
});
