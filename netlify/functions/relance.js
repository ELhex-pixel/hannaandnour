/**
 * Hanna & Nour — Abandoned-cart recovery (Netlify Scheduled Function).
 * Runs every day at 08:30 UTC and sends ONE reminder email per abandoned cart
 * (pending orders created more than 2 h ago) with a link that restores the
 * exact cart contents (`/cart.html?restore=<cart_token>`).
 */
const { schedule } = require('@netlify/functions');
const { getSupabase, isConfigured, sendEmail } = require('./shared');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(order, link) {
  const siteUrl = (process.env.SITE_URL || 'https://hannaandnour.netlify.app').replace(/\/$/, '');
  return '<div style="background:#f6f1e8;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;' +
    'font-family:Helvetica,Arial,sans-serif;padding:28px;"><h2 style="color:#8a2c2c;font-size:18px;">Votre panier vous attend</h2>' +
    '<p style="font-size:14px;color:#221f1a;">Bonjour ' + esc(order.customer_name) + ', vous avez commencé une commande chez Hanna &amp; Nour ' +
    'qui n\u2019a pas encore été finalisée. Reprenez exactement où vous en étiez :</p>' +
    '<table style="margin:18px 0;" role="presentation" width="100%"><tr><td align="center">' +
    '<a href="' + link + '" style="background:#221f1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Reprendre mon panier</a>' +
    '</td></tr></table>' +
    '<p style="font-size:12px;color:#8a7d66;">Ce lien est personnel et expire après utilisation. Questions ? Utilisez la page ' +
    '<a href="' + siteUrl + '/contact.html" style="color:#7d9b76;">contact</a>.</p></div></div>';
}

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
      .select('id, order_number, email, customer_name, cart_restore_token')
      .eq('status', 'pending')
      .lte('created_at', cutoff)
      .is('relance_sent_at', null)
      .limit(50);
    if (error) throw error;

    const siteUrl = (process.env.SITE_URL || 'https://hannaandnour.netlify.app').replace(/\/$/, '');
    let sent = 0;
    for (const order of data || []) {
      if (!order.email || !order.cart_restore_token) continue;
      const link = siteUrl + '/cart.html?restore=' + order.cart_restore_token;
      try {
        await sendEmail({
          to: order.email,
          subject: 'Votre panier vous attend \u2014 Hanna & Nour',
          html: buildHtml(order, link)
        });
        await sb.from('orders').update({ relance_sent_at: new Date().toISOString() }).eq('id', order.id);
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