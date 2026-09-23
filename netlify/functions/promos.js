/**
 * GET /api/promos
 * Public list of active promo codes (client-side preview + announce).
 * Only active, non-expired codes with code + percent_off are exposed.
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
    const sb = getSupabase();
    const { data, error } = await sb
      .from('promo_codes')
      .select('code, percent_off, expires_at')
      .eq('active', true);
    if (error) throw error;
    const now = Date.now();
    const promos = (data || [])
      .filter((p) => !p.expires_at || new Date(p.expires_at).getTime() > now)
      .map((p) => ({ code: p.code, percent_off: p.percent_off, expires_at: p.expires_at }));
    return json(200, { promos });
  } catch (err) {
    console.error('promos.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};