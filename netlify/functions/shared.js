/**
 * Shared helpers for Hanna & Nour Netlify Functions.
 * Uses the Supabase service_role key (server-side only, never exposed).
 */

const { createClient } = require('@supabase/supabase-js');

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

module.exports = { json, getSupabase, isConfigured, readBody, sendEmail, CORS_HEADERS };