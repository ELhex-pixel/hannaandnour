const { json } = require('../shared');

async function adminReturns(sb, action, body) {
  if (action === 'listReturnRequests') {
    const { data, error } = await sb.from('return_requests').select('*, orders(order_number), order_items(product_name, variant)').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    for (const request of data || []) {
      request.evidence_urls = [];
      for (const path of (request.evidence_paths || []).slice(0, 3)) {
        const result = await sb.storage.from('return-evidence').createSignedUrl(path, 300);
        if (!result.error && result.data) request.evidence_urls.push(result.data.signedUrl);
      }
    }
    return json(200, { requests: data || [] });
  }
  if (action === 'updateReturnRequest') {
    if (!['approved', 'rejected', 'received'].includes(body.status)) return json(400, { error: 'Invalid status' });
    const { data: request, error } = await sb.from('return_requests').select('*').eq('id', body.id).maybeSingle();
    if (error) throw error;
    if (!request) return json(404, { error: 'Request not found' });
    if (request.status === body.status) return json(200, { ok: true, already: true });
    const allowed = { requested: ['approved', 'rejected'], approved: ['received', 'rejected'] };
    if (!(allowed[request.status] || []).includes(body.status)) return json(409, { error: 'Invalid transition' });
    if (body.status === 'received') {
      const { data, error: rErr } = await sb.rpc('receive_return_request', { p_id: request.id });
      if (rErr) return json(409, { error: 'Return cannot be received' });
      return json(200, data);
    }
    const { data: updated, error: uErr } = await sb.from('return_requests').update({ status: body.status, updated_at: new Date().toISOString() }).eq('id', request.id).eq('status', request.status).select('id');
    if (uErr) throw uErr;
    return json(updated && updated.length ? 200 : 409, { ok: !!(updated && updated.length) });
  }
  if (action === 'recordReturn') {
    const { data, error } = await sb.rpc('record_order_return', {
      p_order_id: body.order_id, p_item_id: body.order_item_id, p_quantity: parseInt(body.quantity, 10),
      p_ref: String(body.return_ref || '').slice(0, 100), p_reason: String(body.reason || 'retour_client').slice(0, 500)
    });
    if (error) return json(409, { error: 'Return quantity or order unavailable' });
    return json(200, data);
  }
  return null;
}
module.exports = { adminReturns };
