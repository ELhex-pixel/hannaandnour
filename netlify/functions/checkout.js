/**
 * POST /api/checkout
 * Creates a Stripe Checkout Session from the real cart.
 *
 * Body: {
 *   items: [{ slug, qty, color?, size? }],
 *   email, customer_name, phone, address1, address2, city, state, postal_code, country,
 *   shipping_method: "standard" | "express" | "next_day",
 *   promo?: "WELCOME15"
 * }
 *
 * Prices are always re-verified against the Supabase catalog server-side,
 * never trusted from the client.
 */
const { randomUUID, randomBytes } = require('crypto');
const Stripe = require('stripe');
const { json, getSupabase, isConfigured, readBody } = require('./shared');

const STRIPE = () => new Stripe(process.env.STRIPE_SECRET_KEY || '');

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return isNaN(v) ? fallback : v;
}

function floatEnv(name, fallback) {
  const v = parseFloat(process.env[name]);
  return isNaN(v) ? fallback : v;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }
    if (!process.env.STRIPE_SECRET_KEY) {
      return json(503, { error: 'Stripe is not configured' });
    }

    const siteUrl = (process.env.SITE_URL || 'http://localhost:8888').replace(/\/$/, '');
    const sb = getSupabase();
    const body = readBody(event);

    // ---- Validate payload ----
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
      return json(400, { error: 'Invalid cart' });
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'Invalid email address' });
    }

    const customerName = String(body.customer_name || '').trim();
    if (!customerName || !body.address1 || !body.city || !body.postal_code || !body.country) {
      return json(400, { error: 'Missing shipping details' });
    }

    const shippingMethod = ['standard', 'express', 'next_day'].includes(body.shipping_method)
      ? body.shipping_method
      : 'standard';

    // ---- Load products & verify prices ----
    const slugs = body.items.map((i) => String(i.slug || '').trim()).filter(Boolean);
    if (slugs.length === 0) return json(400, { error: 'Invalid cart items' });

    const { data: dbProducts, error: prodError } = await sb
      .from('products')
      .select('id, slug, name_en, price_cents, image, active')
      .in('slug', slugs);
    if (prodError) throw prodError;

    const bySlug = {};
    (dbProducts || []).forEach((p) => { bySlug[p.slug] = p; });

    const lineItems = [];
    let subtotal = 0;

    for (const item of body.items) {
      const product = bySlug[item.slug];
      if (!product || !product.active) {
        return json(400, { error: 'Unknown product in cart' });
      }
      const qty = Math.min(10, Math.max(1, parseInt(item.qty, 10) || 1));

      const parts = [];
      if (item.color) parts.push(String(item.color));
      if (item.size) parts.push(String(item.size));
      const variant = parts.join(' / ');

      lineItems.push({
        quantity: qty,
        price_data: {
          currency: process.env.STRIPE_PRICE_CURRENCY || 'usd',
          unit_amount: product.price_cents,
          product_data: {
            name: product.name_en + (variant ? ` - ${variant}` : ''),
            images: [siteUrl + '/' + product.image]
          }
        }
      });
      subtotal += product.price_cents * qty;
    }

    // ---- Shipping ----
    const freeThreshold = intEnv('FREE_SHIPPING_THRESHOLD_CENTS', 7500);
    const shipRates = {
      standard: intEnv('SHIPPING_STANDARD_CENTS', 699),
      express: intEnv('SHIPPING_EXPRESS_CENTS', 1200),
      next_day: intEnv('SHIPPING_NEXTDAY_CENTS', 2500)
    };
    const shippingCents = shippingMethod === 'standard' && subtotal >= freeThreshold
      ? 0
      : shipRates[shippingMethod];

    // ---- Promo code ----
    let discountCents = 0;
    let promoCode = null;
    const discounts = [];

    const promoRaw = String(body.promo || '').trim().toUpperCase();
    if (promoRaw) {
      const { data: promoRow, error: promoError } = await sb
        .from('promo_codes')
        .select('code, percent_off, active, expires_at')
        .eq('code', promoRaw)
        .single();
      if (promoError) throw promoError;

      const valid = promoRow &&
        promoRow.active &&
        (!promoRow.expires_at || new Date(promoRow.expires_at) > new Date());

      if (!valid) {
        return json(400, { error: 'Invalid promo code' });
      }

      promoCode = promoRow.code;
      discountCents = Math.round((subtotal * promoRow.percent_off) / 100);

      // Create (or reuse) a Stripe coupon for this code.
      const couponId = 'hn_coupon_' + promoRow.code.toLowerCase();
      try {
        await STRIPE().coupons.create({
          id: couponId,
          name: promoRow.code,
          percent_off: promoRow.percent_off,
          duration: 'once'
        });
      } catch (e) {
        // Coupon already exists - reuse it.
        await STRIPE().coupons.retrieve(couponId);
      }
      discounts.push({ coupon: couponId });
    }

    // ---- Tax ----
    const taxRate = floatEnv('TAX_RATE', 0);
    const taxable = Math.max(0, subtotal - discountCents);
    const taxCents = taxRate > 0 ? Math.round(taxable * taxRate) : 0;
    if (taxCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: process.env.STRIPE_PRICE_CURRENCY || 'usd',
          unit_amount: taxCents,
          product_data: { name: 'Tax (est.)' }
        }
      });
    }

    const totalCents = subtotal + shippingCents + taxCents - discountCents;

    // ---- Persist order draft ----
    const orderId = randomUUID();
    const orderNumber = 'HN-' + randomBytes(3).toString('hex').toUpperCase();

    const { error: orderError } = await sb.from('orders').insert({
      id: orderId,
      order_number: orderNumber,
      email,
      customer_name: customerName,
      phone: String(body.phone || '').slice(0, 40),
      address1: String(body.address1 || ''),
      address2: String(body.address2 || '') || null,
      city: String(body.city || ''),
      state: String(body.state || ''),
      postal_code: String(body.postal_code || ''),
      country: String(body.country || ''),
      shipping_method: shippingMethod,
      subtotal_cents: subtotal,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      discount_cents: discountCents,
      total_cents: totalCents,
      currency: process.env.STRIPE_PRICE_CURRENCY || 'usd',
      status: 'pending',
      promo_code: promoCode,
      user_id: body.user_id || null
    });
    if (orderError) throw orderError;

    const orderItems = lineItems
      .filter((l) => l.price_data.product_data.name !== 'Tax (est.)')
      .map((l, idx) => {
        const product = bySlug[body.items[idx] && body.items[idx].slug];
        return {
          order_id: orderId,
          product_id: product ? product.id : null,
          product_slug: product ? product.slug : 'unknown',
          product_name: l.price_data.product_data.name,
          image: product ? product.image : null,
          unit_price_cents: l.price_data.unit_amount,
          quantity: l.quantity
        };
      });

    const { error: itemsError } = await sb.from('order_items').insert(orderItems);
    if (itemsError) throw itemsError;

    // ---- Create Stripe Checkout Session ----
    const session = await STRIPE().checkout.sessions.create({
      mode: 'payment',
      client_reference_id: orderId,
      customer_email: email,
      line_items: lineItems,
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: shippingCents, currency: process.env.STRIPE_PRICE_CURRENCY || 'usd' },
            display_name: shippingMethod === 'standard' ? 'Standard Shipping' : shippingMethod === 'express' ? 'Express Shipping' : 'Next Day Delivery'
          }
        }
      ],
      discounts: discounts.length ? discounts : undefined,
      metadata: {
        order_id: orderId,
        shipping_method: shippingMethod,
        promo_code: promoCode || '',
        subtotal_cents: String(subtotal),
        shipping_cents: String(shippingCents),
        tax_cents: String(taxCents),
        discount_cents: String(discountCents)
      },
      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart.html`
    });

    await sb.from('orders').update({ stripe_session_id: session.id }).eq('id', orderId);

    return json(200, {
      url: session.url,
      orderId,
      total_cents: totalCents
    });
  } catch (err) {
    console.error('checkout.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};