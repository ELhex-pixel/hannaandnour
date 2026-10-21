/**
 * Hanna & Nour — Pending-order lifecycle (Netlify Scheduled Function).
 * Runs every five minutes. For unpaid orders (status 'pending' or 'abandoned'):
 *   - The separate relance job handles the sole reminder after 2 h unpaid.
 *   - 72 h after creation: archives unreserved drafts, keeping their history.
 * Checkout sessions expire after 30 minutes. A recovery pass checks Stripe
 * after 35 minutes in case the expiration webhook was missed. Unknown or
 * asynchronous payments are never assumed expired solely from their age.
 */
const { schedule } = require('@netlify/functions');
const { getSupabase, isConfigured } = require('./shared');

const HOUR = 60 * 60 * 1000;

async function deleteStaleOrders(sb) {
  const cutoff = new Date(Date.now() - 72 * HOUR).toISOString();
  const { data, error } = await sb
    .from('orders')
    .select('id')
    .eq('admin_archived', false)
    .eq('inventory_reserved', false)
    .in('status', ['pending', 'abandoned'])
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  let deleted = 0;
  for (const row of data || []) {
    const { error: delErr } = await sb.from('orders').update({ admin_archived: true }).eq('id', row.id).eq('inventory_reserved', false).in('status', ['pending', 'abandoned']);
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
  await sb.from('rate_limits').delete().lt('window_start', new Date(Date.now() - 48 * HOUR).toISOString());
  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = new (require('stripe'))(process.env.STRIPE_SECRET_KEY, { timeout: 5000, maxNetworkRetries: 0 });
    await require('./lib/authorized-checkout').recoverAuthorizedCheckouts(sb, require('./stripe-webhook').markPaid, stripe);
    const { data: stale, error } = await sb.from('orders').select('id, stripe_session_id, stripe_creation_started, created_at,total_cents,currency').eq('inventory_reserved', true).eq('status', 'pending').lt('created_at', new Date(Date.now() - 35 * 60 * 1000).toISOString()).limit(50);
    if (error) throw error;
    for (const order of stale || []) {
      try {
        if (!order.stripe_session_id && order.stripe_creation_started) {
          let cursor;
          for (let page = 0; page < 10 && !order.stripe_session_id; page++) {
            const sessions = await stripe.checkout.sessions.list({ limit: 100, created: { gte: Math.floor(new Date(order.created_at).getTime() / 1000) - 60 }, ...(cursor ? { starting_after: cursor } : {}) });
            const match = sessions.data.find(session => session.client_reference_id === order.id);
            if (match) {
              order.stripe_session_id = match.id;
              const { error: bindError } = await sb.from('orders').update({ stripe_session_id: match.id }).eq('id', order.id).is('stripe_session_id', null);
              if (bindError) throw bindError;
            }
            if (!sessions.has_more) break;
            cursor = sessions.data[sessions.data.length - 1].id;
          }
          if (!order.stripe_session_id) { console.error('Unbound checkout needs manual reconciliation', order.id); continue; }
        }
        if (order.stripe_session_id) {
          const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
          if (session.id !== order.stripe_session_id || session.client_reference_id !== order.id || session.metadata?.order_id !== order.id || session.amount_total !== order.total_cents || session.currency !== order.currency) continue;
          if (session.status === 'complete' && ['paid', 'no_payment_required'].includes(session.payment_status)) {
            await require('./lib/authorized-checkout').settleCheckout(sb, session, require('./stripe-webhook').markPaid, stripe);
            continue;
          }
          if (session.status !== 'expired' || session.payment_status !== 'unpaid') continue;
        }
        const { error: releaseError } = await sb.rpc('release_order', { p_order_id: order.id, p_status: 'abandoned' });
        if (releaseError) throw releaseError;
      } catch {
        console.error('Pending checkout recovery unconfirmed; reservation retained');
      }
    }
  }
  const result = { deleted: 0 };
  result.deleted = await deleteStaleOrders(sb);
  return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
}

exports.handler = schedule('*/5 * * * *', handler);
