const { json } = require('../shared');
const { cartOffer } = require('../../../public/js/commerce');

async function adminCartOffer(sb, action, body) {
  if (action !== 'getCartOffer' && action !== 'saveCartOffer') return json(400, { error: 'Action inconnue' });
  let offer;
  if (action === 'saveCartOffer') {
    offer = cartOffer(body.offer);
    if (!body.offer || typeof body.offer.enabled !== 'boolean' || !Number.isInteger(body.offer.percent_off) || offer.enabled !== body.offer.enabled || offer.percent_off !== body.offer.percent_off) return json(400, { error: 'Choisissez une réduction entière de 1 à 100 % pour activer la promotion.' });
  }
  try {
    if (action === 'getCartOffer') {
      const { data, error } = await sb.from('settings').select('value').eq('key', 'cart_offer').maybeSingle();
      if (error) throw error;
      offer = cartOffer(data && data.value);
    } else {
      const { error } = await sb.from('settings').upsert({ key: 'cart_offer', value: offer, updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    return json(200, { offer });
  } catch (error) {
    return json(503, { error: action === 'getCartOffer' ? 'Promotion indisponible. Actualisez pour vérifier son état.' : 'Enregistrement non confirmé. Actualisez pour vérifier avant de réessayer.' });
  }
}

module.exports = { adminCartOffer };
