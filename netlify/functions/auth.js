/**
 * Hanna & Nour - Client authentication (Supabase Auth via the service-role client).
 *
 * Actions (POST JSON):
 *   signup   { email, password, first_name }  -> creates + auto-login the account
 *   login    { email, password }              -> session + links past orders by email
 *   refresh  { refresh_token }                -> new session pair
 *   forgotPassword { email }                  -> sends a Supabase reset link
 *   updatePassword (Bearer token) { password }-> sets a new password
 *   me       (Bearer token)                   -> current user
 *   orders   (Bearer token)                   -> orders linked to the account
 *   wishlist (Bearer token) GET               -> favorite slugs
 *   wishlist (Bearer token) POST { slugs }    -> replace favorites
 *
 * All reads use service_role so no client table access is required.
 */
const { json, getSupabase, isConfigured, readBody, requireUser, getBearer, CORS_HEADERS, siteUrl, rateLimit, sendEmail } = require('./shared');
const crypto = require('crypto');

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
    if (!['signup', 'login', 'refresh', 'forgotPassword', 'updatePassword', 'me', 'orders', 'wishlist', 'requestOrderClaim', 'confirmOrderClaim'].includes(action)) return json(400, { error: 'Unknown action' });
    const limited = await rateLimit(sb, event, 'auth:' + action, ['login', 'signup', 'forgotPassword', 'requestOrderClaim', 'confirmOrderClaim'].includes(action) ? 10 : 120, 600, ['login', 'signup', 'forgotPassword'].includes(action) ? body.email : null);
    if (limited) return limited;

    switch (action) {

      case 'signup': {
        const email = String(body.email || '').toLowerCase().trim();
        const password = String(body.password || '');
        const firstName = String(body.first_name || '').trim().slice(0, 60);
        if (!isValidEmail(email) || email.length > 254) return json(400, { error: 'Invalid email' });
        if (password.length < 8 || password.length > 256) return json(400, { error: 'Password must contain 8 to 256 characters' });

        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { first_name: firstName }, emailRedirectTo: siteUrl + '/account.html' }
        });
        if (error) {
          if (/already registered|already been registered|email.*exists/i.test(error.message)) {
            return json(400, { error: 'email_taken' });
          }
          return json(400, { error: error.message });
        }

        return json(200, { session: data.session || null, user: data.session ? publicUser(data.user) : null, confirmation_required: !data.session });
      }

      case 'login': {
        const email = String(body.email || '').toLowerCase().trim();
        const password = String(body.password || '');
        if (!isValidEmail(email) || email.length > 254 || password.length > 256) return json(400, { error: 'bad_credentials' });

        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          return json(400, { error: 'bad_credentials' });
        }
        const u = data.session && data.session.user;
        return json(200, { session: data.session, user: publicUser(u) });
      }

      case 'refresh': {
        const refreshToken = String(body.refresh_token || '');
        if (!refreshToken) return json(400, { error: 'Missing refresh_token' });
        const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
        if (error || !data.session) return json(401, { error: 'invalid_refresh_token' });
        return json(200, { session: data.session, user: publicUser(data.session.user) });
      }

      case 'forgotPassword': {
        const email = String(body.email || '').toLowerCase().trim();
        if (!isValidEmail(email)) return json(400, { error: 'Invalid email' });
        const base = siteUrl;
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: base + '/reset.html'
        });
        if (error) {
          const msg = String(error.message || '');
          const tooFast = error.status === 429 || /rate|frequency|only request this/i.test(msg);
          if (tooFast) return json(429, { error: 'rate_limited' });
          return json(400, { error: 'reset_send_failed' });
        }
        // Always succeed — never leak whether the email exists.
        return json(200, { ok: true });
      }

      case 'updatePassword': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok) return json(401, { error: auth.error });
        const password = String(body.password || '');
        if (password.length < 8 || password.length > 256) return json(400, { error: 'Password must contain 8 to 256 characters' });
        const { error } = await sb.auth.admin.updateUserById(auth.user.id, { password });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
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
        let query = sb.from('orders').select('*, order_items(*)').eq('user_id', user.id);

        // Optional date range on created_at (values "YYYY-MM-DD").
        const from = String(body.from || '').trim();
        const to = String(body.to || '').trim();
        const fromTs = from && !isNaN(new Date(from + 'T00:00:00').getTime()) ? new Date(from + 'T00:00:00').toISOString() : null;
        const toTs = to && !isNaN(new Date(to + 'T23:59:59.999').getTime()) ? new Date(to + 'T23:59:59.999').toISOString() : null;
        if (fromTs) query = query.gte('created_at', fromTs);
        if (toTs) query = query.lte('created_at', toTs);

        const { data: orders, error } = await query
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        return json(200, { orders });
      }

      case 'requestOrderClaim': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok || !auth.user.email) return json(401, { error: 'Not authenticated' });
        const limited = await rateLimit(sb, event, 'order-claim-send', 3, 600, auth.user.id);
        if (limited) return limited;
        if (!process.env.RESEND_API_KEY) return json(503, { error: 'Email unavailable' });
        const code = String(crypto.randomInt(100000, 1000000));
        const codeHash = crypto.createHash('sha256').update(auth.user.id + ':' + code).digest('hex');
        const { error } = await sb.from('order_claims').upsert({ user_id: auth.user.id, email: auth.user.email.toLowerCase().trim(), code_hash: codeHash, expires_at: new Date(Date.now() + 600000).toISOString(), attempts: 0 });
        if (error) throw error;
        await sendEmail({ to: auth.user.email, subject: 'Hanna & Nour — confirmation de vos commandes', html: '<p>Votre code de confirmation : <strong>' + code + '</strong>. Il expire dans 10 minutes. Ne le partagez pas.</p>' });
        return json(200, { ok: true });
      }

      case 'confirmOrderClaim': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok) return json(401, { error: 'Not authenticated' });
        const limited = await rateLimit(sb, event, 'order-claim-confirm', 10, 600, auth.user.id);
        if (limited) return limited;
        const code = String(body.code || '');
        if (!/^\d{6}$/.test(code)) return json(400, { error: 'Invalid code' });
        const hash = crypto.createHash('sha256').update(auth.user.id + ':' + code).digest('hex');
        const { data, error } = await sb.rpc('claim_guest_orders', { p_user_id: auth.user.id, p_hash: hash });
        if (error) throw error;
        return json(data ? 200 : 400, data ? { ok: true } : { error: 'Invalid or expired code' });
      }

      case 'wishlist': {
        const auth = await requireUser(sb, bearerToken(event));
        if (!auth.ok) return json(401, { error: auth.error });
        const userId = auth.user.id;

        if (String(body.method || 'GET').toUpperCase() === 'GET' || body.slugs === undefined) {
          return json(200, { slugs: await readWishlist(sb, userId) });
        }

        const slugs = Array.isArray(body.slugs)
          ? body.slugs.map(String).map((s) => s.trim()).filter(Boolean)
          : [];
        const unique = Array.from(new Set(slugs));
        return json(200, { slugs: await writeWishlist(sb, userId, unique) });
      }

      default:
        return json(400, { error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('Authentication request failed');
    return json(500, { error: 'Authentication temporarily unavailable' });
  }
};

function bearerToken(event) {
  // Aligned with shared.getBearer: Authorization header only. A `?token=`
  // fallback was removed because tokens in URLs leak into server logs,
  // browser history and referrers.
  return getBearer(event);
}

// Resilient wishlist helpers: if the user_wishlist table is missing (migration
// `supabase/rls_accounts.sql` not run yet) we degrade to an empty list instead
// of failing the whole cart/account (favorites stay persisted client-side).
async function readWishlist(sb, userId) {
  try {
    const { data, error } = await sb.from('user_wishlist').select('slug').eq('user_id', userId);
    if (error) throw error;
    return (data || []).map((r) => r.slug).filter(Boolean);
  } catch (e) {
    console.error('readWishlist failed:', e.message);
    return [];
  }
}

async function writeWishlist(sb, userId, unique) {
  try {
    const { error: delErr } = await sb.from('user_wishlist').delete().eq('user_id', userId);
    if (delErr) throw delErr;
    if (unique.length) {
      const { error: insErr } = await sb.from('user_wishlist').insert(
        unique.map((slug) => ({ user_id: userId, slug }))
      );
      if (insErr) throw insErr;
    }
    return unique;
  } catch (e) {
    console.error('writeWishlist failed:', e.message);
    return unique;
  }
}
