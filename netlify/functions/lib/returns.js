const { json } = require('../shared');

async function adminReturns(sb, action, body) {
  if (action === 'listReturnRequests') {
    const { data, error } = await sb.from('return_requests').select('*, orders(order_number,refunded_cents,total_cents,currency,return_policy), order_items(product_name, variant)').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const received = (data || []).filter(request => request.status === 'received').map(request => request.id);
    let inspections = [];
    if (received.length) {
      const result = await sb.from('order_returns').select('return_ref,quantity,sellable_quantity,inspection_note').in('return_ref',received);
      if (result.error) throw result.error;
      inspections = result.data || [];
    }
    for (const request of data || []) {
      request.inspection = inspections.find(entry => entry.return_ref === request.id) || null;
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
    const note = String(body.note || '').trim();
    if (note.length < 3 || note.length > 500 || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.id || '')) return json(400, { error: 'Renseignez un motif de 3 à 500 caractères.' });
    if (body.status === 'received' && (!Number.isInteger(body.sellable_quantity) || body.sellable_quantity < 0)) return json(400, { error: 'Indiquez le nombre d’articles contrôlés et revendables, zéro si aucun.' });
    if (body.status !== 'received' && !['customer','store'].includes(body.shipping_payer)) return json(400, { error: 'Indiquez qui prend en charge le retour.' });
    const { data, error } = await sb.rpc(body.status === 'received' ? 'inspect_return_request' : 'decide_return_request', body.status === 'received'
      ? { p_id: body.id, p_sellable: body.sellable_quantity, p_note: note }
      : { p_id: body.id, p_status: body.status, p_payer: body.shipping_payer, p_note: note });
    if (error) return json(409, { error: 'Retour non confirmé : vérifiez son état, les quantités et la prise en charge boutique en cas d’erreur ou non-conformité.' });
    return json(200, data);
  }
  if (action === 'recordReturn') {
    if (!Number.isInteger(body.quantity) || body.quantity < 1 || !Number.isInteger(body.sellable_quantity) || body.sellable_quantity < 0 || body.sellable_quantity > body.quantity || typeof body.return_ref !== 'string' || body.return_ref.length < 1 || body.return_ref.length > 100 || String(body.note || '').trim().length < 3 || String(body.note || '').length > 500) return json(400, { error: 'Contrôle physique, quantité revendable et motif obligatoires.' });
    const { data, error } = await sb.rpc('inspect_order_return', {
      p_order_id: body.order_id, p_item_id: body.order_item_id, p_quantity: body.quantity,
      p_ref: body.return_ref, p_reason: String(body.reason || 'retour_client').slice(0, 500), p_sellable: body.sellable_quantity, p_note: body.note.trim()
    });
    if (error) {
      const code = ['return_invalid','return_order_unavailable','return_item_missing','return_quantity_unavailable','return_request_open','return_operation_mismatch','return_variant_unavailable'].find(value => String(error.message || '').includes(value));
      return json(409, { error: code === 'return_request_open' ? 'Une demande client est ouverte pour cet article : traitez-la dans Retours clients.' : 'Retour non confirmé : vérifiez la commande, les quantités et l’état du contrôle.', code: code || 'return_unavailable' });
    }
    return json(200, data);
  }
  return null;
}
module.exports = { adminReturns };
