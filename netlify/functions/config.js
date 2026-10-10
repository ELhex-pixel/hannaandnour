/**
 * GET /api/config
 * Public shipping/checkout configuration shared by the client pages so the
 * displayed totals always match what the server charges.
 *
 * Values come from the `settings` table (admin-editable) and fall back to
 * Netlify env vars / defaults when unset.
 */
const { json, getSupabase, isConfigured, loadColorSwatches, defaultCatalog } = require('./shared');
const { settings: commerceSettings } = require('./lib/commerce');
const { publicRead, queryResult } = require('./lib/public-read');
const { generalStory } = require('./lib/brand-copy');

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
    const sb = getSupabase();
    const options = { log: entry => console.warn(JSON.stringify(entry)) };
    const [configuration, color_swatches, demo] = await Promise.all([
      publicRead('configuration', async signal => {
        const query = sb.from('settings').select('key, value').in('key', ['shipping', 'currency', 'return_policy', 'catalog', 'reviews', 'home', 'story']);
        return queryResult(await query.abortSignal(signal));
      }, options),
      publicRead('color_swatches', signal => loadColorSwatches(sb, signal), options),
      publicRead('demo_reviews', async signal => {
        const query = sb.from('demo_reviews').select('rating').eq('active', true);
        return queryResult(await query.abortSignal(signal));
      }, options).catch(() => ({ error: true }))
    ]);
    if (configuration.error) throw configuration.error;
    const rows = configuration.data || [];
    const value = key => rows.find(row => row.key === key)?.value;
    const cat = value('catalog');
    const catalog = cat && Array.isArray(cat.colors) ? { colors: cat.colors } : defaultCatalog();
    let reviews = { show_demo: false, demo: { count: 0, sum: 0 } };
    const rv = value('reviews');
    if (rv && typeof rv === 'object') {
      reviews = Object.assign({ show_demo: false, demo: { count: 0, sum: 0 } }, rv);
      if (!reviews.demo || typeof reviews.demo !== 'object') reviews.demo = { count: 0, sum: 0 };
    }
    if (!demo.error) {
      const list = demo.data || [];
      reviews.demo = { count: list.length, sum: list.reduce((sum, row) => sum + (parseInt(row.rating, 10) || 0), 0) };
    }
    const authoritative = await commerceSettings(sb, rows);
    return json(200, { settings: { ...authoritative.shipping, returns_days: authoritative.return_policy.days }, return_policy: authoritative.return_policy, catalog, currency: authoritative.currency, reviews, home: value('home') ?? null, story: generalStory(value('story') ?? null), color_swatches });
  } catch (err) {
    const response = json(err.transient ? 503 : 500, { error: 'Configuration temporarily unavailable' });
    if (err.transient) response.headers['Retry-After'] = '1';
    return response;
  }
};
