const { json, getSupabase, isConfigured, getBearer, requireUser, rateLimit } = require('./shared');
const { trackingLink } = require('./lib/tracking');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(503, { error: 'temporarily_unavailable' });
  try {
    const sb = getSupabase();
    const auth = await requireUser(sb, getBearer(event));
    if (!auth.ok) return json(401, { error: 'Not authenticated' });
    const limited = await rateLimit(sb, event, 'tracking', 60, 600, auth.user.id);
    if (limited) return limited;
    const id = String((event.queryStringParameters || {}).order_id || '');
    const { data: order, error } = await sb.from('orders').select('order_number, status, shipping_status, created_at, paid_at, shipped_at, delivered_at, carrier, tracking_number').eq('id', id).eq('user_id', auth.user.id).maybeSingle();
    if (error) throw error;
    if (!order) return json(404, { error: 'Order not found' });
    return json(200, { order, tracking_url: trackingLink(order.carrier, order.tracking_number) });
  } catch (error) { return json(500, { error: 'Tracking temporarily unavailable' }); }
};
