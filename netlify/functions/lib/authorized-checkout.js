const Stripe = require('stripe');
const { json } = require('../shared');

// All calls start from a verified Stripe event or a private recovery journal.
// Provider identity + amount are reread before any allocation/capture/cancellation.
async function settleCheckout(sb, input, notifyPaid, provider) {
  if (!input.client_reference_id) return json(200, { received: true });
  const { data: order, error } = await sb.from('orders').select('id,status,payment_flow,total_cents,currency,stripe_session_id,payment_intent_id').eq('id', input.client_reference_id).maybeSingle();
  if (error) throw error;
  if (!order) throw new Error('Checkout unavailable');
  if (order.payment_flow !== 'authorize_capture') return notifyPaid(input, sb);
  const stripe = provider || new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 5000, maxNetworkRetries: 0 });
  const session = await stripe.checkout.sessions.retrieve(input.id);
  if (!session || session.id !== input.id || (order.stripe_session_id && order.stripe_session_id !== session.id) || session.client_reference_id !== order.id || session.metadata?.order_id !== order.id || session.mode !== 'payment' || session.amount_total !== order.total_cents || session.currency !== order.currency) throw new Error('Checkout identity mismatch');
  if (session.status === 'open' && session.payment_status === 'unpaid') return json(200, { received: true });
  if (session.status === 'expired' && session.payment_status === 'unpaid' && !order.payment_intent_id) {
    const result = await sb.rpc('release_order', { p_order_id: order.id, p_status: 'abandoned' });
    if (result.error) throw result.error;
    return json(200, { received: true });
  }
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
  const free = order.total_cents === 0 && session.status === 'complete' && session.payment_status === 'no_payment_required' && !intentId;
  function validIntent(intent) {
    return intent && intent.id === intentId && intent.metadata?.order_id === order.id && intent.amount === order.total_cents && intent.currency === order.currency && intent.capture_method === 'manual';
  }
  let intent = intentId ? await stripe.paymentIntents.retrieve(intentId) : null;
  if (!free && !validIntent(intent)) throw new Error('Payment identity mismatch');
  const args = { p_order_id: order.id, p_session_id: session.id, p_intent: intentId };
  async function finish(outcome) {
    const result = await sb.rpc('finish_authorized_checkout', { ...args, p_outcome: outcome });
    if (result.error || result.data?.state !== outcome) throw new Error('Capture confirmation unavailable');
  }
  if (!free && ['canceled','requires_payment_method'].includes(intent.status)) {
    const { data: existing, error } = await sb.from('order_payment_captures').select('state').eq('order_id', order.id).maybeSingle();
    if (error) throw error;
    if (intent.status === 'requires_payment_method') {
      if (!existing) return json(200, { received: true });
      try { await stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: 'hn-cancel-auth-' + order.id }); } catch { /* Reconcile below. */ }
      intent = await stripe.paymentIntents.retrieve(intentId);
      if (!validIntent(intent) || intent.status !== 'canceled') throw new Error('Authorization cancellation unconfirmed');
    }
    if (existing) await finish('cancelled');
    else { const result = await sb.rpc('release_order', { p_order_id: order.id, p_status: 'payment_failed' }); if (result.error) throw result.error; }
    return json(200, { received: true });
  }
  if (!free && !['requires_capture', 'succeeded'].includes(intent.status)) throw new Error('Payment still processing');
  if (!free && intent.status === 'requires_capture' && intent.amount_capturable !== order.total_cents) throw new Error('Authorization amount mismatch');
  if (session.status !== 'complete') throw new Error('Checkout still processing');
  const { data: claim, error: claimError } = await sb.rpc('claim_authorized_checkout', { ...args, p_amount: order.total_cents, p_currency: order.currency });
  if (claimError || !claim || !['capturing','cancelling','captured','cancelled'].includes(claim.state) || claim.order_id !== order.id || claim.session_id !== session.id || claim.payment_intent_id !== intentId || claim.amount_cents !== order.total_cents || claim.currency !== order.currency) throw new Error('Capture claim unavailable');
  if (claim.state === 'cancelled') return json(200, { received: true });
  if (!free && claim.state === 'cancelling' && intent.status === 'requires_capture') {
    try { await stripe.paymentIntents.cancel(intentId, {}, { idempotencyKey: 'hn-cancel-auth-' + order.id }); }
    catch { /* Read the same intent to distinguish a lost reply from uncertainty. */ }
    intent = await stripe.paymentIntents.retrieve(intentId);
    if (!validIntent(intent) || intent.status !== 'canceled') throw new Error('Authorization cancellation unconfirmed');
    await finish('cancelled');
    return json(200, { received: true });
  }
  if (free && claim.state === 'cancelling') {
    await finish('cancelled'); return json(200, { received: true });
  }
  if (!free && claim.state === 'capturing' && intent.status === 'requires_capture') {
    if (intent.amount_capturable !== order.total_cents) throw new Error('Authorization amount mismatch');
    try { await stripe.paymentIntents.capture(intentId, { amount_to_capture: order.total_cents, final_capture: true }, { idempotencyKey: 'hn-capture-' + order.id }); }
    catch { /* A capture never gets a new intent or new operation on retry. */ }
    intent = await stripe.paymentIntents.retrieve(intentId);
  }
  if (!free && (!validIntent(intent) || intent.status !== 'succeeded' || intent.amount_received !== order.total_cents)) throw new Error('Capture outcome unconfirmed');
  // An out-of-band Dashboard capture is recorded, not charged again. The existing
  // finalizer raises stock_issue if it cannot allocate; never invent stock/refund.
  await finish('captured');
  return notifyPaid({ ...session, payment_status: free ? 'no_payment_required' : 'paid', payment_intent: intentId }, sb);
}

async function recoverAuthorizedCheckouts(sb, notifyPaid, provider) {
  const { data, error } = await sb.rpc('recoverable_authorized_checkouts');
  if (error) throw error;
  // A missing/failed first webhook can leave no journal yet. Look up bound
  // unpaid sessions as well, without touching stock while Checkout stays open.
  const candidates = await sb.from('orders').select('id,stripe_session_id').eq('payment_flow', 'authorize_capture').eq('status', 'pending')
    .not('stripe_session_id', 'is', null).lt('created_at', new Date(Date.now() - 5 * 60000).toISOString()).order('created_at', { ascending: true }).limit(10);
  if (candidates.error) throw candidates.error;
  const seen = new Set(), rows = (data || []).concat((candidates.data || []).map(row => ({ order_id: row.id, session_id: row.stripe_session_id })));
  const started = Date.now();
  for (const row of rows) {
    if (Date.now() - started > 25000) break;
    if (seen.has(row.order_id)) continue;
    seen.add(row.order_id);
    try { await settleCheckout(sb, { id: row.session_id, client_reference_id: row.order_id }, notifyPaid, provider); }
    catch { console.error('Authorized checkout recovery remains unconfirmed'); }
  }
}

module.exports = { settleCheckout, recoverAuthorizedCheckouts };
