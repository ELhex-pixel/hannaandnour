/**
 * Reviews
 * GET  /api/reviews?product=<slug>   -> approved reviews + product aggregate
 * POST /api/reviews                   -> submit a review (stored as pending)
 *   Body: { product: "<slug>", rating (1-5), body }
 *
 * POST is restricted to logged-in customers (Bearer token) whose paid order
 * for that product has been delivered (shipping_status = 'delivered').
 * Every review lands in `pending` and is published only after admin approval.
 */
const { json, getSupabase, isConfigured, readBody, getBearer, requireUser } = require('./shared');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }

    const sb = getSupabase();

    if (event.httpMethod === 'GET') {
      const slug = (event.queryStringParameters || {}).product;
      if (!slug) return json(400, { error: 'Missing product slug' });

      const { data: product, error: prodError } = await sb
        .from('products')
        .select('id, slug, rating, review_count')
        .eq('slug', slug)
        .eq('active', true)
        .single();
      if (prodError) return json(404, { error: 'Product not found' });

      const { data: reviews, error: revError } = await sb
        .from('reviews')
        .select('id, author_name, rating, body, created_at')
        .eq('product_id', product.id)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(20);
      if (revError) throw revError;

      return json(200, {
        product: { slug: product.slug, rating: product.rating, review_count: product.review_count },
        reviews
      });
    }

    if (event.httpMethod === 'POST') {
      const body = readBody(event);
      const slug = String(body.product || '').trim();
      const rating = parseInt(body.rating, 10);
      const text = String(body.body || '').trim();

      if (!slug || !text) return json(400, { error: 'Missing fields' });
      if (!(rating >= 1 && rating <= 5)) return json(400, { error: 'Rating must be between 1 and 5' });

      // Only a logged-in customer can review.
      const auth = await requireUser(sb, getBearer(event));
      if (!auth.ok) return json(401, { error: 'auth_required' });
      const user = auth.user;

      const { data: product, error: prodError } = await sb
        .from('products')
        .select('id, slug, rating, review_count')
        .eq('slug', slug)
        .eq('active', true)
        .single();
      if (prodError) return json(404, { error: 'Product not found' });

      // Eligibility: the customer must own a paid AND delivered order that
      // contains this product.
      const { data: orders, error: ordersError } = await sb
        .from('orders')
        .select('status, shipping_status, order_items(*)')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .eq('shipping_status', 'delivered')
        .limit(100);
      if (ordersError) throw ordersError;
      const eligible = (orders || []).some((o) =>
        Array.isArray(o.order_items) &&
        o.order_items.some((it) => it.product_slug === slug)
      );
      if (!eligible) return json(403, { error: 'not_eligible' });

      // Author comes from the account, never from the form.
      const meta = user.user_metadata || {};
      const author = String(meta.first_name || '').trim() || String(user.email || 'Cli-ente').split('@')[0];

      const { error: insertError } = await sb
        .from('reviews')
        .insert({
          product_id: product.id,
          author_name: author.slice(0, 60),
          rating,
          body: text.slice(0, 1000),
          status: 'pending'
        });
      if (insertError) throw insertError;

      // Do NOT touch the aggregate here: only approved reviews count towards
      // rating / review_count (recomputed in admin.js when a review is
      // approved). Counting pending reviews would inflate ratings.
      return json(201, { ok: true, pending: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('reviews.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};