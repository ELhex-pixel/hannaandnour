const { json, getSupabase, isConfigured, rateLimit, CORS_HEADERS } = require('./shared');
const { createClient } = require('./lib/sendcloud');
const pickup = require('../../public/js/pickup-points');
const shipping = require('../../public/js/shipping-rules');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS };
  if (event.httpMethod !== 'GET') return json(405, { code: 'method_not_allowed' });
  const body = event.queryStringParameters || {};
  const country = pickup.country(body.country_code), postal = pickup.postal(country, body.postal_code);
  if (!country || !postal) return json(400, { code: 'pickup_invalid_postal' });
  if (!isConfigured()) return json(503, { code: 'pickup_unavailable' });
  try {
    const sb = getSupabase();
    const limited = await rateLimit(sb, event, 'service-points', 30, 600);
    if (limited) return limited;
    const { data, error } = await sb.from('settings').select('value').eq('key', 'shipping').maybeSingle();
    if (error) throw error;
    const saved=await sb.from('settings').select('value').eq('key','shipping_rules').maybeSingle();
    if(saved.error)throw saved.error;
    if(!shipping.enabled(shipping.resolve(saved.data?.value,data?.value),country,'pickup'))return json(409,{code:'pickup_disabled'});
    return json(200, await createClient().checkoutPoints({ country_code: country, postal_code: postal }));
  } catch {
    return json(503, { code: 'pickup_unavailable' });
  }
};
