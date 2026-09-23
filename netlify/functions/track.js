/**
 * Hanna & Nour — POST /api/track
 * In-house analytics: fire-and-forget insertion of client events.
 * Body: { type: 'pageview'|'product_view'|'add_to_cart'|'checkout_attempt', product_slug?, path? }
 */
const { json, getSupabase, isConfigured, readBody, CORS_HEADERS } = require('./shared');

const TYPES = ['pageview', 'product_view', 'add_to_cart', 'checkout_attempt'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(503, { error: 'Supabase is not configured' });

  try {
    const body = readBody(event);
    const type = String(body.type || '').toLowerCase();
    if (TYPES.indexOf(type) === -1) return json(400, { error: 'Unknown event type' });

    const slug = body.product_slug ? String(body.product_slug).slice(0, 120) : null;
    const path = body.path ? String(body.path).slice(0, 255) : null;
    const referrer = (event.headers && event.headers['referer']) ? String(event.headers['referer']).slice(0, 500) : null;

    const sb = getSupabase();
    await sb.from('analytics_events').insert({ event_type: type, product_slug: slug, path, referrer });

    return json(202, { ok: true });
  } catch (err) {
    console.error('track.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};