const { json } = require('../shared');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function deleteProductsFromCatalog(sb, body) {
  if (!body || body.confirmation !== 'SUPPRIMER' || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100 || body.ids.some(id => typeof id !== 'string' || !uuid.test(id))) return json(400, { error: 'Sélection invalide ou confirmation SUPPRIMER manquante.' });
  const ids = [...new Set(body.ids.map(id => id.toLowerCase()))];
  try {
    const { data, error } = await sb.rpc('delete_products_from_catalog', { p_ids: ids, p_confirmation: 'SUPPRIMER' });
    if (error) throw error;
    if (!data || !Array.isArray(data.deleted_ids) || !Array.isArray(data.missing_ids)) throw new Error('Incomplete result');
    const resolved = data.deleted_ids.concat(data.missing_ids);
    if (resolved.length !== ids.length || resolved.some((id, index) => !ids.includes(id) || resolved.indexOf(id) !== index)) throw new Error('Incomplete result');
    return json(200, { deleted_ids: data.deleted_ids, missing_ids: data.missing_ids });
  } catch (error) {
    return json(503, { error: 'Suppression du catalogue non confirmée. Actualisez la liste pour vérifier avant de réessayer.' });
  }
}

module.exports = { deleteProductsFromCatalog };
