/**
 * Hanna & Nour — Abandoned-cart recovery (Netlify Scheduled Function).
 * Runs every day at 08:30 UTC and sends ONE reminder email per abandoned cart
 * (pending orders created more than 2 h ago) with a link that restores the
 * exact cart contents (`/cart.html?restore=<cart_token>`).
 */
const { schedule } = require('@netlify/functions');
const { getSupabase, isConfigured, sendEmail, siteUrl } = require('./shared');
const { orderLocale, message } = require('./lib/customer-email');

async function handler() {
  try {
    if (!isConfigured()) {
      return { statusCode: 503, body: 'Supabase not configured' };
    }
    if (!process.env.RESEND_API_KEY) {
      return { statusCode: 200, body: 'OK (email not configured)' };
    }

    const sb = getSupabase();
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from('orders')
      .select('id, order_number, email, customer_name, cart_restore_token, stripe_session_id')
      .eq('status', 'pending')
      .lte('created_at', cutoff)
      .is('relance_sent_at', null)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    let sent = 0;
    for (const order of data || []) {
      if (!order.email || !order.cart_restore_token) continue;
      try {
        // Claim the order atomically BEFORE sending so two overlapping runs
        // can never email the same cart twice: only the run that marks
        // relance_sent_at first proceeds.
        const { data: claimed, error: claimErr } = await sb
          .from('orders')
          .update({ relance_sent_at: new Date().toISOString() })
          .eq('id', order.id)
          .is('relance_sent_at', null)
          .in('status', ['pending', 'abandoned'])
          .select('id');
        if (claimErr) throw claimErr;
        if (!claimed || claimed.length === 0) continue; // already claimed

        await sendEmail({
          to: order.email,
          ...message('cart', await orderLocale(order), { order, siteUrl })
        });
        sent++;
      } catch (e) {
        console.error('relance email failed for ' + order.id + ':', e.message);
      }
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch (err) {
    console.error('relance.js error:', err);
    return { statusCode: 500, body: 'error' };
  }
}

exports.handler = schedule('30 8 * * *', handler);
