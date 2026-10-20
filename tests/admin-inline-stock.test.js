const test=require('node:test');
const assert=require('node:assert/strict');
const {controller,key}=require('../public/js/admin-inline-stock');
const variant='11111111-1111-4111-8111-111111111111',product='22222222-2222-4222-8222-222222222222',operation='33333333-3333-4333-8333-333333333333';
const row=stock=>({id:variant,stock,color:'Noir',size:'One Size',barcode:'HN-TEST',products:{id:product,name_fr:'Veste'}});
function setup(options={}){
  const memory=options.memory||new Map(),calls=[],updates=[],confirmations=[];let owner='fixture-session',stock=15;
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const model=controller({storage,session:{getItem:()=>null},token:()=>owner,uuid:()=>operation,change(){},confirm:message=>{confirmations.push(message);return options.confirm!==false;},update:value=>updates.push(value),
    call:async(action,payload)=>{calls.push({action,payload:structuredClone(payload)});if(options.call)return options.call(action,payload);if(action==='stockLookup')return{variant:row(stock)};stock=payload.mode==='count'?payload.quantity:payload.mode==='restock'?stock+payload.quantity:stock-payload.quantity;return{result:{operation_id:payload.operation_id,stock_before:15,stock_after:stock}};},...options.dependencies});
  return{model,memory,calls,updates,confirmations,logout(){owner='other-session';},setStock(value){stock=value;}};
}
test('ouvrir la variante relit le stock sans écrire et une correction confirme le nouveau disponible, pas un arrivage',async()=>{
  const ui=setup();await ui.model.open(variant,product,'Veste — Noir');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].action,'stockLookup');assert.equal(ui.model.state.mode,'');assert.equal(ui.model.state.quantity,'');
  ui.model.draft({mode:'count',quantity:'5',reason:'Recomptage physique'});assert.equal(ui.model.preview(),5);await ui.model.save();
  const write=ui.calls.find(c=>c.action==='adjustInventory').payload;assert.deepEqual(write,{operation_id:operation,variant_id:variant,mode:'count',quantity:5,expected_stock:15,reason:'Recomptage physique'});assert.match(ui.confirmations[0],/15 → 5/);assert.equal(ui.model.state.snapshot.stock,5);assert.equal(ui.updates.at(-1).stock,5);assert.equal(ui.memory.has(key),false);
});
test('annulation, motif manquant, stock invalide et dépassements ne créent aucun mouvement',async()=>{
  const ui=setup({confirm:false});await ui.model.open(variant,product,'Veste');
  for(const values of [{mode:'remove',quantity:'16',reason:'Déstockage'},{mode:'restock',quantity:'1000000',reason:'Arrivage'},{mode:'count',quantity:'1.5',reason:'Comptage'},{mode:'count',quantity:'0',reason:'x'},{mode:'restock',quantity:'0',reason:'Arrivage'}]){ui.model.draft(values);await ui.model.save();}
  ui.model.draft({mode:'count',quantity:'0',reason:'Comptage vérifié'});await ui.model.save();assert.equal(ui.calls.filter(c=>c.action==='adjustInventory').length,0);assert.equal(ui.memory.has(key),false);
  const invalid=setup({call:async()=>({variant:row(null)})});await invalid.model.open(variant,product,'Veste');assert.equal(invalid.model.state.snapshot,null);assert.equal(invalid.updates.length,0);
});
test('une réponse perdue fige la même variante et reprend le même UUID et payload après réouverture ou rechargement',async()=>{
  let release;const ui=setup({call:async(action,payload)=>action==='stockLookup'?{variant:row(15)}:new Promise((resolve,reject)=>{release=()=>reject(new Error('Réponse perdue'));})});
  await ui.model.open(variant,product,'Veste');ui.model.draft({mode:'restock',quantity:'3',reason:'Arrivage fournisseur'});const sending=ui.model.save();await ui.model.save();assert.equal(ui.calls.filter(c=>c.action==='adjustInventory').length,1);assert(ui.memory.has(key));release();await sending;
  const original=ui.calls.find(c=>c.action==='adjustInventory').payload;ui.model.draft({quantity:'999'});assert.equal(ui.model.state.quantity,'3');
  const reopened=setup({memory:ui.memory,call:async(action,payload)=>action==='stockLookup'?{variant:row(16)}:{result:{operation_id:payload.operation_id,stock_before:15,stock_after:18,already:true}}});
  await reopened.model.open(product,variant,'Une autre fiche');assert.equal(reopened.model.state.target,original.variant_id);assert.equal(reopened.calls.length,0);await reopened.model.save();assert.deepEqual(reopened.calls[0].payload,original);assert.equal(reopened.model.state.snapshot.stock,16);assert.match(reopened.model.state.message,/sans double mouvement/);assert.equal(ui.memory.has(key),false);
});
test('un conflit certain relit le disponible et exige une nouvelle confirmation ; une réponse incohérente garde l’opération',async()=>{
  let read=0;const ui=setup({call:async(action,payload)=>{if(action==='stockLookup')return{variant:row(++read===1?15:12)};const error=new Error('Stock modifié');error.code='inventory_stock_changed';throw error;}});
  await ui.model.open(variant,product,'Veste');ui.model.draft({mode:'count',quantity:'5',reason:'Comptage'});await ui.model.save();assert.equal(ui.model.state.pending,null);assert.equal(ui.model.state.snapshot.stock,12);assert.equal(ui.calls.filter(c=>c.action==='adjustInventory').length,1);
  const broken=setup({call:async(action)=>action==='stockLookup'?{variant:row(15)}:{result:{operation_id:operation,stock_before:15,stock_after:999}}});await broken.model.open(variant,product,'Veste');broken.model.draft({mode:'remove',quantity:'2',reason:'Pièce abîmée'});await broken.model.save();assert(broken.model.state.pending);assert.equal(broken.updates.length,1);assert.match(broken.model.state.message,/non confirmé/);
});
test('fermer ou changer de session ignore les réponses tardives sans perdre une écriture incertaine',async()=>{
  let release;const ui=setup({call:()=>new Promise(resolve=>{release=resolve;})});const reading=ui.model.open(variant,product,'Veste');ui.model.reset();release({variant:row(15)});await reading;assert.equal(ui.updates.length,0);assert.equal(ui.model.state.visible,false);
  let finish;const writing=setup({call:async(action)=>action==='stockLookup'?{variant:row(15)}:new Promise(resolve=>{finish=resolve;})});await writing.model.open(variant,product,'Veste');writing.model.draft({mode:'restock',quantity:'2',reason:'Arrivage'});const sent=writing.model.save();writing.model.reset();writing.logout();finish({result:{operation_id:operation,stock_before:15,stock_after:17}});await sent;assert(writing.memory.has(key));assert.equal(writing.updates.length,1);assert.equal(writing.model.state.visible,false);assert.equal(writing.model.state.label,'');
});
test('une mémoire indisponible ou une opération déjà en attente dans Stock bloque le nouvel envoi',async()=>{
  for(const dependencies of [{storage:{getItem:()=>null,setItem(){throw new Error('Denied');}}},{session:{getItem:()=>'{pending}'}}]){
    const ui=setup({dependencies});await ui.model.open(variant,product,'Veste');ui.model.draft({mode:'restock',quantity:'2',reason:'Arrivage'});await ui.model.save();assert.equal(ui.calls.filter(c=>c.action==='adjustInventory').length,0);
  }
});
