const { json } = require('../shared');

async function customerReturnList(sb, userId, body) {
  const page = Math.min(10000, Math.max(1, parseInt(body.page, 10) || 1));
  const limit = [5,10,25].includes(Number(body.limit)) ? Number(body.limit) : 5;
  const scope = body.scope || 'all';
  if (!['all','available','open','closed'].includes(scope)) return json(400, { error: 'Invalid return list filter' });
  try {
    const { data, error } = await sb.rpc('customer_return_orders', { p_user_id: userId, p_query: String(body.query || '').trim().slice(0,100), p_scope: scope, p_offset: (page-1)*limit, p_limit: limit });
    if (error || !data || !Array.isArray(data.orders) || !Number.isSafeInteger(data.total) || data.total < data.orders.length) throw new Error('Unconfirmed list');
    return json(200, { orders: data.orders, total: data.total, page, limit, has_more: page*limit<data.total });
  } catch (error) { return json(503, { error: 'Returns temporarily unavailable' }); }
}
module.exports = { customerReturnList };
