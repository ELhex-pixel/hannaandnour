/**
 * GET /api/products
 * Returns the active product catalog from Supabase.
 * Optional query params: category, featured, bestseller, ids (comma separated).
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

    let query = sb
      .from('products')
      .select('*, product_variants(id, color, size, stock, active)')
      .eq('active', true)
      .order('created_at', { ascending: true });

    if (q.category) query = query.eq('category', q.category);
    if (q.featured === 'true') query = query.eq('is_featured', true);
    if (q.bestseller === 'true') query = query.eq('is_bestseller', true);

    // ?slug= returns the matching active product(s) instead of the whole
    // catalog (documented in AGENTS.md; the product page fetch can use it).
    if (q.slug) {
      if (String(q.slug).includes(',')) {
        const slugs = String(q.slug).split(',').map((s) => s.trim()).filter(Boolean);
        if (slugs.length) query = query.in('slug', slugs);
      } else {
        query = query.eq('slug', String(q.slug).trim());
      }
    }

    if (q.ids) {
      const ids = String(q.ids).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) query = query.in('id', ids);
    }

    const { data, error } = await query;
    if (error) throw error;

    const products = (data || []).map((p) => ({ ...p, variants: p.product_variants || [] }));

    // Attach the REAL approved review stats per product so product cards can
    // render counts/stars in sync with the admin (seed values kept only until
    // the first real review is approved).
    const ids = products.map((p) => p.id).filter(Boolean);
    let approvedMap = {};
    if (ids.length) {
      const rv = await sb
        .from('reviews')
        .select('product_id, rating')
        .eq('status', 'approved')
        .in('product_id', ids);
      if (rv.error) throw rv.error;
      (rv.data || []).forEach((r) => {
        const m = approvedMap[r.product_id] || (approvedMap[r.product_id] = { count: 0, sum: 0 });
        m.count += 1;
        m.sum += r.rating;
      });
    }

    const out = products.map((p) => {
      const m = approvedMap[p.id];
      return {
        ...p,
        approved_count: m ? m.count : 0,
        approved_rating: m ? Math.round((m.sum / m.count) * 10) / 10 : 0
      };
    });

    return json(200, { products: out });
  } catch (err) {
    console.error('products.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};