/**
 * Reviews
 * GET  /api/reviews?product=<slug>   -> approved reviews + product aggregate
 * POST /api/reviews                   -> submit a review (stored as pending)
 *   Body: { product: "<slug>", author_name, rating (1-5), body }
 */
const { json, getSupabase, isConfigured, readBody } = require('./shared');

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
      const author = String(body.author_name || '').trim().slice(0, 60);
      const rating = parseInt(body.rating, 10);
      const text = String(body.body || '').trim();

      if (!slug || !author || !text) return json(400, { error: 'Missing fields' });
      if (!(rating >= 1 && rating <= 5)) return json(400, { error: 'Rating must be between 1 and 5' });

      const { data: product, error: prodError } = await sb
        .from('products')
        .select('id, slug, rating, review_count')
        .eq('slug', slug)
        .eq('active', true)
        .single();
      if (prodError) return json(404, { error: 'Product not found' });

      const { error: insertError } = await sb
        .from('reviews')
        .insert({
          product_id: product.id,
          author_name: author,
          rating,
          body: text.slice(0, 1000),
          status: 'pending'
        });
      if (insertError) throw insertError;

      // Do NOT touch the aggregate here: only approved reviews count towards
      // rating / review_count (recomputed in admin.js when a review is
      // approved). Counting pending reviews would inflate ratings.
      return json(201, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('reviews.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};