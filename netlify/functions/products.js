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

    if (q.ids) {
      const ids = String(q.ids).split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length) query = query.in('id', ids);
    }

    const { data, error } = await query;
    if (error) throw error;

    const products = (data || []).map((p) => ({ ...p, variants: p.product_variants || [] }));

    return json(200, { products });
  } catch (err) {
    console.error('products.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};