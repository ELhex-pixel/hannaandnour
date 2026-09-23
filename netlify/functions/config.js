/**
 * GET /api/config
 * Public shipping/checkout configuration shared by the client pages so the
 * displayed totals always match what the server charges.
 *
 * Values come from the `settings` table (admin-editable) and fall back to
 * Netlify env vars / defaults when unset.
 */
const { json, getSupabase, isConfigured, getSetting, defaultCatalog, intEnv, floatEnv } = require('./shared');

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
    const row = await getSetting(sb, 'shipping', null);

    const settings = {
      standard_cents: intEnv('SHIPPING_STANDARD_CENTS', 699),
      express_cents: intEnv('SHIPPING_EXPRESS_CENTS', 1200),
      nextday_cents: intEnv('SHIPPING_NEXTDAY_CENTS', 2500),
      pickup_cents: 0,
      free_threshold_cents: intEnv('FREE_SHIPPING_THRESHOLD_CENTS', 7500),
      tax_rate: floatEnv('TAX_RATE', 0.07),
      pickup_enabled: true
    };
    if (row) Object.assign(settings, row);

    let catalog = defaultCatalog();
    try {
      const cat = await getSetting(sb, 'catalog', null);
      if (cat && Array.isArray(cat.colors)) catalog = { colors: cat.colors };
    } catch (e) { /* keep default */ }

    let currency = { code: 'usd', symbol: '$' };
    try {
      const cur = await getSetting(sb, 'currency', null);
      const code = String(cur && cur.code || '').toLowerCase();
      if (code === 'usd' || code === 'eur') {
        currency = { code, symbol: code === 'eur' ? '\u20AC' : '$' };
      }
    } catch (e) { /* keep default */ }

    return json(200, { settings, catalog, currency });
  } catch (err) {
    console.error('config.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};