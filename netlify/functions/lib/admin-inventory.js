const { json } = require('../shared');
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const validId = value => typeof value === 'string' && UUID.test(value);
const quantity = value => Number.isInteger(value) && value >= 0 && value <= 1000000;
const ERRORS = {
  inventory_invalid: [400, 'Renseignez une quantité entière et un motif de 3 à 300 caractères.'],
  inventory_operation_mismatch: [409, 'Cette opération a déjà été utilisée avec d’autres valeurs. Vérifiez le journal.'],
  inventory_variant_missing: [404, 'Variante introuvable.'],
  inventory_stock_changed: [409, 'Le stock disponible a changé. Actualisez la variante avant de corriger le comptage.'],
  inventory_stock_bounds: [409, 'La quantité ferait dépasser les limites du stock disponible.'],
  preparation_order_unavailable: [409, 'Commande non disponible : vérifiez le paiement, les remboursements, le stock et l’expédition.'],
  preparation_item_missing: [404, 'Article introuvable dans cette commande.'],
  preparation_quantity_invalid: [400, 'La quantité vérifiée doit rester comprise entre 0 et la quantité commandée.'],
  preparation_changed: [409, 'La préparation a changé dans une autre fenêtre. Rechargez la commande.'],
  preparation_incomplete: [409, 'Vérifiez toutes les unités avant de confirmer le colis prêt.']
};

async function inventoryAction(sb, action, body) {
  if (action === 'listInventoryAdjustments') {
    if (body.variant_id !== undefined && !validId(body.variant_id)) return json(400, { error: 'Variante invalide.' });
    let query = sb.from('inventory_adjustments').select('id,variant_id,mode,quantity,stock_before,stock_after,reason,product_name,color,size,barcode,created_at').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
    if (body.variant_id) query = query.eq('variant_id', body.variant_id);
    const { data, error } = await query;
    if (error) return json(503, { error: 'Journal indisponible. Vérifiez la migration admin_inventory avant publication.' });
    return json(200, { adjustments: data || [], limit: 100 });
  }
  let rpc, args;
  if (action === 'adjustInventory' || action === 'scanSetStock') {
    const mode = action === 'scanSetStock' ? 'count' : body.mode;
    const qty = action === 'scanSetStock' ? body.qty : body.quantity;
    if (!validId(body.operation_id) || !validId(body.variant_id) || !['restock', 'remove', 'count'].includes(mode) || !quantity(qty) || (mode !== 'count' && qty === 0) || !quantity(body.expected_stock) || typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 300) {
      return json(400, { error: 'Renseignez la variante, l’identifiant d’opération, la quantité entière, le stock affiché et un motif de 3 à 300 caractères.' });
    }
    rpc = 'adjust_inventory';
    args = { p_operation_id: body.operation_id, p_variant_id: body.variant_id, p_mode: mode, p_quantity: qty, p_expected_stock: body.expected_stock, p_reason: body.reason.trim() };
  } else if (action === 'setPreparationQuantity') {
    if (!validId(body.order_id) || !validId(body.item_id) || !quantity(body.quantity) || !quantity(body.expected_quantity)) return json(400, { error: 'Commande, article ou quantité invalide.' });
    rpc = 'set_preparation_quantity';
    args = { p_order_id: body.order_id, p_item_id: body.item_id, p_quantity: body.quantity, p_expected_quantity: body.expected_quantity };
  } else if (action === 'completePreparation') {
    if (!validId(body.order_id)) return json(400, { error: 'Commande invalide.' });
    rpc = 'complete_preparation';
    args = { p_order_id: body.order_id };
  } else return json(400, { error: 'Action inconnue.' });
  const { data, error } = await sb.rpc(rpc, args);
  if (error) {
    const failure = ERRORS[error.message];
    if (failure) return json(failure[0], { error: failure[1], code: error.message });
    return json(503, { error: 'Opération non confirmée. Vérifiez l’historique ou rechargez avant de recommencer.' });
  }
  if (!data) return json(503, { error: 'Opération non confirmée.' });
  return json(200, { result: data });
}

async function adminInventory(sb, action, body) {
  try {
    return await inventoryAction(sb, action, body);
  } catch (error) {
    return json(503, { error: 'Opération non confirmée. Vérifiez le journal ou rechargez la commande avant de recommencer.' });
  }
}

module.exports = { adminInventory };
