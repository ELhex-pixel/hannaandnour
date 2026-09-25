/**
 * POST /api/newsletter
 * Body: { "email": "someone@example.com" }
 * Stores the subscription in the Supabase newsletter table.
 */
const { json, getSupabase, isConfigured, readBody } = require('./shared');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }

    const body = readBody(event);
    const email = String(body.email || '').trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
      return json(400, { error: 'Invalid email address' });
    }

    const sb = getSupabase();
    const { error } = await sb
      .from('newsletter')
      .upsert({ email, source: String(body.source || 'footer').slice(0, 50) }, { onConflict: 'email' });

    if (error) throw error;

    return json(200, { ok: true });
  } catch (err) {
    console.error('newsletter.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};