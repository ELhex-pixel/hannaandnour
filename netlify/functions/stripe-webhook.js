/**
 * POST /api/stripe-webhook
 * Handles Stripe events (checkout.session.completed, etc.).
 * Configure the webhook endpoint in the Stripe Dashboard pointing to
 *   https://YOUR-SITE/api/stripe-webhook
 * with event "checkout.session.completed" selected, and set the
 * STRIPE_WEBHOOK_SECRET env var to the signing secret.
 */
const Stripe = require('stripe');
const { json, getSupabase, isConfigured, sendEmail, siteUrl } = require('./shared');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function moneyStr(cents, currency) {
  const symbol = (currency || 'usd').toLowerCase() === 'eur' ? '\u20AC' : '$';
  return symbol + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildAdminAlertHtml(order, items) {
  const rows = (items || []).map(function (it) {
    return (
      '<tr>' +
      '<td style="padding:10px 8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#221f1a;">' + esc(it.product_name) + ' <span style="color:#8a7d66;">&times; ' + esc(it.quantity) + '</span></td>' +
      '<td style="padding:10px 8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#221f1a;text-align:right;white-space:nowrap;">' + moneyStr(it.unit_price_cents * it.quantity, order.currency) + '</td>' +
      '</tr>'
    );
  }).join('');
  const addr = order.delivery_type === 'pickup'
    ? (order.pickup_point ? 'Retrait &ndash; ' + esc(order.pickup_point) : 'Retrait en point relais')
    : [order.address1, order.address2, [order.city, order.state].filter(Boolean).join(' '), [order.postal_code, order.country].filter(Boolean).join(' '), order.phone].filter(Boolean).map(esc).join('<br>');
  return (
    '<div style="background:#f6f1e8;padding:24px;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">' +
    '<div style="background:#8a2c2c;padding:20px 28px;">' +
    '<h1 style="margin:0;color:#ffffff;font-family:Georgia,serif;font-size:22px;">Hanna &amp; Nour</h1>' +
    '<p style="margin:4px 0 0;color:#f3f0e8;font-size:13px;">Alerte vente</p>' +
    '</div>' +
    '<div style="padding:28px;">' +
    '<h2 style="margin:0 0 6px;color:#8a2c2c;font-size:18px;">Nouvelle commande pay&eacute;e</h2>' +
    '<p style="margin:0 0 6px;color:#221f1a;font-size:14px;line-height:1.5;">' + esc(order.customer_name) + ' (' + esc(order.email) + (order.phone ? ' &middot; ' + esc(order.phone) : '') + ')</p>' +
    '<p style="margin:0 0 14px;font-size:13px;color:#8a7d66;">Num&eacute;ro : <strong style="color:#221f1a;">' + esc(order.order_number) + '</strong></p>' +
    '<table style="width:100%;border-collapse:collapse;border-top:1px solid #efe7d8;">' + rows + '</table>' +
    '<p style="margin:12px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#221f1a;">Total pay&eacute; : <strong>' + moneyStr(order.total_cents, order.currency) + '</strong></p>' +
    '<p style="margin:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#221f1a;">Livraison : ' + (order.delivery_type === 'pickup' ? 'point relais' : esc(order.shipping_method || 'standard')) + '</p>' +
    (order.delivery_type !== 'pickup' ? '<p style="margin:6px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#221f1a;">' + addr + '</p>' : '') +
    '<table style="margin:18px 0;" role="presentation" width="100%"><tr><td align="center">' +
    '<a href="' + siteUrl + '/admin.html" style="background:#221f1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Voir dans l&rsquo;admin</a>' +
    '</td></tr></table>' +
    '</div></div></div>'
  );
}

function buildOrderEmail(order, items) {
  const rows = (items || []).map(function (it) {
    const src = it.image && it.image.indexOf('http') === 0 ? it.image : it.image ? siteUrl + '/' + it.image : '';
    return (
      '<tr>' +
      '<td style="padding:12px 8px;">' + (src ? '<img src="' + esc(src) + '" alt="" width="52" height="70" style="border-radius:6px;object-fit:cover;">' : '') + '</td>' +
      '<td style="padding:12px 8px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#221f1a;">' + esc(it.product_name) +
      ' <span style="color:#8a7d66;">&times; ' + esc(it.quantity) + '</span></td>' +
      '<td style="padding:12px 8px;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#221f1a;text-align:right;white-space:nowrap;">' + moneyStr(it.unit_price_cents * it.quantity, order.currency) + '</td>' +
      '</tr>'
    );
  }).join('');

  const address = order.delivery_type === 'pickup'
    ? [order.pickup_point ? 'Retrait &ndash; ' + order.pickup_point : 'Retrait en point relais', order.phone].filter(Boolean).map(esc).join('<br>')
    : [order.address1, order.address2, [order.city, order.state].filter(Boolean).join(' '), [order.postal_code, order.country].filter(Boolean).join(' '), order.phone].filter(Boolean).map(esc).join('<br>');

  const shipLabel = order.shipping_method === 'pickup'
    ? 'point relais'
    : order.shipping_method === 'express'
      ? 'express'
      : order.shipping_method === 'next_day'
        ? 'J+1'
        : order.shipping_method || 'standard';

  return (
    '<div style="background:#f6f1e8;padding:24px;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">' +
    '<div style="background:#7d9b76;padding:20px 28px;">' +
    '<h1 style="margin:0;color:#ffffff;font-family:Georgia,serif;font-size:22px;">Hanna &amp; Nour</h1>' +
    '<p style="margin:4px 0 0;color:#f3f0e8;font-size:13px;">Modest Fashion for the Modern Woman</p>' +
    '</div>' +
    '<div style="padding:28px;">' +
    '<h2 style="margin:0 0 6px;color:#8a2c2c;font-size:18px;">Commande confirm&eacute;e</h2>' +
    '<p style="margin:0 0 20px;color:#221f1a;font-size:14px;line-height:1.5;">Merci ' + esc(order.customer_name) + ' ! Votre paiement a bien &eacute;t&eacute; accept&eacute;.</p>' +
    '<p style="margin:0 0 20px;font-size:13px;color:#8a7d66;">Num&eacute;ro de commande : <strong style="color:#221f1a;">' + esc(order.order_number) + '</strong></p>' +
    '<table style="width:100%;border-collapse:collapse;border-top:1px solid #efe7d8;">' + rows + '</table>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;font-family:Helvetica,Arial,sans-serif;color:#221f1a;">' +
    '<tr><td style="padding:6px 8px;">Sous-total</td><td style="padding:6px 8px;text-align:right;">' + moneyStr(order.subtotal_cents, order.currency) + '</td></tr>' +
    (order.discount_cents > 0 ? '<tr><td style="padding:6px 8px;">Remise' + (order.promo_code ? ' (' + esc(order.promo_code) + ')' : '') + '</td><td style="padding:6px 8px;text-align:right;color:#3d7a46;">-\u2212' + moneyStr(order.discount_cents, order.currency) + '</td></tr>' : '') +
    '<tr><td style="padding:6px 8px;">Livraison (' + shipLabel + ')</td><td style="padding:6px 8px;text-align:right;">' + moneyStr(order.shipping_cents, order.currency) + '</td></tr>' +
    (order.tax_cents > 0 ? '<tr><td style="padding:6px 8px;">Taxe</td><td style="padding:6px 8px;text-align:right;">' + moneyStr(order.tax_cents, order.currency) + '</td></tr>' : '') +
    '<tr><td style="padding:8px;font-weight:bold;">Total</td><td style="padding:8px;text-align:right;font-weight:bold;">' + moneyStr(order.total_cents, order.currency) + '</td></tr>' +
    '</table>' +
    '<div style="margin-top:22px;padding-top:16px;border-top:1px solid #efe7d8;">' +
    '<p style="margin:0 0 4px;font-size:12px;color:#8a7d66;text-transform:uppercase;letter-spacing:.5px;">Adresse de livraison</p>' +
    '<p style="margin:0;font-size:14px;color:#221f1a;line-height:1.5;">' + address + '</p>' +
    '</div>' +
    '<p style="margin:24px 0 0;font-size:12px;color:#8a7d66;">Une question ? R&eacute;pondez simplement &agrave; cet email.</p>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
      return json(503, { error: 'Webhook is not configured' });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
    const signature = (event.headers || {})['stripe-signature'];

    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return json(400, { error: 'Invalid signature' });
    }

    const sb = getSupabase();
    const session = stripeEvent.data.object;
    if (stripeEvent.type === 'charge.refunded') {
      const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent && session.payment_intent.id;
      if (!intentId) return json(200, { received: true });
      const { data, error } = await sb.from('orders').select('id').eq('payment_intent_id', intentId);
      if (error) throw error;
      const orders = data || [];
      if (!orders || !orders.length) {
        const intent = await stripe.paymentIntents.retrieve(intentId);
        if (intent.metadata && intent.metadata.order_id) orders.push({ id: intent.metadata.order_id });
      }
      for (const order of orders || []) {
        const { error: refundError } = await sb.rpc('reconcile_order_refund', { p_order_id: order.id, p_intent: intentId, p_amount: session.amount, p_currency: session.currency, p_refunded: session.amount_refunded });
        if (refundError) throw refundError;
      }
      return json(200, { received: true });
    }

    // Accept non-instant payments (e.g. card that goes through an async
    // verification): Stripe delivers these under a distinct event type.
    if (stripeEvent.type === 'checkout.session.async_payment_succeeded') {
      return await markPaid(session, sb);
    }

    if (stripeEvent.type === 'checkout.session.async_payment_failed') {
      const orderId = session.client_reference_id;
      if (orderId) {
        const { error } = await sb.rpc('release_order', { p_order_id: orderId, p_status: 'payment_failed' });
        if (error) {
          // Returning 500 lets Stripe retry delivery; a 200 here would swallow
          // the failure and leave the order stuck as `pending`.
          console.error('Marking order payment_failed failed:', error.message, 'order', orderId);
          return json(500, { error: 'Failed to mark order as payment_failed' });
        }
      }
      return json(200, { received: true });
    }

    if (stripeEvent.type === 'checkout.session.completed') {
      return await markPaid(session, sb);
    }

    if (stripeEvent.type === 'checkout.session.expired') {
      const orderId = session.client_reference_id;
      // Never overwrite an already-paid order (Stripe may deliver `expired`
      // after `completed` in races).
      if (orderId) {
        const { error } = await sb.rpc('release_order', { p_order_id: orderId, p_status: 'abandoned' });
        if (error) {
          console.error('Marking order abandoned failed:', error.message, 'order', orderId);
          return json(500, { error: 'Failed to mark order as abandoned' });
        }
      }
    }

    return json(200, { received: true });
  } catch (err) {
    console.error('stripe-webhook processing failed');
    return json(500, { error: 'Webhook processing failed' });
  }
};

/**
 * Marks an order paid exactly once and runs the paid-order side effects.
 * Idempotent: a repeated event (Stripe retries, async succeeded arriving after
 * a previous succeeded/completed delivery) sees status already `paid` and does
 * nothing — no double stock decrement, no duplicate confirmation email.
 */
async function markPaid(session, sb) {
  const orderId = session.client_reference_id;
  if (!orderId) return json(200, { received: true });
  if (!['paid', 'no_payment_required'].includes(session.payment_status)) return json(200, { received: true });
  const customerEmail = (session.customer_details && session.customer_details.email) || null;
  const { data: result, error } = await sb.rpc('finalize_order_payment', {
    p_order_id: orderId, p_session_id: session.id, p_amount: session.amount_total,
    p_currency: session.currency, p_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null
  });
  if (error) throw error;
  if (result && result.stock_issue) console.error('Paid order requires stock reconciliation', orderId);
  const { data: claimed, error: claimError } = await sb.from('orders').update({ confirmation_claimed_at: new Date().toISOString() }).eq('id', orderId).eq('status', 'paid').is('confirmation_claimed_at', null).select('id');
  if (claimError) throw claimError;
  if (claimed && claimed.length) {
    try {
      const { data: paidOrder, error: fetchErr } = await sb
        .from('orders')
        .select('*, order_items(*)')
        .eq('id', orderId)
        .single();
      if (fetchErr) throw fetchErr;

      // Record the purchase for in-house analytics.
      await sb.from('analytics_events').insert({
        event_type: 'purchase',
        product_slug: null,
        path: orderId,
        referrer: 'stripe-webhook'
      }).then(function () {}, function () {});

      const toEmail = paidOrder.email || customerEmail;
      if (toEmail) {
        const result = await sendEmail({
          to: toEmail,
          subject: 'Commande ' + (paidOrder.order_number || orderId) + ' confirm\u00E9e \u2014 Hanna & Nour',
          html: buildOrderEmail(paidOrder, paidOrder.order_items || [])
        });
      }
      const adminTo = process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL || 'yassinaous92@gmail.com';
      if (adminTo && adminTo !== toEmail) {
        const alertResult = await sendEmail({
          to: adminTo,
          subject: 'Nouvelle commande ' + (paidOrder.order_number || orderId) + ' \u2014 Hanna & Nour',
          html: buildAdminAlertHtml(paidOrder, paidOrder.order_items || [])
        });
      }
    } catch (mailErr) {
      console.error('Order confirmation email failed:', mailErr.message);
    }
  }

  return json(200, { received: true });
}

exports.markPaid = markPaid;
