const { json, getSupabase, isConfigured, CORS_HEADERS } = require('./shared');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(503, { error: 'temporarily_unavailable' });
  try {
    const q = event.queryStringParameters || {};
    const sb = getSupabase();
    if (q.facets === 'true') {
      const { data, error } = await sb.rpc('catalog_facets');
      if (error) throw error;
      return json(200, data);
    }
    const page = Math.min(10000, Math.max(1, parseInt(q.page, 10) || 1));
    const limit = Math.min(48, Math.max(1, parseInt(q.limit, 10) || 48));
    const list = value => String(value || '').split(',').map(s => s.trim().slice(0, 80)).filter(Boolean).slice(0, 20);
    const cents = value => /^\d{1,9}$/.test(String(value)) ? Number(value) : null;
    let query = sb.rpc('search_products', {
      p_query: String(q.q || '').trim().slice(0, 120), p_categories: list(q.category), p_sizes: list(q.sizes), p_occasions: list(q.occasions), p_min: cents(q.min), p_max: cents(q.max)
    }).select('*, product_variants(id, color, size, stock, active)', { count: 'exact' });
    if (q.slug) query = query.in('slug', list(q.slug));
    if (q.ids) query = query.in('id', list(q.ids));
    if (q.featured === 'true') query = query.eq('is_featured', true);
    if (q.bestseller === 'true') query = query.eq('is_bestseller', true);
    const sorts = { 'price-asc': ['price_cents', true], 'price-desc': ['price_cents', false], rating: ['rating', false], newest: ['created_at', false] };
    if (sorts[q.sort]) query = query.order(sorts[q.sort][0], { ascending: sorts[q.sort][1] });
    else query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: true });
    query = query.order('id', { ascending: true }).range((page - 1) * limit, page * limit - 1);
    const { data, error, count } = await query;
    if (error) throw error;
    const products = data || [];
    const { data: stats, error: sErr } = await sb.rpc('product_review_stats', { p_ids: products.map(p => p.id) });
    if (sErr) throw sErr;
    const out = products.map(p => {
      const review = (stats || []).find(r => r.product_id === p.id);
      const { search_vector, ...fields } = p;
      return { ...fields, variants: p.product_variants || [], approved_count: review ? Number(review.approved_count) : 0, approved_rating: review ? Number(review.approved_rating) : 0 };
    });
    return json(200, { products: out, total: count || 0, page, limit, has_more: page * limit < count });
  } catch (error) { return json(500, { error: 'Catalog temporarily unavailable' }); }
};
