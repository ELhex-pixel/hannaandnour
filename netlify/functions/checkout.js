const { randomUUID, randomBytes } = require('crypto');
const Stripe = require('stripe');
const { json, getSupabase, isConfigured, readBody, requireUser, getBearer, rateLimit, siteUrl, CORS_HEADERS } = require('./shared');
const { quote, publicQuote, discountedLines } = require('./lib/commerce');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(503, { error: 'temporarily_unavailable' });
  const sb = getSupabase();
  const body = readBody(event);
  if (body.action && body.action !== 'quote') return json(400, { error: 'Unknown action' });
  let orderId = null;
  let session = null;
  let stripe;
  let stripeAttempted = false;
  try {
    const limited = await rateLimit(sb, event, body.action === 'quote' ? 'quote' : 'checkout', body.action === 'quote' ? 60 : 10, 600);
    if (limited) return limited;
    const value = await quote(sb, body);
    if (body.action === 'quote') return json(200, publicQuote(value));
    if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: 'Stripe is not configured' });
    if (body.expected_total_cents !== value.totals.total || body.expected_currency !== value.currency.code || body.expected_policy_version !== value.return_policy.version) {
      return json(409, { error: 'quote_changed', ...publicQuote(value) });
    }
    const fields = {};
    const limits = { email: 254, customer_name: 120, phone: 40, address1: 250, address2: 250, city: 120, state: 120, postal_code: 20, country: 2, pickup_point: 250 };
    for (const [name, limit] of Object.entries(limits)) {
      fields[name] = String(body[name] || '').trim();
      if (fields[name].length > limit) return json(400, { error: 'Invalid customer details' });
    }
    fields.email = fields.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) || !fields.customer_name) return json(400, { error: 'Invalid customer details' });
    if (value.method === 'pickup' ? !fields.pickup_point : !fields.address1 || !fields.city || !fields.postal_code || !/^[A-Za-z]{2}$/.test(fields.country)) return json(400, { error: 'Missing shipping details' });
    let userId = null;
    if (getBearer(event)) {
      const auth = await requireUser(sb, getBearer(event));
      if (!auth.ok) return json(401, { error: 'Not authenticated' });
      userId = auth.user.id;
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    orderId = randomUUID();
    const orderNumber = 'HN-' + randomBytes(8).toString('hex').toUpperCase();
    const t = value.totals;
    const allocation = discountedLines(value.items, t.discount);
    const { error: orderError } = await sb.from('orders').insert({
      ...fields, id: orderId, order_number: orderNumber, cart_restore_token: randomBytes(24).toString('hex'),
      shipping_method: value.method, delivery_type: value.method === 'pickup' ? 'pickup' : 'home',
      subtotal_cents: t.subtotal, shipping_cents: t.shipping, tax_cents: t.tax, discount_cents: t.discount,
      total_cents: t.total, currency: value.currency.code, status: 'pending', promo_code: value.promo ? value.promo.code : null, user_id: userId, return_policy: value.return_policy
    });
    if (orderError) throw orderError;
    const { error: itemsError } = await sb.from('order_items').insert(value.items.map(i => ({
      order_id: orderId, product_id: i.product.id, product_slug: i.slug, product_name: i.product.name_en,
      image: i.product.image, unit_price_cents: i.price_cents, net_total_cents: allocation.filter(line => line.item === i).reduce((sum, line) => sum + line.quantity * line.unit_amount, 0), quantity: i.qty, variant_id: i.variantId,
      variant: [i.color, i.size].filter(Boolean).join(' / ')
    })));
    if (itemsError) throw itemsError;
    const { data: reserved, error: reserveError } = await sb.rpc('reserve_order', { p_order_id: orderId });
    if (reserveError) throw reserveError;
    if (!reserved) {
      await sb.from('orders').delete().eq('id', orderId).eq('status', 'pending');
      orderId = null;
      return json(409, { error: 'Stock or promo unavailable' });
    }
    const lineItems = allocation.map(line => ({
      quantity: line.quantity,
      price_data: { currency: value.currency.code, unit_amount: line.unit_amount,
        product_data: { name: line.item.product.name_en + (line.item.color || line.item.size ? ' - ' + [line.item.color, line.item.size].filter(Boolean).join(' / ') : '') }
      }
    }));
    if (t.tax) lineItems.push({ quantity: 1, price_data: { currency: value.currency.code, unit_amount: t.tax, product_data: { name: 'Tax' } } });
    if (lineItems.reduce((n, i) => n + i.quantity * i.price_data.unit_amount, 0) + t.shipping !== t.total) throw new Error('Invalid allocation');
    const { error: attemptError } = await sb.from('orders').update({ stripe_creation_started: true }).eq('id', orderId);
    if (attemptError) throw attemptError;
    stripeAttempted = true;
    session = await stripe.checkout.sessions.create({
      mode: 'payment', client_reference_id: orderId, customer_email: fields.email, line_items: lineItems,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      shipping_options: [{ shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: t.shipping, currency: value.currency.code }, display_name: value.method } }],
      metadata: { order_id: orderId }, payment_intent_data: { metadata: { order_id: orderId } },
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${siteUrl}/cart.html`
    }, { idempotencyKey: 'checkout-' + orderId });
    const { error: bindError } = await sb.from('orders').update({ stripe_session_id: session.id }).eq('id', orderId);
    if (bindError) throw bindError;
    return json(200, { url: session.url, orderId, total_cents: t.total });
  } catch (err) {
    if (!stripeAttempted && /policy_changed/.test(err.message || '')) {
      orderId = null;
      try { return json(409, { error: 'quote_changed', ...publicQuote(await quote(sb, body)) }); }
      catch (error) { return json(503, { error: 'Checkout temporarily unavailable' }); }
    }
    if (orderId) {
      try {
        if (stripeAttempted && !session) {
          console.error('Checkout session requires reconciliation', orderId);
          return json(503, { error: 'Checkout temporarily unavailable' });
        }
        if (session) await stripe.checkout.sessions.expire(session.id);
        const { error } = await sb.rpc('release_order', { p_order_id: orderId, p_status: 'abandoned' });
        if (error) console.error('Checkout reservation release failed');
      } catch (releaseError) { console.error('Checkout recovery required', orderId); }
    }
    const invalid = /Invalid|unavailable|Pickup/.test(err.message || '') && !orderId;
    return json(invalid ? 400 : 500, { error: invalid ? err.message : 'Checkout temporarily unavailable' });
  }
};
