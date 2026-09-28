/**
 * Hanna & Nour — Shipping reminder (Netlify Scheduled Function).
 * Runs daily at 09:00 UTC: for every paid order created more than 24 h ago
 * that is not marked as shipped yet, emails a follow-up to the shop owner.
 * Already-reminded order ids are tracked in the settings key
 * `shipping_reminders` (no schema change required). Pickup orders are skipped.
 */
const { schedule } = require('@netlify/functions');
const { getSupabase, isConfigured, sendEmail, getSetting, saveSetting } = require('./shared');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function moneyStr(cents, currency) {
  const symbol = (currency || 'usd').toLowerCase() === 'eur' ? '\u20AC' : '$';
  return symbol + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildHtml(order) {
  const siteUrl = (process.env.SITE_URL || 'https://hannanour.netlify.app').replace(/\/$/, '');
  const created = new Date(order.created_at).toLocaleString('fr-FR');
  const addr = order.delivery_type === 'pickup'
    ? 'Retrait en point relais'
    : [order.address1, order.city, order.postal_code, order.country].filter(Boolean).map(esc).join(', ');
  return (
    '<div style="background:#f6f1e8;padding:24px;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;font-family:Helvetica,Arial,sans-serif;padding:28px;">' +
    '<h2 style="color:#8a2c2c;font-size:18px;">Exp&eacute;dition en attente</h2>' +
    '<p style="font-size:14px;color:#221f1a;line-height:1.5;">La commande <strong>' + esc(order.order_number) + '</strong> a &eacute;t&eacute; pay&eacute;e il y a plus d\u2019un jour et n\u2019est toujours pas marqu&eacute;e comme exp&eacute;di&eacute;e.</p>' +
    '<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;color:#221f1a;font-family:Helvetica,Arial,sans-serif;">' +
    '<tr><td style="padding:4px 0;color:#8a7d66;">Client</td><td style="padding:4px 0;">' + esc(order.customer_name) + ' &middot; ' + esc(order.email) + '</td></tr>' +
    '<tr><td style="padding:4px 0;color:#8a7d66;">Pass&eacute;e le</td><td style="padding:4px 0;">' + esc(created) + '</td></tr>' +
    '<tr><td style="padding:4px 0;color:#8a7d66;">Livraison</td><td style="padding:4px 0;">' + addr + '</td></tr>' +
    '<tr><td style="padding:4px 0;color:#8a7d66;">Total</td><td style="padding:4px 0;"><strong>' + moneyStr(order.total_cents, order.currency) + '</strong></td></tr>' +
    '</table>' +
    '<table style="margin:18px 0;" role="presentation" width="100%"><tr><td align="center">' +
    '<a href="' + siteUrl + '/admin.html" style="background:#221f1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Marquer comme exp&eacute;di&eacute;e</a>' +
    '</td></tr></table>' +
    '<p style="font-size:12px;color:#8a7d66;">Rappel automatique envoy&eacute; parce que la commande n\u2019a pas encore &eacute;t&eacute; exp&eacute;di&eacute;e dans un d&eacute;lai d\u2019un jour.</p>' +
    '</div></div>'
  );
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
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from('orders')
      .select('id, order_number, email, customer_name, phone, total_cents, currency, created_at, delivery_type, address1, city, postal_code, country')
      .eq('status', 'paid')
      .or('shipping_status.eq.new,shipping_status.is.null')
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    const reminded = (await getSetting(sb, 'shipping_reminders', {})) || {};
    const adminTo = process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL || 'care@hannanour.com';
    let sent = 0;
    for (const order of data || []) {
      if (order.delivery_type === 'pickup') continue;
      if (reminded[order.id]) continue;
      try {
        await sendEmail({
          to: adminTo,
          subject: 'Expedition en attente \u2014 ' + order.order_number,
          html: buildHtml(order)
        });
        reminded[order.id] = new Date().toISOString();
        sent++;
      } catch (e) {
        console.error('shipping reminder failed for ' + order.id + ':', e.message);
      }
    }
    if (sent > 0) {
      await saveSetting(sb, 'shipping_reminders', reminded);
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent }) };
  } catch (err) {
    console.error('shipping-reminder.js error:', err);
    return { statusCode: 500, body: 'error' };
  }
}

exports.handler = schedule('0 9 * * *', handler);