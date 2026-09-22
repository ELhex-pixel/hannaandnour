/**
 * Shared helpers for Hanna & Nour Netlify Functions.
 * Uses the Supabase service_role key (server-side only, never exposed).
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body)
  };
}

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

function isConfigured() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  return true;
}

function readBody(event) {
  if (!event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
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
    body: JSON.stringify({
      from: from || process.env.MAIL_FROM || 'Hanna & Nour <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error('Resend error ' + res.status + ': ' + errBody.slice(0, 300));
  }
  return { ok: true };
}

/* ---------------- Admin session tokens ----------------
 * ADMIN_PASSWORD is the only secret. It acts as the HMAC key, so no separate
 * token secret is needed. Tokens are signed (payload.exp + HMAC) and valid 12h.
 */

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

function signToken(secret) {
  const payload = Buffer.from(JSON.stringify({ e: Date.now() + ADMIN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    return payload.e > Date.now();
  } catch (e) {
    return false;
  }
}

function getBearer(event) {
  const h = event.headers ? (event.headers.authorization || event.headers.Authorization || '') : '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  const q = event.queryStringParameters || {};
  return q.token || '';
}

// Admin routes check `requireAdmin(event).ok` before doing anything.
function requireAdmin(event) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return { ok: false, error: 'ADMIN_PASSWORD is not set' };
  const ok = verifyToken(getBearer(event), secret);
  return ok ? { ok: true } : { ok: false, error: 'Not authorized' };
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

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return isNaN(v) ? fallback : v;
}

function floatEnv(name, fallback) {
  const v = parseFloat(process.env[name]);
  return isNaN(v) ? fallback : v;
}

module.exports = { json, getSupabase, isConfigured, readBody, sendEmail, CORS_HEADERS,
  signToken, verifyToken, getBearer, requireAdmin, getSetting, intEnv, floatEnv };