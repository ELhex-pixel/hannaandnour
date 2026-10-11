const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const orderId='11111111-1111-4111-8111-111111111111',opId='22222222-2222-4222-8222-222222222222',itemId='33333333-3333-4333-8333-333333333333';
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners={};this.parentNode=null;this.value='';this.disabled=false;this.hidden=false;this._text='';this.classList={contains:name=>name==='open'};}
  appendChild(el){this.children.push(el);el.parentNode=this;return el;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(el=>el!==this);this.parentNode=null;}
  set textContent(value){this._text=String(value);this.children.forEach(el=>{el.parentNode=null;});this.children=[];}
  get textContent(){return this._text+this.children.map(el=>el.textContent).join('');}
  get isConnected(){return this.connected===true||!!this.parentNode?.isConnected;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  getAttribute(key){return this.attributes[key]??null;}
  hasAttribute(key){return Object.hasOwn(this.attributes,key);}
  addEventListener(kind,fn){(this.listeners[kind]||=([])).push(fn);}
  fire(kind){for(const fn of this.listeners[kind]||[])fn({target:this});}
  querySelectorAll(selector){const choices=selector.split(',');const list=[];function visit(el){for(const child of el.children){if(choices.some(choice=>choice.startsWith('[')?child.hasAttribute(choice.slice(1,-1)):child.tagName===choice.toUpperCase()))list.push(child);visit(child);}}visit(this);return list;}
}
function ui(responder){
  const body=new Element('div');body.connected=true;body.id='orderModalBody';body.setAttribute('data-order-id',orderId);
  const modal=new Element('div');modal.id='orderModal';const storage=new Map(),events={},calls=[],updates=[];
  let token='fixture-session';
  const document={createElement:tag=>new Element(tag),getElementById:id=>id===modal.id?modal:id===body.id?body:(()=>{let found=null;function visit(el){if(el.id===id)found=el;for(const child of el.children)visit(child);}visit(body);return found;})(),addEventListener:(name,fn)=>{events[name]=fn;}};
  const info={order_id:orderId,refunded_cents:0,remaining_cents:1000,currency:'eur',pending_operation:null,operations:[],items:[{id:itemId,product_name:'Article local',variant:'Noir / M',quantity:2,refunded_quantity:0}]};
  const quote={order_id:orderId,amount_cents:701,currency:'eur',refunded_cents:0,shipping_cents:0,lines:[{id:itemId,product_name:'Article local',quantity:1,amount_cents:701}]};
  const window={HN_ADMIN:{token:()=>token,call:async(action,data)=>{calls.push({action,data:JSON.parse(JSON.stringify(data))});if(action==='getOrderRefunds')return{info};if(action==='quoteOrderRefund')return{quote};return responder(action,data);}}};
  vm.runInNewContext(fs.readFileSync('public/js/admin-refunds.js','utf8'),{window,document,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},confirm:()=>true,crypto:{randomUUID:()=>opId},Date});
  function open(){window.HN_ADMIN_REFUNDS.open({id:orderId},message=>{updates.push(message);});}
  function button(text){return body.querySelectorAll('button').find(el=>el.textContent===text);}
  async function choose(){const quantity=body.querySelectorAll('[data-refund-item]')[0];quantity.value='1';quantity.fire('input');document.getElementById('refundReason').value='Retour local';document.getElementById('refundReason').fire('input');button('Calculer le remboursement').fire('click');await settle();}
  return{open,choose,button,body,document,storage,calls,updates,info,logout:()=>{token='';events['hn:admin-logout']();}};
}
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};
test('la confirmation ne double pas un envoi et une réponse perdue reprend le même identifiant et montant',async()=>{
  let reject,attempt=0;
  const mock=ui(async()=>{if(++attempt===1)return new Promise((resolve,no)=>{reject=no;});return{ok:true,status:'succeeded',operation_id:opId,amount_cents:701};});
  mock.open();await settle();await mock.choose();const confirm=mock.button('Confirmer le remboursement');confirm.fire('click');confirm.fire('click');await settle();
  assert.equal(mock.calls.filter(call=>call.action==='refundOrderPartial').length,1);
  reject(new Error('Connexion interrompue'));await settle();assert.equal(mock.updates.length,0);assert(mock.storage.has('hn-admin-refund-operation'));
  mock.button('Vérifier / reprendre la même opération').fire('click');await settle();
  const requests=mock.calls.filter(call=>call.action==='refundOrderPartial');assert.equal(requests.length,2);assert.deepEqual(requests[0].data,requests[1].data);assert.equal(requests[0].data.operation_id,opId);assert.equal(requests[0].data.expected_amount_cents,701);
  assert.equal(mock.updates.length,1);assert.equal(mock.storage.has('hn-admin-refund-operation'),false);
});
test('un statut pending ou une réponse au montant incohérent ne produit pas de faux succès',async()=>{
  for(const response of [{ok:false,status:'pending',operation_id:opId,amount_cents:701},{ok:true,status:'succeeded',operation_id:opId,amount_cents:700}]){
    const mock=ui(async()=>response);mock.open();await settle();await mock.choose();mock.button('Confirmer le remboursement').fire('click');await settle();
    assert.equal(mock.updates.length,0);assert(mock.storage.has('hn-admin-refund-operation'));assert.equal(mock.button('Vérifier / reprendre la même opération').hidden,false);
    mock.button('Confirmer le remboursement').fire('click');await settle();assert.equal(mock.calls.filter(call=>call.action==='refundOrderPartial').length,1);
  }
});
test('les champs invalides ne lancent pas de devis et une réponse tardive après déconnexion est ignorée',async()=>{
  let resolve;const mock=ui(async()=>new Promise(yes=>{resolve=yes;}));mock.open();await settle();mock.button('Calculer le remboursement').fire('click');await settle();assert.equal(mock.calls.filter(call=>call.action==='quoteOrderRefund').length,0);
  await mock.choose();mock.button('Confirmer le remboursement').fire('click');await settle();mock.logout();resolve({ok:true,status:'succeeded',operation_id:opId,amount_cents:701});await settle();
  assert.equal(mock.updates.length,0);assert.equal(mock.document.getElementById('partialRefundPanel'),null);assert.equal(mock.storage.size,0);
});
