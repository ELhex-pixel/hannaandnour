const { createHash } = require('node:crypto');
const Stripe = require('stripe');
const { json, sendEmail } = require('../shared');
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const messages = {
  refund_order_busy: 'Une opération est déjà en cours. Vérifiez ou reprenez cette même opération.',
  refund_quote_changed: 'Le remboursement a changé. Actualisez la commande et confirmez un nouveau devis.',
  refund_operation_mismatch: 'Cet identifiant appartient à une autre sélection. Reprenez l’opération initiale.',
  refund_external_reconciliation: 'Un remboursement effectué hors de ce journal doit être rapproché avant de rembourser des articles.',
  refund_allocation_unavailable: 'Cette ancienne commande ne possède pas une répartition exacte des remises. Utilisez le remboursement du solde ou rapprochez-la dans Stripe.',
  refund_quantity_unavailable: 'La quantité dépasse les unités encore remboursables.',
  refund_shipping_unavailable: 'Les frais de livraison sont déjà remboursés ou nuls.',
  refund_item_unavailable: 'Un article ne correspond pas à cette commande.',
  refund_order_unavailable: 'Cette commande n’est pas disponible pour un nouveau remboursement.',
  refund_amount_unavailable: 'Le montant est nul ou dépasse le solde remboursable.'
};
async function rpc(sb, name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) { const problem = new Error(messages[error.message] || 'Remboursement non confirmé. Actualisez et reprenez la même opération.'); problem.status = error.code === 'P0001' || messages[error.message] ? 409 : 503; throw problem; }
  return data;
}
async function orderById(sb, id) {
  const { data, error } = await sb.from('orders').select('id,order_number,status,currency,total_cents,refunded_cents,payment_intent_id,stripe_session_id,email,customer_name').eq('id', id).maybeSingle();
  if (error) throw new Error('Order read failed');
  if (!data) { const error = new Error('Commande introuvable.'); error.status = 404; throw error; }
  return data;
}
async function operationById(sb, id) {
  const { data, error } = await sb.from('order_refund_operations').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('Refund journal unavailable');
  return data;
}
function selection(body) {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50 || typeof body.refund_shipping !== 'boolean') throw Object.assign(new Error('Sélectionnez des articles et des quantités entières.'), { status: 400 });
  const seen = new Set();
  return body.items.map(item => {
    if (!item || !ID.test(item.id || '') || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999999 || seen.has(item.id.toLowerCase())) throw Object.assign(new Error('Sélection ou quantité invalide.'), { status: 400 });
    seen.add(item.id.toLowerCase()); return { id: item.id.toLowerCase(), quantity: item.quantity };
  }).sort((a,b) => a.id.localeCompare(b.id));
}
function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Stripe n’est pas configuré.'), { status: 503 });
  return new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 0 });
}
async function payment(stripe, order) {
  let id = order.payment_intent_id;
  if (!id && order.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    id = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  }
  if (!id) throw Object.assign(new Error('Aucun paiement enregistré pour cette commande. Vérifiez son association dans Stripe.'), { status: 409 });
  const intent = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
  const charge = typeof intent.latest_charge === 'string' ? await stripe.charges.retrieve(intent.latest_charge) : intent.latest_charge;
  if (intent.status !== 'succeeded' || intent.amount_received !== order.total_cents || intent.currency !== order.currency || !charge || charge.amount !== order.total_cents || charge.currency !== order.currency || !charge.paid || !charge.captured || (intent.metadata?.order_id && intent.metadata.order_id !== order.id)) throw Object.assign(new Error('Le paiement, le montant ou la devise ne correspond pas à la commande.'), { status: 409 });
  return { intent, charge };
}
async function synchronizeBeforeClaim(sb, stripe, order) {
  const value = await payment(stripe, order);
  if (value.charge.amount_refunded !== order.refunded_cents) {
    await rpc(sb, 'reconcile_order_refund', { p_order_id: order.id, p_intent: value.intent.id, p_amount: value.charge.amount, p_currency: value.charge.currency, p_refunded: value.charge.amount_refunded });
    throw Object.assign(new Error('Un remboursement Stripe a été rapproché. Actualisez avant de confirmer.'), { status: 409 });
  }
  return value;
}
async function findExistingRefund(stripe, intent, operation) {
  let after;
  for (let page = 0; page < 10; page++) {
    const result = await stripe.refunds.list({ payment_intent: intent, limit: 100, ...(after ? { starting_after: after } : {}) });
    const found = result.data.find(refund => refund.metadata?.operation_id === operation.id);
    if (found) return found;
    if (!result.has_more) return null;
    after = result.data.at(-1)?.id;
    if (!after) break;
  }
  throw new Error('Refund history requires reconciliation');
}
async function notify(sb, order, operation) {
  if (!process.env.RESEND_API_KEY) return;
  const claimed = await rpc(sb, 'claim_order_refund_email', { p_id: operation.id });
  if (!claimed) return;
  try {
    const { orderLocale, message } = require('./customer-email');
    await sendEmail({ to:order.email, ...message('refund', await orderLocale(order), { order, amount_cents:operation.amount_cents, currency:operation.currency }) });
  } catch (error) { console.error('Refund confirmation email not delivered'); }
}
async function execute(sb, order, operation, stripe, email = true) {
  if (operation.status === 'succeeded') { if (email) await notify(sb, order, operation); return { ok:true,already:true,operation_id:operation.id,status:'succeeded',amount_cents:operation.amount_cents }; }
  if (operation.status === 'failed') return { ok:false,status:'failed',operation_id:operation.id,error:'Ce remboursement a échoué dans Stripe. Une nouvelle opération doit être confirmée.' };
  const { intent } = await payment(stripe, order);
  let refund;
  if (operation.stripe_refund_id) refund = await stripe.refunds.retrieve(operation.stripe_refund_id);
  else {
    const first = await rpc(sb, 'start_order_refund', { p_id: operation.id });
    if (!first) {
      refund = await findExistingRefund(stripe, intent.id, operation);
      if (!refund && (!operation.stripe_started_at || Date.now() - Date.parse(operation.stripe_started_at) >= 23 * 3600000)) throw Object.assign(new Error('Résultat ancien incertain : rapprochez cette opération dans Stripe avant toute nouvelle demande.'), { status:409 });
    }
    if (!refund) refund = await stripe.refunds.create({ payment_intent:intent.id,amount:operation.amount_cents,reason:'requested_by_customer',metadata:{ operation_id:operation.id,order_id:order.id } }, { idempotencyKey:'hn-refund-' + operation.id });
  }
  const refundIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
  if (refund.amount !== operation.amount_cents || refund.currency !== operation.currency || refundIntent !== intent.id || (refund.metadata?.operation_id && refund.metadata.operation_id !== operation.id)) throw new Error('Refund response mismatch');
  const status = refund.status === 'succeeded' ? 'succeeded' : ['failed','canceled'].includes(refund.status) ? 'failed' : ['pending','requires_action'].includes(refund.status) ? 'pending' : null;
  if (!status) throw new Error('Unknown refund state');
  let cumulative = null;
  if (status === 'succeeded') {
    const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.amount !== order.total_cents || charge.currency !== order.currency || (typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id) !== intent.id) throw new Error('Refund charge mismatch');
    cumulative = charge.amount_refunded;
  }
  const saved = await rpc(sb,'finish_order_refund',{ p_id:operation.id,p_refund:refund.id,p_status:status,p_amount:refund.amount,p_currency:refund.currency,p_intent:intent.id,p_cumulative:cumulative });
  if (saved.status === 'succeeded' && email) await notify(sb,order,saved);
  return { ok:saved.status === 'succeeded',operation_id:saved.id,status:saved.status,amount_cents:saved.amount_cents };
}
async function fullRefund(sb, order, options = {}) {
  const fresh = await orderById(sb, order.id);
  if (fresh.status === 'refunded' && fresh.refunded_cents === fresh.total_cents) {
    await rpc(sb,'restock_order',{p_order_id:fresh.id});
    return { ok:true,already:true,status:'succeeded' };
  }
  const info = await rpc(sb,'order_refund_info',{ p_order:fresh.id });
  const stripe = options.stripe || stripeClient();
  if (info.pending_operation) {
    const existing = await operationById(sb,info.pending_operation);
    if (existing.kind !== 'full') throw Object.assign(new Error(messages.refund_order_busy),{status:409});
    return execute(sb,fresh,existing,stripe,options.email !== false);
  }
  await synchronizeBeforeClaim(sb,stripe,fresh);
  const quote = await rpc(sb,'order_refund_quote',{ p_order:fresh.id,p_kind:'full',p_items:[],p_shipping:false });
  const failed = info.operations.filter(row => row.kind==='full' && row.status==='failed').map(row=>row.id).sort().join(',');
  const digest = createHash('sha256').update('full-refund:' + fresh.id + ':' + fresh.refunded_cents + ':' + failed).digest('hex').slice(0,32);
  const id = [digest.slice(0,8),digest.slice(8,12),digest.slice(12,16),digest.slice(16,20),digest.slice(20)].join('-');
  const operation = await rpc(sb,'claim_order_refund',{ p_id:id,p_order:fresh.id,p_kind:'full',p_items:[],p_shipping:false,p_reason:'Remboursement du solde',p_expected_amount:quote.amount_cents,p_expected_currency:quote.currency,p_expected_refunded:quote.refunded_cents });
  return execute(sb,fresh,operation,stripe,options.email !== false);
}
async function adminRefunds(sb, action, body) {
  let operationId = body.operation_id;
  try {
    if (!ID.test(body.id || '')) return json(400,{error:'Identifiant de commande invalide.'});
    if (action === 'getOrderRefunds') return json(200,{info:await rpc(sb,'order_refund_info',{p_order:body.id})});
    if (action === 'quoteOrderRefund') return json(200,{quote:await rpc(sb,'order_refund_quote',{ p_order:body.id,p_kind:'partial',p_items:selection(body),p_shipping:body.refund_shipping })});
    const order = await orderById(sb,body.id);
    if (action === 'refundOrder') { const result = await fullRefund(sb,order); return json(result.ok?200:202,result); }
    if (!ID.test(operationId || '')) return json(400,{error:'Identifiant d’opération invalide.'});
    const existing = await operationById(sb,operationId);
    if (action === 'resumeOrderRefund') {
      if (!existing || existing.order_id !== order.id) return json(404,{error:'Opération introuvable.'});
      const result = await execute(sb,order,existing,stripeClient()); return json(result.ok?200:202,result);
    }
    if (action !== 'refundOrderPartial') return json(400,{error:'Action inconnue.'});
    const items = selection(body), reason = String(body.reason || '').trim();
    if (reason.length < 3 || reason.length > 500 || !Number.isSafeInteger(body.expected_amount_cents) || body.expected_amount_cents <= 0 || !Number.isSafeInteger(body.expected_refunded_cents) || body.expected_refunded_cents < 0 || !['eur','usd'].includes(body.expected_currency)) return json(400,{error:'Un motif et un devis confirmé sont requis.'});
    const stripe = stripeClient();
    if (!existing) await synchronizeBeforeClaim(sb,stripe,order);
    const operation = await rpc(sb,'claim_order_refund',{ p_id:operationId,p_order:order.id,p_kind:'partial',p_items:items,p_shipping:body.refund_shipping,p_reason:reason,p_expected_amount:body.expected_amount_cents,p_expected_currency:body.expected_currency,p_expected_refunded:body.expected_refunded_cents });
    const result = await execute(sb,order,operation,stripe);return json(result.ok?200:202,result);
  } catch (error) {
    return json(error.status || 503,{ error:error.status ? error.message : 'Résultat non confirmé. Vérifiez ou reprenez la même opération ; ne créez pas une nouvelle demande.', ...(operationId ? { operation_id:operationId } : {}) });
  }
}
module.exports = { adminRefunds, fullRefund, execute };
