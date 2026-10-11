const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
const orderId='11111111-1111-4111-8111-111111111111',opId='22222222-2222-4222-8222-222222222222',itemId='33333333-3333-4333-8333-333333333333';
const payload={id:orderId,operation_id:opId,items:[{id:itemId,quantity:1}],refund_shipping:false,reason:'Retour local',expected_amount_cents:701,expected_currency:'eur',expected_refunded_cents:0};
function scenario(options={}){
  const state={creates:0,reads:0,rpc:[],refunds:[],operation:null,loseFinish:!!options.loseFinish};
  const order={id:orderId,order_number:'HN-LOCAL',status:'paid',currency:'eur',total_cents:1000,refunded_cents:options.refunded||0,payment_intent_id:'pi_local',email:'local@example.test',customer_name:'Local'};
  const charge={id:'ch_local',amount:1000,currency:'eur',payment_intent:'pi_local',amount_refunded:options.refunded||0,paid:true,captured:true};
  const stripe={paymentIntents:{retrieve:async()=>{state.reads++;return{ id:'pi_local',status:'succeeded',amount_received:1000,currency:options.wrongCurrency?'usd':'eur',latest_charge:{...charge},metadata:{order_id:orderId}};}},charges:{retrieve:async()=>({...charge})},refunds:{
    create:async(args,request)=>{state.creates++;state.request={args,request};if(options.networkLost&&!state.refunds.length){const r={id:'re_local',amount:args.amount,currency:'eur',payment_intent:'pi_local',charge:'ch_local',metadata:args.metadata,status:'succeeded'};state.refunds.push(r);charge.amount_refunded+=args.amount;throw new Error('secret provider data');}
      const r={id:'re_local',amount:args.amount,currency:'eur',payment_intent:'pi_local',charge:'ch_local',metadata:args.metadata,status:options.pending?'pending':'succeeded'};state.refunds.push(r);if(r.status==='succeeded')charge.amount_refunded+=r.amount;return r;},
    list:async()=>({data:state.refunds,has_more:false}),retrieve:async id=>state.refunds.find(r=>r.id===id)
  }};
  const sb={from(table){const query={select(){return this;},eq(){return this;},maybeSingle(){return Promise.resolve({data:table==='orders'?{...order}:state.operation,error:null});}};return query;},rpc:async(name,args)=>{
    state.rpc.push(name);
    if(name==='order_refund_info')return{data:{operations:[],pending_operation:state.operation&&['prepared','pending'].includes(state.operation.status)?state.operation.id:null}};
    if(name==='order_refund_quote')return{data:{kind:args.p_kind,amount_cents:args.p_kind==='full'?1000-order.refunded_cents:701,currency:'eur',refunded_cents:order.refunded_cents}};
    if(name==='reconcile_order_refund'){order.refunded_cents=args.p_refunded;return{data:true};}
    if(name==='claim_order_refund'){
      if(options.quoteChanged)return{error:{code:'P0001',message:'refund_quote_changed'}};
      if(!state.operation)state.operation={id:args.p_id,order_id:orderId,kind:args.p_kind,status:'prepared',amount_cents:args.p_expected_amount,currency:args.p_expected_currency,base_refunded_cents:args.p_expected_refunded,request:{items:args.p_items},reason:args.p_reason};
      return{data:{...state.operation}};
    }
    if(name==='start_order_refund'){const first=!state.operation.stripe_started_at;state.operation.stripe_started_at=state.operation.stripe_started_at||new Date().toISOString();return{data:first};}
    if(name==='finish_order_refund'){
      if(state.loseFinish){state.loseFinish=false;return{error:{code:'PGRST000',message:'private database details'}};}
      state.operation.status=args.p_status;state.operation.stripe_refund_id=args.p_refund;if(args.p_status==='succeeded'){order.refunded_cents=args.p_cumulative;if(order.refunded_cents===1000)order.status='refunded';}return{data:{...state.operation}};
    }
    if(name==='restock_order')return{data:false};
    throw new Error('Unexpected RPC '+name);
  }};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('netlify/functions/lib/admin-refunds.js','utf8'),{module,console:{error(){}},process:{env:{STRIPE_SECRET_KEY:'test-only-not-a-real-key'}},require:name=>name==='node:crypto'?crypto:name==='stripe'?class{constructor(){return stripe;}}:{json:(statusCode,body)=>({statusCode,body:JSON.stringify(body)}),sendEmail:async()=>assert.fail('No real email expected')}});
  return{...module.exports,state,order,charge,stripe,sb};
}
test('un devis n’effectue aucun remboursement et les quantités ou devis invalides ne débitent pas Stripe',async()=>{
  const mock=scenario();assert.equal((await mock.adminRefunds(mock.sb,'quoteOrderRefund',payload)).statusCode,200);assert.equal(mock.state.creates,0);assert.equal(mock.state.reads,0);
  assert.equal((await mock.adminRefunds(mock.sb,'refundOrderPartial',{...payload,items:[{id:itemId,quantity:1.5}]})).statusCode,400);assert.equal(mock.state.creates,0);
  const changed=scenario({quoteChanged:true});assert.equal((await changed.adminRefunds(changed.sb,'refundOrderPartial',payload)).statusCode,409);assert.equal(changed.state.creates,0);
  const currency=scenario({wrongCurrency:true});assert.equal((await currency.adminRefunds(currency.sb,'refundOrderPartial',payload)).statusCode,409);assert.equal(currency.state.creates,0);
});
test('le montant et la devise sont issus du journal serveur et les réessais ne créent qu’un remboursement',async()=>{
  const mock=scenario();const first=await mock.adminRefunds(mock.sb,'refundOrderPartial',payload);assert.equal(first.statusCode,200);assert.equal(JSON.parse(first.body).status,'succeeded');
  assert.equal(mock.state.request.args.amount,701);assert.equal(mock.state.request.args.payment_intent,'pi_local');assert.equal(mock.state.request.request.idempotencyKey,'hn-refund-'+opId);
  assert.equal((await mock.adminRefunds(mock.sb,'refundOrderPartial',payload)).statusCode,200);assert.equal(mock.state.creates,1);assert.equal(mock.order.refunded_cents,701);assert.equal(mock.order.status,'paid');
});
test('une réponse Stripe ou base perdue conserve l’opération et la reprend sans second crédit',async()=>{
  for(const options of [{networkLost:true},{loseFinish:true}]){
    const mock=scenario(options),first=await mock.adminRefunds(mock.sb,'refundOrderPartial',payload);
    assert.equal(first.statusCode,503);assert.doesNotMatch(first.body,/secret|private database/);assert.equal(mock.state.operation.status,'prepared');assert.equal(mock.state.creates,1);
    const second=await mock.adminRefunds(mock.sb,'refundOrderPartial',payload);assert.equal(second.statusCode,200);assert.equal(mock.state.creates,1);assert.equal(mock.order.refunded_cents,701);
  }
});
test('un remboursement en attente n’est pas déclaré réussi ; la reprise vérifie le même identifiant',async()=>{
  const mock=scenario({pending:true});const response=await mock.adminRefunds(mock.sb,'refundOrderPartial',payload);assert.equal(response.statusCode,202);assert.equal(JSON.parse(response.body).ok,false);assert.equal(mock.order.refunded_cents,0);
  mock.state.refunds[0].status='succeeded';mock.charge.amount_refunded=701;
  const next=await mock.adminRefunds(mock.sb,'resumeOrderRefund',{id:orderId,operation_id:opId});assert.equal(next.statusCode,200);assert.equal(mock.state.creates,1);assert.equal(mock.order.refunded_cents,701);
});
test('un résultat incertain ancien n’est pas renvoyé aveuglément après expiration de l’idempotence Stripe',async()=>{
  const mock=scenario();mock.state.operation={id:opId,order_id:orderId,kind:'partial',status:'prepared',amount_cents:701,currency:'eur',stripe_started_at:new Date(Date.now()-25*3600000).toISOString()};
  const response=await mock.adminRefunds(mock.sb,'resumeOrderRefund',{id:orderId,operation_id:opId});assert.equal(response.statusCode,409);assert.equal(mock.state.creates,0);assert.equal(mock.state.operation.status,'prepared');
});
test('le remboursement complet porte sur le solde et ne concurrence pas une opération partielle',async()=>{
  const mock=scenario({refunded:400});const response=await mock.adminRefunds(mock.sb,'refundOrder',{id:orderId});assert.equal(response.statusCode,200);assert.equal(mock.state.request.args.amount,600);assert.equal(mock.order.refunded_cents,1000);
  const blocked=scenario();blocked.state.operation={id:opId,order_id:orderId,kind:'partial',status:'prepared'};
  assert.equal((await blocked.adminRefunds(blocked.sb,'refundOrder',{id:orderId})).statusCode,409);assert.equal(blocked.state.creates,0);
});
