const { json, getSupabase, isConfigured, CORS_HEADERS } = require('./shared');
const selections = require('../../public/js/catalog-selection');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(503, { error: 'temporarily_unavailable' });
  try {
    const q = event.queryStringParameters || {};
    const sb = getSupabase();
    if (q.facets === 'true') {
      return json(200, await require('./lib/catalog-facets').catalogFacets(sb));
    }
    const page = Math.min(10000, Math.max(1, parseInt(q.page, 10) || 1));
    const limit = Math.min(48, Math.max(1, parseInt(q.limit, 10) || 48));
    const list = value => String(value || '').split(',').map(s => s.trim().slice(0, 80)).filter(Boolean).slice(0, 20);
    const cents = value => /^\d{1,9}$/.test(String(value)) ? Number(value) : null;
    function buildQuery() {
    let query = sb.rpc('search_products', {
      p_query: String(q.q || '').trim().slice(0, 120), p_categories: list(q.category), p_sizes: list(q.sizes), p_occasions: list(q.occasions), p_min: cents(q.min), p_max: cents(q.max)
    }, { count: 'exact' }).select('*, product_variants(id, color, size, stock, active)');
    if (q.slug) query = query.in('slug', list(q.slug));
    if (q.ids) query = query.in('id', list(q.ids));
    if (q.featured === 'true') query = query.eq('is_featured', true);
    if (q.bestseller === 'true') query = query.eq('is_bestseller', true);
    const sorts = { 'price-asc': ['price_cents', true], 'price-desc': ['price_cents', false], rating: ['rating', false], newest: ['created_at', false] };
    if (sorts[q.sort]) query = query.order(sorts[q.sort][0], { ascending: sorts[q.sort][1] });
    else query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: true });
    return query.order('id', { ascending: true });
    }
    if(q.collection!==undefined&&!['new','sale',''].includes(q.collection))return json(400,{error:'Invalid catalogue selection'});
    let data,error,count;
    if(q.collection){
      const selected=[];let sourceCount=null;
      const signal=AbortSignal.timeout(10000);
      for(let offset=0;offset<2000;offset+=500){
        const response=await buildQuery().range(offset,offset+499).abortSignal(signal);
        if(response.error||!Array.isArray(response.data)||!Number.isSafeInteger(response.count)||response.count<0||response.count>2000||(sourceCount!==null&&sourceCount!==response.count))throw new Error('Selection unavailable');
        sourceCount=response.count;
        selected.push(...response.data.filter(product=>selections.matches(product,q.collection)));
        if(offset+response.data.length>=sourceCount)break;
        if(response.data.length!==500||offset===1500)throw new Error('Incomplete selection');
      }
      count=selected.length;data=selected.slice((page-1)*limit,page*limit);
    }else({data,error,count}=await buildQuery().range((page-1)*limit,page*limit-1));
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Catalog count unavailable');
    const products = data || [];
    const { data: stats, error: sErr } = await sb.rpc('product_review_stats', { p_ids: products.map(p => p.id) });
    if (sErr) throw sErr;
    const out = products.map(p => {
      const review = (stats || []).find(r => r.product_id === p.id);
      const { search_vector, product_variants, ...fields } = p;
      return { ...fields, variants: product_variants || [], approved_count: review ? Number(review.approved_count) : 0, approved_rating: review ? Number(review.approved_rating) : 0 };
    });
    return json(200, { products: out, total: count, page, limit, has_more: page * limit < count });
  } catch (error) { return json(500, { error: 'Catalog temporarily unavailable' }); }
};
