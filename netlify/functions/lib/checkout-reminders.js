const Stripe = require('stripe');
const { sendEmail, siteUrl } = require('../shared');
const { orderLocale, message } = require('./customer-email');

async function sendCheckoutReminders(sb, send = sendEmail, provider) {
  if (!process.env.RESEND_API_KEY) return 0;
  const now = Date.now();
  const { data, error } = await sb.from('orders')
    .select('id,order_number,email,customer_name,cart_restore_token,stripe_session_id,stripe_creation_started,checkout_lang,total_cents,currency')
    .in('status', ['pending','abandoned']).is('paid_at', null).is('payment_intent_id', null)
    .lte('created_at', new Date(now - 2 * 3600000).toISOString()).gte('created_at', new Date(now - 72 * 3600000).toISOString())
    .is('relance_sent_at', null).is('reminder_24h_sent_at', null).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  const stripe = provider || (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 5000, maxNetworkRetries: 0 }) : null);
  let sent = 0;
  for (const order of data || []) {
    if (Date.now() - now > 25000) break;
    if (!order.email || !order.cart_restore_token || (!order.stripe_session_id && order.stripe_creation_started)) continue;
    try {
      let session;
      if (order.stripe_session_id) {
        if (!stripe) continue;
        session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
        if (!session || session.id !== order.stripe_session_id || session.client_reference_id !== order.id || session.metadata?.order_id !== order.id || session.mode !== 'payment' || session.amount_total !== order.total_cents || session.currency !== order.currency || session.payment_status !== 'unpaid' || !['open','expired'].includes(session.status)) continue;
      }
      const claim = await sb.rpc('claim_checkout_reminder', { p_order_id: order.id });
      if (claim.error) throw claim.error;
      if (claim.data !== true) continue;
      const result = await send({ to: order.email, ...message('pending', await orderLocale(order, session), { order, siteUrl }) });
      if (result?.ok) sent++;
    } catch { console.error('Checkout reminder unconfirmed'); }
  }
  return sent;
}

module.exports = { sendCheckoutReminders };
