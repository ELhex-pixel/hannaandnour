/**
 * POST /api/stripe-webhook
 * Handles Stripe events (checkout.session.completed, etc.).
 * Configure the webhook endpoint in the Stripe Dashboard pointing to
 *   https://YOUR-SITE/api/stripe-webhook
 * with event "checkout.session.completed" selected, and set the
 * STRIPE_WEBHOOK_SECRET env var to the signing secret.
 */
const Stripe = require('stripe');
const { json, getSupabase, isConfigured } = require('./shared');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
      return json(503, { error: 'Webhook is not configured' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
    const signature = event.headers['stripe-signature'];

    const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return json(400, { error: 'Invalid signature' });
    }

    const sb = getSupabase();
    const session = stripeEvent.data.object;

    if (stripeEvent.type === 'checkout.session.completed') {
      const orderId = session.client_reference_id;
      if (!orderId) return json(200, { received: true });

      const paymentStatus =
        session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
          ? 'paid'
          : 'pending';

      const customerEmail = (session.customer_details && session.customer_details.email) || null;

      const update = {
        status: paymentStatus,
        paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
        stripe_session_id: session.id
      };
      if (customerEmail) update.email = customerEmail.toLowerCase();

      const { error } = await sb.from('orders').update(update).eq('id', orderId);
      if (error) throw error;
    }

    if (stripeEvent.type === 'checkout.session.expired') {
      const orderId = session.client_reference_id;
      if (orderId) {
        await sb.from('orders').update({ status: 'abandoned' }).eq('id', orderId);
      }
    }

    return json(200, { received: true });
  } catch (err) {
    console.error('stripe-webhook.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};