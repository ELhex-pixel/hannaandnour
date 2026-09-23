/**
 * POST /api/stripe-webhook
 * Handles Stripe events (checkout.session.completed, etc.).
 * Configure the webhook endpoint in the Stripe Dashboard pointing to
 *   https://YOUR-SITE/api/stripe-webhook
 * with event "checkout.session.completed" selected, and set the
 * STRIPE_WEBHOOK_SECRET env var to the signing secret.
 */
const Stripe = require('stripe');
const { json, getSupabase, isConfigured, sendEmail } = require('./shared');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function moneyStr(cents, currency) {
  const symbol = (currency || 'usd').toLowerCase() === 'eur' ? '\u20AC' : '$';
  return symbol + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildOrderEmail(order, items) {
  const siteUrl = (process.env.SITE_URL || 'https://hannanour.netlify.app').replace(/\/$/, '');
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

      // Send order confirmation email (best-effort — never fails the webhook).
      if (paymentStatus === 'paid') {
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

          // Decrement per-variant stock (atomic, guarded by stock >= qty).
          const items = paidOrder.order_items || [];
          for (const it of items) {
            if (it.variant_id) {
              const { data: decremented, error: decErr } = await sb
                .rpc('decrement_stock', { p_variant_id: it.variant_id, p_qty: it.quantity });
              if (decErr) {
                console.error('Stock decrement failed:', decErr.message, 'variant', it.variant_id);
              } else if (decremented === false) {
                console.error('Stock decrement rejected (insufficient stock) for variant', it.variant_id);
              }
            }
          }

          const toEmail = paidOrder.email || customerEmail;
          if (toEmail) {
            const result = await sendEmail({
              to: toEmail,
              subject: 'Commande ' + (paidOrder.order_number || orderId) + ' confirm\u00E9e \u2014 Hanna & Nour',
              html: buildOrderEmail(paidOrder, paidOrder.order_items || [])
            });
            if (result && result.skipped) {
              console.log('Order email skipped (RESEND_API_KEY not set) for ' + toEmail);
            }
          }
        } catch (mailErr) {
          console.error('Order confirmation email failed:', mailErr.message);
        }
      }
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