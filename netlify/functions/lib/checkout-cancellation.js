const { createHmac, timingSafeEqual } = require('crypto');
const Stripe = require('stripe');
const { json } = require('../shared');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function cancellationToken(id, restoreToken) {
  return createHmac('sha256', restoreToken).update('checkout-cancel-v1:' + id).digest('hex');
}
function denied(code, status = 409) { return json(status, { error: code }); }

// Expire the exact unpaid session before the existing atomic stock release.
// Never refund, mark paid, or release an asynchronous/completed/unknown payment.
async function cancelCheckout(sb, body, userId, createdSessionId) {
  if (!uuid.test(String(body.order_id || ''))) return denied('checkout_cancel_invalid', 400);
  if (!userId && !/^[a-f0-9]{64}$/.test(String(body.cancel_token || ''))) return denied('checkout_cancel_invalid', 400);
  try {
    async function read() {
      let query = sb.from('orders').select('id,user_id,status,paid_at,payment_intent_id,refunded_cents,sale_channel,total_cents,currency,inventory_reserved,stripe_session_id,cart_restore_token').eq('id', body.order_id);
      if (userId) query = query.eq('user_id', userId);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    }
    const order = await read();
    if (!order) return denied('checkout_cancel_invalid', 404);
    if (!userId) {
      if (!order.cart_restore_token) return denied('checkout_cancel_invalid', 404);
      const expected = cancellationToken(order.id, order.cart_restore_token);
      if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(body.cancel_token, 'hex'))) return denied('checkout_cancel_invalid', 404);
    }
    if (!['pending', 'abandoned', 'payment_failed'].includes(order.status) || order.paid_at || order.payment_intent_id || order.refunded_cents > 0 || order.sale_channel === 'physical') return denied('checkout_cancel_completed');
    if (order.status !== 'pending' && !order.inventory_reserved) return json(200, { cancelled: true });
    // A session not yet bound may still be getting created. Never assume absence.
    const sessionId = order.stripe_session_id || createdSessionId;
    if (!sessionId || !process.env.STRIPE_SECRET_KEY) return denied('checkout_cancel_unconfirmed', 503);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 5000, maxNetworkRetries: 0 });
    function matches(session) {
      return session && session.id === sessionId && session.client_reference_id === order.id && session.metadata?.order_id === order.id && session.mode === 'payment' && session.amount_total === order.total_cents && session.currency === order.currency;
    }
    let session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!matches(session)) return denied('checkout_cancel_unconfirmed', 503);
    if (session.status === 'open' && session.payment_status === 'unpaid') {
      try { await stripe.checkout.sessions.expire(session.id); }
      catch { /* The payment may have won the race, or the reply was lost. Read. */ }
      session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!matches(session)) return denied('checkout_cancel_unconfirmed', 503);
    }
    if (session.status === 'complete' || ['paid', 'no_payment_required'].includes(session.payment_status)) return denied('checkout_cancel_completed');
    if (session.status !== 'expired' || session.payment_status !== 'unpaid') return denied('checkout_cancel_unconfirmed', 503);
    const result = await sb.rpc('release_order', { p_order_id: order.id, p_status: 'abandoned' });
    if (result.error) throw result.error;
    const current = await read();
    if (current?.status === 'abandoned' && current.inventory_reserved === false && !current.paid_at && !current.payment_intent_id) return json(200, { cancelled: true });
    return denied('checkout_cancel_completed');
  } catch {
    return denied('checkout_cancel_unconfirmed', 503);
  }
}

module.exports = { cancellationToken, cancelCheckout };
