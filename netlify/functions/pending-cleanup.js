/**
 * Hanna & Nour — Pending-order lifecycle (Netlify Scheduled Function).
 * Runs hourly. For unpaid orders (status 'pending' or 'abandoned'):
 *   - 24 h after creation: sends ONE follow-up email with the cart restore
 *     link (single-send guarded by orders.reminder_24h_sent_at).
 *   - 72 h after creation: hard-deletes the order, which removes it from the
 *     admin order list. order_items / order_returns cascade; reviews keep
 *     their product link (order_id on delete set null).
 * Stripe Checkout Sessions expire after 24 h by default, so at 72 h no payment
 * can still be completed: deleting the draft can never orphan a charge.
 */
const { schedule } = require('@netlify/functions');
const { getSupabase, isConfigured, sendEmail, siteUrl } = require('./shared');

const HOUR = 60 * 60 * 1000;

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(order, link) {
  return '<div style="background:#f6f1e8;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;' +
    'font-family:Helvetica,Arial,sans-serif;padding:28px;"><h2 style="color:#8a2c2c;font-size:18px;">Votre panier sera retir&eacute; sous 48 h</h2>' +
    '<p style="font-size:14px;color:#221f1a;">Bonjour ' + esc(order.customer_name) + ', votre commande ' + esc(order.order_number) +
    ' chez Hanna &amp; Nour est toujours en attente de paiement. C\u2019est votre dernier rappel : sans r\u00e8glement, le panier sera retir\u00e9 automatiquement dans 48 heures.</p>' +
    '<table style="margin:18px 0;" role="presentation" width="100%"><tr><td align="center">' +
    '<a href="' + link + '" style="background:#221f1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block;">Finaliser ma commande</a>' +
    '</td></tr></table>' +
    '<p style="font-size:12px;color:#8a7d66;">Ce lien est personnel et expire apr\u00e8s utilisation. Questions ? Utilisez la page ' +
    '<a href="' + siteUrl + '/contact.html" style="color:#7d9b76;">contact</a>.</p></div></div>';
}

async function send24hEmails(sb) {
  if (!process.env.RESEND_API_KEY) return 0;
  const now = Date.now();
  const oldest = new Date(now - 24 * HOUR).toISOString();
  const floor = new Date(now - 72 * HOUR).toISOString();
  const { data, error } = await sb
    .from('orders')
    .select('id, order_number, email, customer_name, cart_restore_token')
    .in('status', ['pending', 'abandoned'])
    .lte('created_at', oldest)
    .gt('created_at', floor)
    .is('reminder_24h_sent_at', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  let sent = 0;
  for (const order of data || []) {
    if (!order.email || !order.cart_restore_token) continue;
    const link = siteUrl + '/cart.html?restore=' + order.cart_restore_token;
    try {
      // Atomic claim BEFORE sending: only the run that sets
      // reminder_24h_sent_at first can email the order (no duplicates).
      const { data: claimed, error: claimErr } = await sb
        .from('orders')
        .update({ reminder_24h_sent_at: new Date().toISOString() })
        .eq('id', order.id)
        .is('reminder_24h_sent_at', null)
        .select('id');
      if (claimErr) throw claimErr;
      if (!claimed || claimed.length === 0) continue;

      await sendEmail({
        to: order.email,
        subject: 'Votre commande ' + order.order_number + ' attend \u2014 Hanna & Nour',
        html: buildHtml(order, link)
      });
      sent++;
    } catch (e) {
      console.error('pending-cleanup email failed for ' + order.id + ':', e.message);
    }
  }
  return sent;
}

async function deleteStaleOrders(sb) {
  const cutoff = new Date(Date.now() - 72 * HOUR).toISOString();
  const { data, error } = await sb
    .from('orders')
    .select('id')
    .in('status', ['pending', 'abandoned'])
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  let deleted = 0;
  for (const row of data || []) {
    const { error: delErr } = await sb.from('orders').delete().eq('id', row.id);
    if (delErr) {
      console.error('pending-cleanup delete failed for ' + row.id + ':', delErr.message);
      continue;
    }
    deleted++;
  }
  return deleted;
}

async function handler() {
  if (!isConfigured()) {
    return { statusCode: 503, body: 'Supabase not configured' };
  }
  const sb = getSupabase();
  const result = { emails: 0, deleted: 0 };
  try {
    result.emails = await send24hEmails(sb);
  } catch (e) {
    // E.g. orders.reminder_24h_sent_at missing (migration not run yet):
    // log and keep the 72 h cleanup running regardless.
    console.error('pending-cleanup email step skipped:', e.message);
  }
  result.deleted = await deleteStaleOrders(sb);
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
}

exports.handler = schedule('0 * * * *', handler);