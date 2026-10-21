/** One recovery email after two hours unpaid; bounded, claimed and throttled. */
const { schedule } = require('@netlify/functions');
const { getSupabase, isConfigured } = require('./shared');
const { sendCheckoutReminders } = require('./lib/checkout-reminders');

async function handler() {
  if (!isConfigured()) return { statusCode: 503, body: 'Supabase not configured' };
  try {
    const sent = await sendCheckoutReminders(getSupabase());
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch {
    console.error('Checkout reminders unavailable');
    return { statusCode: 503, body: 'Reminders temporarily unavailable' };
  }
}

exports.handler = schedule('*/15 * * * *', handler);
