/**
 * GET /api/orders?session_id=...   -> single order (for the success/thank-you page)
 * GET /api/orders?email=...        -> all orders for a customer (account page)
 */
const { json, getSupabase, isConfigured } = require('./shared');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
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

    if (q.session_id) {
      const { data: orders, error } = await sb
        .from('orders')
        .select('*, order_items(*)')
        .eq('stripe_session_id', q.session_id)
        .limit(1);
      if (error) throw error;
      return json(200, { order: orders && orders[0] ? orders[0] : null });
    }

    if (q.email) {
      const { data: orders, error } = await sb
        .from('orders')
        .select('*, order_items(*)')
        .eq('email', String(q.email).toLowerCase().trim())
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json(200, { orders });
    }

    // Abandoned-cart recovery: `?cart_token=` restores the exact order items.
    if (q.cart_token) {
      const { data: order, error } = await sb
        .from('orders')
        .select('id, order_number, order_items(product_slug, quantity, unit_price_cents, variant, variant_id)')
        .eq('cart_restore_token', String(q.cart_token))
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

    return json(400, { error: 'Missing session_id, email or cart_token' });
  } catch (err) {
    console.error('orders.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};