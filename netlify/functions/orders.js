/**
 * GET /api/orders?session_id=...   -> single order (for the success/thank-you page)
 * GET /api/orders?cart_token=...   -> abandoned-cart items (restore link)
 *
 * NOTE: there is intentionally NO `?email=` lookup anymore. Orders belong to
 * the client's account (see /api/auth "orders") and exposing them by email on
 * an unauthenticated endpoint would leak PII (addresses, totals) to anyone.
 */
const { json, getSupabase, isConfigured, rateLimit, CORS_HEADERS } = require('./shared');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }

    const q = event.queryStringParameters || {};
    const sb = getSupabase();
    const limited = await rateLimit(sb, event, 'orders', 60, 600);
    if (limited) return limited;

    if (q.session_id) {
      const { data: orders, error } = await sb
        .from('orders')
        .select('order_number, status, total_cents, currency')
        .eq('stripe_session_id', q.session_id)
        .limit(1);
      if (error) throw error;
      return json(200, { order: orders && orders[0] ? orders[0] : null });
    }

    // Abandoned-cart recovery: `?cart_token=` restores the exact order items.
    // Only pending/abandoned orders can be restored (paid ones must not be
    // silently re-added to the cart, and `status` guards the token).
    if (q.cart_token) {
      if (!/^[a-f0-9]{48}$/.test(String(q.cart_token))) return json(404, { error: 'invalid_cart_token' });
      const { data: order, error } = await sb
        .from('orders')
        .select('id, order_number, order_items(product_slug, quantity, unit_price_cents, variant, variant_id)')
        .eq('cart_restore_token', String(q.cart_token))
        .in('status', ['pending', 'abandoned'])
        .gte('created_at', new Date(Date.now() - 72 * 3600000).toISOString())
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!order) return json(404, { error: 'invalid_cart_token' });
      const items = (order.order_items || []).map((it) => ({
        slug: it.product_slug,
        qty: it.quantity,
        price_cents: it.unit_price_cents,
        variant: it.variant || '',
        variant_id: it.variant_id || null
      }));
      return json(200, { items });
    }

    return json(400, { error: 'Missing session_id or cart_token' });
  } catch (err) {
    console.error('Order lookup failed');
    return json(500, { error: 'Orders temporarily unavailable' });
  }
};
