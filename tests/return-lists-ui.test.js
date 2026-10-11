const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const dict=require('../public/js/i18n');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){
  const nodes={},all=[],events={};
  function create(tag){const n={tag,children:[],listeners:{},attrs:{},value:'',hidden:false,disabled:false,open:false,text:'',classList:{toggle(){}},appendChild(child){this.children.push(child);},setAttribute(key,value){this.attrs[key]=value;},getAttribute(key){return this.attrs[key];},addEventListener(type,fn){this.listeners[type]=fn;},focus(){},get textContent(){return this.text+this.children.map(c=>c.textContent).join(' ');},set textContent(value){this.text=String(value);this.children=[];}};all.push(n);return n;}
  const get=id=>nodes[id]||(nodes[id]=create('div'));
  const document={createElement:create,getElementById:get,querySelector:get,addEventListener(type,fn){events[type]=fn;},dispatchEvent(event){if(events[event.type])events[event.type](event);}};
  const find=(root,tag)=>{for(const child of root.children){if(child.tag===tag)return child;const next=find(child,tag);if(next)return next;}return null;};
  const each=(root,fn)=>{root.children.forEach(child=>{fn(child);each(child,fn);});};
  return{document,nodes,all,events,get,find,each};
}
function request(status='requested'){return{id:randomUUID(),order_id:randomUUID(),quantity:1,status,category:'withdrawal',reason:'Retour test',created_at:'2026-10-11T12:00:00Z',orders:{id:randomUUID(),order_number:'HN-RET-TEST',currency:'eur',refunded_cents:0,return_policy:{withdrawal_payer:'customer'}},order_items:{product_name:'Cape test',variant:'Vin / Unique'}};}
function admin(response){
  const d=dom(),storage=new Map(),state={token:'fixture',calls:[],records:[request()]};
  d.get('returnAdminScope').value='open';d.get('returnAdminPageSize').value='10';
  const api={token:()=>state.token,call:async(action,body)=>{state.calls.push({action,body});return response?response(action,body,state):{requests:state.records,total:state.records.length,page:1,limit:10};}};
  vm.runInNewContext(fs.readFileSync('public/js/admin-returns.js','utf8'),{window:{HN_ADMIN:api},document:d.document,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},confirm:()=>true});
  return{...d,state,storage,load:()=>d.get('refreshReturnRequests').listeners.click()};
}

test('les retours admin sont repliés et paginés ; seuls les reçus/refusés proposent Supprimer de la liste',async()=>{
  const records=[request('requested'),request('approved'),request('received'),request('rejected')];
  const ui=admin((action,body)=>({requests:records,total:24,page:body.page,limit:body.limit}));ui.load();await settle();
  assert(ui.nodes.returnRequestsList.children.every(n=>n.tag==='details'&&!n.open));
  const remove=ui.all.filter(n=>n.attrs['data-hide-return']);assert.equal(remove.length,2);
  assert.equal(ui.state.calls[0].body.scope,'open');assert.equal(ui.nodes.returnAdminNext.disabled,false);
  ui.nodes.returnAdminNext.listeners.click();await settle();assert.equal(ui.state.calls[1].body.page,2);
  ui.nodes.returnAdminScope.value='received';ui.nodes.returnAdminScope.listeners.change();await settle();assert.equal(ui.state.calls[2].body.page,1);assert.equal(ui.state.calls[2].body.scope,'received');
});

test('le bouton des retours terminés ne supprime que la ligne choisie et attend une confirmation serveur',async()=>{
  const r=request('received');let release;
  const ui=admin((action,body)=>action==='listReturnRequests'?{requests:[r],total:1}:new Promise(resolve=>{release=()=>resolve({id:body.id,already:false});}));
  ui.load();await settle();const button=ui.all.find(n=>n.attrs['data-hide-return']);
  button.listeners.click();button.listeners.click();assert.equal(ui.state.calls.filter(c=>c.action==='hideCompletedReturn').length,1);
  assert.equal(button.disabled,true);release();await settle();assert(ui.nodes.returnListStatus.textContent.includes('Historique conservé'));
  assert(!ui.state.calls.some(c=>['refundOrder','purgeProducts','deleteOrder','adjustInventory'].includes(c.action)));
});

test('la réception incertaine conserve la même quantité et le même motif pour le réessai',async()=>{
  const r=request('approved'),ui=admin((action,body)=>action==='listReturnRequests'?{requests:[r],total:1}:Promise.reject(new Error('Réponse perdue')));
  ui.load();await settle();const input=ui.all.find(n=>n.tag==='input'),note=ui.all.find(n=>n.tag==='textarea'),button=ui.all.find(n=>n.attrs['data-return-action']==='received');
  input.value='0';note.value='Contrôle physique';button.listeners.click();await settle();
  assert.equal(ui.state.calls[1].body.sellable_quantity,0);assert.equal(ui.storage.size,1);
  input.value='1';note.value='Autre saisie';button.listeners.click();await settle();
  assert.equal(ui.state.calls[2].body.sellable_quantity,0);assert.equal(ui.state.calls[2].body.note,'Contrôle physique');
});

function customer(response){
  const d=dom(),storage=new Map(),state={user:{id:randomUUID()},calls:[],posts:[],orders:[]};
  for(const id of ['accountServices','accountClaimContent','accountReturnsContent','accountServicesMessage'])d.get(id);
  const auth={currentUser:()=>state.user,isAuthed:()=>!!state.user,token:()=> 'fixture-token',ready:Promise.resolve(),call:async(body)=>{state.calls.push(body);return response?response('list',body,state):{orders:state.orders,total:state.orders.length,page:body.page,limit:body.limit};}};
  const context={window:{HN:{api:path=>'/api/'+path,tr:(key,values={})=>(dict.fr[key]||key).replace(/\{(\w+)\}/g,(_,name)=>values[name])},HN_AUTH:auth,crypto:{randomUUID},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}},document:d.document,CustomEvent:function(type){this.type=type;},fetch:async(url,options)=>{const body=JSON.parse(options.body);state.posts.push(body);if(response)return{ok:true,json:async()=>response('post',body,state)};throw new Error('Réponse perdue');}};
  vm.runInNewContext(fs.readFileSync('public/js/account-services.js','utf8'),context);
  return{...d,state,storage,context};
}
function order(){return{id:randomUUID(),order_number:'HN-CLIENT',created_at:'2026-10-11T12:00:00Z',status:'paid',shipping_status:'delivered',delivered_at:new Date().toISOString(),return_policy:{days:14,withdrawal_payer:'customer'},order_items:[{id:randomUUID(),quantity:2,stock_debited:true,return_available_quantity:2,product_name:'Cape test'}],return_requests:[]};}

test('le compte client affiche des commandes repliables, garde les brouillons et applique les filtres serveur',async()=>{
  const o=order(),ui=customer((kind,body)=>({orders:[o],total:20,page:body.page,limit:body.limit}));await settle();
  assert(ui.nodes.accountReturnsContent.children.some(n=>n.tag==='details'&&!n.open));
  const form=ui.find(ui.nodes.accountReturnsContent,'form'),note=ui.find(form,'textarea');note.value='Brouillon conservé';form.listeners.input();
  const next=ui.all.find(n=>n.tag==='button'&&n.textContent==='Suivante');next.listeners.click();await settle();
  assert.equal(ui.state.calls[1].page,2);assert.equal(ui.find(ui.find(ui.nodes.accountReturnsContent,'form'),'textarea').value,'Brouillon conservé');
  assert(ui.state.calls.every(c=>c.return_portal===true));assert.equal(ui.state.posts.length,0);
});

test('un réessai client garde un identifiant stable et ne transforme pas une erreur réseau en demande réussie',async()=>{
  const o=order(),ui=customer((kind,body)=>kind==='list'?{orders:[o],total:1}:Promise.reject(new Error('Réponse perdue')));await settle();
  const form=ui.find(ui.nodes.accountReturnsContent,'form'),note=ui.find(form,'textarea');note.value='Motif initial';
  form.listeners.submit({preventDefault(){}});await settle();assert.equal(ui.state.posts.length,1);assert.equal(ui.storage.size,1);
  note.value='Changement forcé';form.listeners.submit({preventDefault(){}});await settle();
  assert.equal(ui.state.posts[0].operation_id,ui.state.posts[1].operation_id);assert.equal(ui.state.posts[1].reason,'Motif initial');
  assert(ui.nodes.accountReturnsContent.textContent.includes(dict.fr.returnUnconfirmed));
});

test('les nouvelles réponses de retours après déconnexion restent ignorées côté admin et client',async()=>{
  let release;
  const a=admin(()=>new Promise(resolve=>{release=resolve;}));a.load();a.state.token='';a.events['hn:admin-logout']();release({requests:[request('received')],total:1});await settle();assert.equal(a.nodes.returnRequestsList.textContent,'');
  const c=customer(()=>new Promise(resolve=>{release=resolve;}));await settle();c.state.user=null;c.events['hn:auth']();release({orders:[order()],total:1});await settle();assert.equal(c.nodes.accountServices.hidden,true);assert.equal(c.nodes.accountReturnsContent.children.length,0);
});
