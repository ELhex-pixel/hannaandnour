/**
 * Shared helpers for Hanna & Nour Netlify Functions.
 * Uses the Supabase service_role key (server-side only, never exposed).
 */

const { createClient } = require('@supabase/supabase-js');
// `ws` polyfill: supabase-js instancie toujours un client realtime au
// constructeur, et @supabase/realtime-js récent exige un WebSocket global
// (absent sur les runtimes Node < 22 des fonctions Netlify). L'app n'utilise
// pas realtime, mais sans transport le constructeur lève et fait 500 sur
// toutes les fonctions.
const { WebSocket } = require('ws');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': new URL((['deploy-preview', 'branch-deploy'].includes(process.env.CONTEXT) ? process.env.DEPLOY_PRIME_URL : process.env.SITE_URL) || 'https://hannanour.com').origin,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
    body: JSON.stringify(body)
  };
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    { realtime: { transport: WebSocket }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

function isConfigured() {
  if (process.env.STAGING_MODE === 'true' || ['deploy-preview', 'branch-deploy'].includes(process.env.CONTEXT)) {
    if (process.env.STAGING_MODE !== 'true' || !process.env.EXPECTED_STAGING_SUPABASE_URL || !process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL === process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL !== process.env.EXPECTED_STAGING_SUPABASE_URL || !String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_')) return false;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  return true;
}

function readBody(event) {
  if (!event.body) return {};
  try {
    if (typeof event.body === 'string' && Buffer.byteLength(event.body) > 6 * 1024 * 1024) return {};
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch (e) {
    return {};
  }
}

/**
 * Send a transactional email through Resend.
 * Requires RESEND_API_KEY env var (optional — sending is skipped when absent).
 */
async function sendEmail({ to, subject, html, from }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      from: from || process.env.MAIL_FROM || 'Hanna & Nour <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) {
    throw new Error('Email delivery failed (' + res.status + ')');
  }
  return { ok: true };
}

/* ---------------- Admin session tokens ----------------
 * ADMIN_PASSWORD is the only secret. It acts as the HMAC key, so no separate
 * token secret is needed. Tokens are signed (payload.exp + HMAC) and valid 12h.
 */

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

function signToken(secret, version) {
  const payload = Buffer.from(JSON.stringify({ e: Date.now() + ADMIN_TTL_MS, v: version || 0 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token, secret, version) {
  if (!token || !secret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return payload.e > Date.now() && (version === undefined || (payload.v || 0) === version);
  } catch (e) {
    return false;
  }
}

function getBearer(event) {
  const h = event.headers ? (event.headers.authorization || event.headers.Authorization || '') : '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  // NOTE: no `?token=` fallback — tokens in URLs leak into server logs,
  // browser history and referrers. Admin and user sessions use the header.
  return '';
}

// Canonical site URL for emails and redirects. SITE_URL (Netlify env var)
// wins; the fallback keeps local / `netlify dev` builds working unconfigured.
const DEFAULT_SITE_URL = 'https://hannanour.com';
const siteUrl = ((['deploy-preview', 'branch-deploy'].includes(process.env.CONTEXT) ? process.env.DEPLOY_PRIME_URL : process.env.SITE_URL) || DEFAULT_SITE_URL).replace(/\/+$/, '');

// Admin routes check `requireAdmin(event).ok` before doing anything.
async function requireAdmin(event, sb) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return { ok: false, error: 'ADMIN_PASSWORD is not set' };
  const { data, error } = await sb.from('settings').select('value').eq('key', 'admin_auth').maybeSingle();
  if (error) return { ok: false, error: 'Not authorized' };
  const ok = verifyToken(getBearer(event), secret, data && data.value ? data.value.token_version || 0 : 0);
  return ok ? { ok: true } : { ok: false, error: 'Not authorized' };
}

/* ---------------- Admin password (forgot/reset) ----------------
 * The login password is stored as a salted SHA-256 hash in the `settings` row
 * `admin_auth` (jsonb). Until the first reset, the env ADMIN_PASSWORD is used
 * as the credential fallback; ADMIN_PASSWORD stays the HMAC signing key.
 */

// Returns "salt:sha256hex" so the hash is unique per reset.
function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt:' + salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}

// Constant-time check of a stored "salt:sha256hex" hash.
function verifyAdminHash(stored, password) {
  if (String(stored).startsWith('scrypt:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const want = Buffer.from(parts[2], 'hex');
    const got = crypto.scryptSync(password, parts[1], 64);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  const i = String(stored).indexOf(':');
  if (i <= 0) return false;
  const salt = stored.slice(0, i);
  const want = stored.slice(i + 1);
  const got = crypto.createHash('sha256').update(salt + password).digest('hex');
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Login check: stored salted hash first, then the env ADMIN_PASSWORD fallback.
async function checkAdminCredentials(sb, password) {
  try {
    const { data, error } = await sb.from('settings').select('value').eq('key', 'admin_auth').maybeSingle();
    if (error) return false;
    const auth = data && data.value;
    if (auth && typeof auth.password_hash === 'string' && auth.password_hash) {
      return verifyAdminHash(auth.password_hash, password);
    }
  } catch (e) { return false; }
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- Client sessions (Supabase Auth) ----------------
 * Uses the Supabase Auth API (access/refresh tokens issued to the end user).
 * The service-role client validates tokens server-side; nothing is trusted
 * from the browser except the token string itself.
 */

// Resolves the authenticated Supabase user from a client access token.
// Returns { ok, user } or { ok:false, error }.
async function requireUser(sb, token) {
  if (!token) return { ok: false, error: 'Not authenticated' };
  try {
    const { data, error } = await sb.auth.getUser(String(token));
    if (error || !data || !data.user) {
      return { ok: false, error: error && error.message ? error.message : 'Invalid session' };
    }
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid session' };
  }
}

/* ---------------- Settings (admin-editable, env fallback) ---------------- */

// Reads a settings row (jsonb). Falls back to `fallback` when the row is missing.
async function getSetting(sb, key, fallback) {
  try {
    const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
    if (!error && data && data.value != null) return data.value;
  } catch (e) { /* ignore */ }
  return fallback;
}

// Upserts a settings row (jsonb) and returns the stored value.
async function saveSetting(sb, key, value) {
  const { error } = await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

async function loadColorSwatches(sb) {
  const { data, error } = await sb.from('settings').select('key,value').like('key', 'product-color:%').order('key').limit(1001);
  if (error || (data || []).length > 1000) throw new Error('Les teintes ne sont pas disponibles actuellement.');
  const colors = require('../../public/js/colors');
  return (data || []).map(row => {
    const swatch = row.value && colors.cleanSwatch(row.value.name, row.value.hex);
    return swatch && row.key === 'product-color:' + swatch.name ? swatch : null;
  }).filter(Boolean);
}

// Falls back to a default catalog when the row is missing/malformed.
function defaultCatalog() {
  return { colors: [] };
}

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return isNaN(v) ? fallback : v;
}

function floatEnv(name, fallback) {
  const v = parseFloat(process.env[name]);
  return isNaN(v) ? fallback : v;
}

async function rateLimit(sb, event, scope, limit, seconds, identifier) {
  const headers = event.headers || {};
  const source = headers['x-nf-client-connection-ip'] || (process.env.NETLIFY_DEV === 'true' ? 'local' : 'unknown');
  const keys = [scope + ':ip:' + source];
  if (identifier) keys.push(scope + ':id:' + String(identifier).trim().toLowerCase());
  for (const key of keys) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const { data, error } = await sb.rpc('consume_rate_limit', { p_key: hash, p_limit: limit, p_seconds: seconds });
    if (error) return json(503, { error: 'temporarily_unavailable' });
    if (!data) {
      const response = json(429, { error: 'rate_limited' });
      response.headers['Retry-After'] = String(seconds);
      return response;
    }
  }
  return null;
}

module.exports = { json, getSupabase, isConfigured, readBody, sendEmail, CORS_HEADERS, rateLimit,
  signToken, verifyToken, getBearer, requireAdmin, requireUser, getSetting, saveSetting, loadColorSwatches, defaultCatalog, intEnv, floatEnv, siteUrl,
  hashAdminPassword, verifyAdminHash, checkAdminCredentials };
