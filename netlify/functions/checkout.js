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
const { json, getSupabase, isConfigured, readBody, getSetting, intEnv, floatEnv, requireUser } = require('./shared');

const STRIPE = () => new Stripe(process.env.STRIPE_SECRET_KEY || '');

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

    // ---- Auth: link the order to the account when a valid session is sent ----
    let orderUserId = null;
    if (body.auth_token) {
      const auth = await requireUser(sb, String(body.auth_token));
      if (!auth.ok) return json(401, { error: auth.error });
      orderUserId = auth.user.id;
    }

    // ---- Currency (admin-editable `settings` key, then env, then usd) ----
    let currencyCode = String(process.env.STRIPE_PRICE_CURRENCY || 'usd').toLowerCase();
    const curSetting = await getSetting(sb, 'currency', null);
    if (curSetting && (curSetting.code === 'usd' || curSetting.code === 'eur')) {
      currencyCode = curSetting.code;
    }

    // ---- Validate payload ----
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 50) {
      return json(400, { error: 'Invalid cart' });
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'Invalid email address' });
    }

    const customerName = String(body.customer_name || '').trim();

    const shippingMethod = ['standard', 'express', 'next_day', 'pickup'].includes(body.shipping_method)
      ? body.shipping_method
      : 'standard';
    const deliveryType = shippingMethod === 'pickup' ? 'pickup' : 'home';

    if (deliveryType === 'home') {
      if (!customerName || !body.address1 || !body.city || !body.postal_code || !body.country) {
        return json(400, { error: 'Missing shipping details' });
      }
    } else {
      if (!customerName || !String(body.pickup_point || '').trim()) {
        return json(400, { error: 'Merci de choisir un point de retrait' });
      }
    }
    if (!customerName || !email) {
      return json(400, { error: 'Missing customer details' });
    }

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
    const productIds = (dbProducts || []).map((p) => p.id);

    // ---- Load variants (color x size stock) for the cart products ----
    const variantByKey = {};
    const productsWithVariants = new Set();
    if (productIds.length) {
      const { data: variants, error: variantsError } = await sb
        .from('product_variants')
        .select('id, product_id, color, size, stock, active')
        .in('product_id', productIds);
      if (variantsError) throw variantsError;
      (variants || []).forEach((v) => {
        productsWithVariants.add(v.product_id);
        const key = v.product_id + '|' + String(v.color || '').toLowerCase() + '|' + String(v.size || '').toLowerCase();
        variantByKey[key] = v;
      });
    }

    const lineItems = [];
    const resolvedItems = [];
    let subtotal = 0;

    for (const item of body.items) {
      const product = bySlug[item.slug];
      if (!product || !product.active) {
        return json(400, { error: 'Unknown product in cart' });
      }
      const qty = Math.min(10, Math.max(1, parseInt(item.qty, 10) || 1));

      const color = String(item.color || '').trim();
      const size = String(item.size || '').trim();
      const hasOptions = !!(color || size);
      let variantId = null;

      if (hasOptions) {
        const key = product.id + '|' + color.toLowerCase() + '|' + size.toLowerCase();
        const variant = variantByKey[key];
        if (variant) {
          if (!variant.active || variant.stock < qty) {
            return json(400, {
              error: 'stock', message: 'Stock insuffisant pour ' + product.name_en,
              item: { slug: product.slug, color, size, available: variant.stock }
            });
          }
          variantId = variant.id;
        } else if (productsWithVariants.has(product.id)) {
          return json(400, { error: 'Cette variante n\u2019est pas disponible' });
        }
        // No variant rows for this product => unlimited legacy product.
      }

      const parts = [];
      if (color) parts.push(color);
      if (size) parts.push(size);
      const variant = parts.join(' / ');

      lineItems.push({
        quantity: qty,
        price_data: {
          currency: currencyCode,
          unit_amount: product.price_cents,
          product_data: {
            name: product.name_en + (variant ? ` - ${variant}` : ''),
            images: [product.image && String(product.image).indexOf('http') === 0 ? product.image : siteUrl + '/' + product.image]
          }
        }
      });
      resolvedItems.push({ product, color, size, variant, variantId, qty });
      subtotal += product.price_cents * qty;
    }

    // ---- Shipping (settings table, then env fallbacks) ----
    const shipSettings = await getSetting(sb, 'shipping', null);
    const hasShip = shipSettings && typeof shipSettings === 'object';
    const shipRates = {
      standard: hasShip && typeof shipSettings.standard_cents === 'number'
        ? shipSettings.standard_cents : intEnv('SHIPPING_STANDARD_CENTS', 699),
      express: hasShip && typeof shipSettings.express_cents === 'number'
        ? shipSettings.express_cents : intEnv('SHIPPING_EXPRESS_CENTS', 1200),
      next_day: hasShip && typeof shipSettings.nextday_cents === 'number'
        ? shipSettings.nextday_cents : intEnv('SHIPPING_NEXTDAY_CENTS', 2500),
      pickup: hasShip && typeof shipSettings.pickup_cents === 'number'
        ? shipSettings.pickup_cents : 0
    };
    const freeThreshold = hasShip && typeof shipSettings.free_threshold_cents === 'number'
      ? shipSettings.free_threshold_cents : intEnv('FREE_SHIPPING_THRESHOLD_CENTS', 7500);
    const shippingCents = shippingMethod === 'standard' && subtotal >= freeThreshold
      ? 0
      : shipRates[shippingMethod] || 0;

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
    const taxRate = hasShip && typeof shipSettings.tax_rate === 'number'
      ? shipSettings.tax_rate : floatEnv('TAX_RATE', 0.07);
    const taxable = Math.max(0, subtotal - discountCents);
    const taxCents = taxRate > 0 ? Math.round(taxable * taxRate) : 0;
    if (taxCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: currencyCode,
          unit_amount: taxCents,
          product_data: { name: 'Tax (est.)' }
        }
      });
    }

    const totalCents = subtotal + shippingCents + taxCents - discountCents;

    // ---- Persist order draft ----
    const orderId = randomUUID();
    const orderNumber = 'HN-' + randomBytes(3).toString('hex').toUpperCase();
    const cartToken = randomBytes(24).toString('hex');

    const { error: orderError } = await sb.from('orders').insert({
      id: orderId,
      order_number: orderNumber,
      cart_restore_token: cartToken,
      email,
      customer_name: customerName,
      phone: String(body.phone || '').slice(0, 40),
      address1: String(body.address1 || ''),
      address2: String(body.address2 || '') || null,
      city: String(body.city || ''),
      state: String(body.state || ''),
      postal_code: String(body.postal_code || ''),
      country: deliveryType === 'home' ? String(body.country || '') : '—',
      shipping_method: shippingMethod,
      delivery_type: deliveryType,
      pickup_point: deliveryType === 'pickup' ? String(body.pickup_point || '').trim() : null,
      subtotal_cents: subtotal,
      shipping_cents: shippingCents,
      tax_cents: taxCents,
      discount_cents: discountCents,
      total_cents: totalCents,
      currency: currencyCode,
      status: 'pending',
      promo_code: promoCode,
      user_id: orderUserId
    });
    if (orderError) throw orderError;

    const orderItems = resolvedItems.map((r) => ({
      order_id: orderId,
      product_id: r.product.id,
      product_slug: r.product.slug,
      product_name: r.product.name_en + (r.variant ? ' - ' + r.variant : ''),
      image: r.product.image,
      unit_price_cents: r.product.price_cents,
      quantity: r.qty,
      variant_id: r.variantId || null,
      variant: r.variant || null
    }));

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
            fixed_amount: { amount: shippingCents, currency: currencyCode },
            display_name: shippingMethod === 'standard' ? 'Standard Shipping' : shippingMethod === 'express' ? 'Express Shipping' : shippingMethod === 'pickup' ? 'Pickup / Point Relais' : 'Next Day Delivery'
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