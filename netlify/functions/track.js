/**
 * Hanna & Nour — POST /api/track
 * In-house analytics: fire-and-forget insertion of client events.
 * Body: { type: 'pageview'|'product_view'|'add_to_cart'|'checkout_attempt', product_slug?, path? }
 */
const { json, getSupabase, isConfigured, readBody, CORS_HEADERS } = require('./shared');

const TYPES = ['pageview', 'product_view', 'add_to_cart', 'checkout_attempt'];

// Per-instance sliding-window rate limit. Netlify Functions are ephemeral, so
// this is a first line of defense against a single client filling the table —
// not a global quota. It needs no shared store (no Redis in this stack).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 90;
const ipEvents = new Map();
let pruneCounter = 0;

function rateLimited(event) {
  const forwarded = event.headers && event.headers['x-forwarded-for'];
  const ip = String(forwarded || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const hits = (ipEvents.get(ip) || []).filter(function (t) { return now - t < RATE_WINDOW_MS; });
  if (hits.length >= RATE_MAX) {
    ipEvents.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipEvents.set(ip, hits);
  // Lazy cleanup so the map does not grow forever.
  if (++pruneCounter % 256 === 0) {
    for (const [k, arr] of ipEvents) {
      if (arr.every(function (t) { return now - t >= RATE_WINDOW_MS; })) ipEvents.delete(k);
    }
  }
  return false;
}

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

    if (rateLimited(event)) return json(429, { error: 'Too many requests' });

    const sb = getSupabase();
    await sb.from('analytics_events').insert({ event_type: type, product_slug: slug, path, referrer });

    return json(202, { ok: true });
  } catch (err) {
    console.error('track.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};