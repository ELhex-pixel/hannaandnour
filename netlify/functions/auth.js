/**
 * Hanna & Nour - Client authentication (Supabase Auth via the service-role client).
 *
 * Actions (POST JSON):
 *   signup   { email, password, first_name }  -> creates + auto-login the account
 *   login    { email, password }              -> session + links past orders by email
 *   refresh  { refresh_token }                -> new session pair
 *   me       (Bearer token)                   -> current user
 *   orders   (Bearer token)                   -> orders linked to the account
 *   wishlist (Bearer token) GET               -> favorite slugs
 *   wishlist (Bearer token) POST { slugs }    -> replace favorites
 *
 * All reads use service_role so no client table access is required.
 */
const { json, getSupabase, isConfigured, readBody, requireUser, CORS_HEADERS } = require('./shared');

function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));
}

function publicUser(user) {
  if (!user) return null;
  const meta = (user.user_metadata || user.app_metadata || {});
  return {
    id: user.id,
    email: user.email,
    first_name: meta.first_name || ''
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }

    const sb = getSupabase();
    const body = readBody(event);
    const action = String(body.action || '').trim();

    switch (action) {

      case 'signup': {
        const email = String(body.email || '').toLowerCase().trim();
        const password = String(body.password || '');
        const firstName = String(body.first_name || '').trim().slice(0, 60);
        if (!isValidEmail(email)) return json(400, { error: 'Invalid email' });
        if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters' });

        const { data: created, error } = await sb.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { first_name: firstName }
        });
        if (error) {
          if (/already registered|already been registered|email.*exists/i.test(error.message)) {
            return json(400, { error: 'email_taken' });
          }
          return json(400, { error: error.message });
        }

        // Auto-login so the visitor lands as connected.
        const { data: sess, error: signErr } = await sb.auth.signInWithPassword({ email, password });
        if (signErr) return json(400, { error: signErr.message });
        const u = created.user || (sess && sess.user);
        if (u && u.email) {
          await linkOrdersByEmail(sb, u.id, u.email);
        }
        return json(200, { session: sess.session, user: publicUser(u) });
      }

      case 'login': {
        const email = String(body.email || '').toLowerCase().trim();
        const password = String(body.password || '');
        if (!isValidEmail(email)) return json(400, { error: 'Invalid email' });

        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          return json(400, { error: 'bad_credentials' });
        }
        const u = data.session && data.session.user;
        if (u && u.email) {
          await linkOrdersByEmail(sb, u.id, u.email);
        }
        return json(200, { session: data.session, user: publicUser(u) });
      }

      case 'refresh': {
        const refreshToken = String(body.refresh_token || '');
        if (!refreshToken) return json(400, { error: 'Missing refresh_token' });
        const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
        if (error || !data.session) return json(401, { error: 'invalid_refresh_token' });
        return json(200, { session: data.session, user: publicUser(data.session.user) });
      }

      case 'me': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok) return json(401, { error: auth.error });
        return json(200, { user: publicUser(auth.user) });
      }

      case 'orders': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok) return json(401, { error: auth.error });
        const user = auth.user;
        // PostgREST .or() filter: only inject the email when it is free of
        // filter syntax (commas/parens), user ids are Supabase UUIDs.
        const emailSafe = user.email && /^[^\s,()]+$/.test(user.email) ? user.email : null;
        const filter = emailSafe
          ? `user_id.eq.${user.id},email.eq.${emailSafe}`
          : `user_id.eq.${user.id}`;
        const { data: orders, error } = await sb
          .from('orders')
          .select('*, order_items(*)')
          .or(filter)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return json(200, { orders });
      }

      case 'wishlist': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok) return json(401, { error: auth.error });
        const userId = auth.user.id;

        if (String(body.method || 'GET').toUpperCase() === 'GET' || body.slugs === undefined) {
          const { data, error } = await sb.from('user_wishlist').select('slug').eq('user_id', userId);
          if (error) throw error;
          const slugs = (data || []).map((r) => r.slug).filter(Boolean);
          return json(200, { slugs });
        }

        const slugs = Array.isArray(body.slugs)
          ? body.slugs.map(String).map((s) => s.trim()).filter(Boolean)
          : [];
        const unique = Array.from(new Set(slugs));
        const { error: delErr } = await sb.from('user_wishlist').delete().eq('user_id', userId);
        if (delErr) throw delErr;
        if (unique.length) {
          const { error: insErr } = await sb.from('user_wishlist').insert(
            unique.map((slug) => ({ user_id: userId, slug }))
          );
          if (insErr) throw insErr;
        }
        return json(200, { slugs: unique });
      }

      default:
        return json(400, { error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('auth.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};

function bearerToken(event) {
  const h = event.headers ? (event.headers.authorization || event.headers.Authorization || '') : '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  const q = event.queryStringParameters || {};
  return q.token || '';
}

async function linkOrdersByEmail(sb, userId, email) {
  try {
    await sb.from('orders').update({ user_id: userId })
      .eq('email', String(email).toLowerCase().trim())
      .is('user_id', null);
  } catch (e) {
    console.error('linkOrdersByEmail failed:', e.message);
  }
}