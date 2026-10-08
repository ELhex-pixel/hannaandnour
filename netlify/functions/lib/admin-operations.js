const { json, getSetting } = require('../shared');
const { returnPolicy } = require('./return-policy');
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function adminOperations(sb, action, body) {
  if (action === 'getReturnPolicy') return json(200, { policy: returnPolicy(await getSetting(sb,'return_policy',null),await getSetting(sb,'shipping',{})) });
  if (action === 'saveReturnPolicy') {
    if (!Number.isInteger(body.days) || body.days < 14 || body.days > 365 || !['customer','store'].includes(body.withdrawal_payer) || typeof body.expected_version !== 'string') return json(400,{ error:'Choisissez un délai de 14 à 365 jours. Zéro est une valeur de saisie, pas une suppression des droits légaux. Les anciennes commandes conservent leur délai.' });
    const { data, error } = await sb.rpc('save_return_policy',{ p_days:body.days,p_payer:body.withdrawal_payer,p_expected_version:body.expected_version });
    return error ? json(409,{ error:'Politique non confirmée : actualisez avant de réessayer.' }) : json(200,{ policy:data });
  }
  if (action === 'listVariantCosts') {
    const { data, error } = await sb.from('variant_costs').select('variant_id,unit_cost_cents,currency,updated_at').order('variant_id').limit(1000);
    if (error) throw error;
    return json(200,{ costs:data || [], limited:(data || []).length === 1000 });
  }
  if (action === 'saveVariantCost') {
    if (!ID.test(body.variant_id || '') || (body.unit_cost_cents !== null && (!Number.isInteger(body.unit_cost_cents) || body.unit_cost_cents < 0 || body.unit_cost_cents > 100000000)) || !['eur','usd'].includes(body.currency) || String(body.reason || '').trim().length < 3 || String(body.reason || '').length > 300 || (body.expected_updated_at != null && !Number.isFinite(Date.parse(body.expected_updated_at)))) return json(400,{ error:'Variante, coût en centimes, devise et motif valides requis. Un coût vide reste inconnu.' });
    const { data, error } = await sb.rpc('save_variant_cost',{ p_variant_id:body.variant_id,p_cents:body.unit_cost_cents,p_currency:body.currency,p_expected:body.expected_updated_at || null,p_reason:body.reason.trim() });
    return error ? json(409,{ error:'Coût non confirmé : actualisez pour vérifier une modification concurrente.' }) : json(200,{ cost:data });
  }
  return null;
}
module.exports = { adminOperations };
