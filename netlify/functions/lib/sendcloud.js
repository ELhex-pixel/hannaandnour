const { json } = require('../shared');

const BASE_URL = 'https://panel.sendcloud.sc/api/v3';
const CARRIER = 'mondial_relay';
const MAX_RESPONSE_BYTES = 512 * 1024;
const POSTAL_CODE = /^(?:0[1-9]|[1-8]\d|9[0-5])\d{3}$/;
const MESSAGES = {
  sendcloud_not_configured: 'Les deux clés Sendcloud doivent être renseignées dans les variables serveur Netlify.',
  sendcloud_auth_failed: 'Sendcloud refuse ces clés. Vérifiez les variables serveur et le mode d’authentification de l’intégration.',
  sendcloud_forbidden: 'Cet accès API est refusé par Sendcloud. Vérifiez les droits de votre formule auprès de leur support.',
  sendcloud_rate_limited: 'Le quota Sendcloud est atteint. Réessayez plus tard.',
  sendcloud_timeout: 'Sendcloud ne répond pas dans le délai prévu. Réessayez plus tard.',
  sendcloud_unavailable: 'Sendcloud est temporairement indisponible.',
  sendcloud_invalid_response: 'La réponse Sendcloud est incomplète ou invalide.',
  sendcloud_request_rejected: 'Sendcloud refuse cette recherche. Vérifiez notamment l’activation des points relais dans l’intégration.',
  sendcloud_not_found: 'La ressource Sendcloud demandée est introuvable.',
  invalid_postal_code: 'Saisissez un code postal de France métropolitaine à cinq chiffres.'
};

class SendcloudError extends Error {
  constructor(code, statusCode = 503) {
    super(MESSAGES[code]);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function safeError(error) {
  return error instanceof SendcloudError ? error : new SendcloudError('sendcloud_unavailable');
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

async function responseJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    throw new SendcloudError('sendcloud_invalid_response', 502);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new SendcloudError('sendcloud_invalid_response', 502);
      chunks.push(Buffer.from(value));
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !Object.hasOwn(parsed, 'data')) throw new Error();
    return parsed.data;
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw error;
    throw new SendcloudError('sendcloud_invalid_response', 502);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function createClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const publicKey = text(env.SENDCLOUD_PUBLIC_KEY, 513);
  const secretKey = text(env.SENDCLOUD_SECRET_KEY, 513);
  const configured = !!publicKey && !!secretKey && publicKey.length <= 512 && secretKey.length <= 512
    && !/[\s:]/.test(publicKey) && !/\s/.test(secretKey);

  async function get(path, params = {}) {
    if (!configured) throw new SendcloudError('sendcloud_not_configured');
    if (!/^\/(?:user\/auth\/metadata|integrations\/[1-9]\d*|contracts|addresses\/sender-addresses|service-points)$/.test(path)) {
      throw new SendcloudError('sendcloud_request_rejected', 400);
    }
    const url = new URL(BASE_URL + path);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    try {
      const response = await fetchImpl(url.href, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json', Authorization: 'Basic ' + Buffer.from(publicKey + ':' + secretKey).toString('base64') }
      });
      if (!response.ok) {
        const code = { 400: 'sendcloud_request_rejected', 401: 'sendcloud_auth_failed', 403: 'sendcloud_forbidden', 404: 'sendcloud_not_found', 429: 'sendcloud_rate_limited' }[response.status] || 'sendcloud_unavailable';
        await response.body?.cancel().catch(() => {});
        throw new SendcloudError(code, [400, 401, 403, 404].includes(response.status) ? 502 : 503);
      }
      const data = await responseJson(response);
      return { data, incomplete: /rel\s*=\s*"?next\b/i.test(response.headers.get('link') || '') };
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new SendcloudError('sendcloud_timeout');
      throw safeError(error);
    }
  }

  async function inspect(path, params, summarize) {
    try {
      return { ok: true, ...summarize(await get(path, params)) };
    } catch (error) {
      const safe = safeError(error);
      return { ok: false, code: safe.code, error: safe.message };
    }
  }

  async function diagnostics() {
    const result = { configured, authenticated: false, purchases_enabled: false, automation_enabled: false };
    if (!configured) return result;
    const { data: auth } = await get('/user/auth/metadata');
    const id = auth?.integration_id;
    if (!Number.isSafeInteger(id) || id < 1) throw new SendcloudError('sendcloud_invalid_response', 502);
    result.authenticated = true;
    const [integration, contracts, senderAddresses] = await Promise.all([
      inspect('/integrations/' + id, {}, ({ data }) => {
        if (data?.id !== id || !Array.isArray(data.service_point_carriers) || typeof data.service_point_enabled !== 'boolean') {
          throw new SendcloudError('sendcloud_invalid_response', 502);
        }
        return {
          id, service_points_enabled: data.service_point_enabled,
          mondial_relay_enabled: data.service_point_carriers.includes(CARRIER),
          other_carriers_enabled: data.service_point_carriers.some(code => code !== CARRIER),
          webhook_active: data.webhook_active === true,
          feedback_type: ['eager', 'delayed', 'none'].includes(data.feedback_type) ? data.feedback_type : null
        };
      }),
      inspect('/contracts', { carrier_code: CARRIER, page_size: 100 }, ({ data, incomplete }) => {
        if (!Array.isArray(data)) throw new SendcloudError('sendcloud_invalid_response', 502);
        const rows = data.filter(row => row?.carrier?.code === CARRIER);
        return { total: rows.length, active: rows.filter(row => row.state === 'active').length, pending: rows.filter(row => row.state === 'validating').length, incomplete };
      }),
      inspect('/addresses/sender-addresses', { page_size: 100 }, ({ data, incomplete }) => {
        if (!Array.isArray(data)) throw new SendcloudError('sendcloud_invalid_response', 502);
        return { france: data.filter(row => row?.country_code === 'FR' && POSTAL_CODE.test(row.postal_code || '')).length, incomplete };
      })
    ]);
    return { ...result, integration, contracts, sender_addresses: senderAddresses };
  }

  async function servicePoints(body) {
    const postalCode = text(body.postal_code, 10);
    if (!POSTAL_CODE.test(postalCode) || (body.country_code !== undefined && body.country_code !== 'FR')) {
      throw new SendcloudError('invalid_postal_code', 400);
    }
    const { data } = await get('/service-points', { country_code: 'FR', carrier_code: CARRIER, address_postal_code: postalCode, limit: 20, radius: 15000 });
    if (!Array.isArray(data?.results)) throw new SendcloudError('sendcloud_invalid_response', 502);
    const points = data.results.filter(point => point?.carrier?.code === CARRIER && point.is_expired === false
      && point.address?.country_code === 'FR' && POSTAL_CODE.test(point.address.postal_code || '')
      && Number.isSafeInteger(point.id) && point.id > 0 && text(point.carrier_service_point_id, 80)
      && text(point.name, 160) && text(point.address.street, 160) && text(point.address.city, 100)).slice(0, 20).map(point => ({
      id: point.id, carrier: CARRIER, carrier_service_point_id: text(point.carrier_service_point_id, 80),
      name: text(point.name, 160), type: ['servicepoint', 'locker'].includes(point.general_shop_type) ? point.general_shop_type : null,
      address: {
        street: text(point.address.street, 160), house_number: text(point.address.house_number, 20),
        postal_code: point.address.postal_code, city: text(point.address.city, 100), country_code: 'FR'
      },
      distance: Number.isFinite(point.distance) && point.distance >= 0 ? Math.round(point.distance) : null
    }));
    return { points, geocoding_status: ['matched', 'partially_matched', 'not_found'].includes(data.geocoding?.status) ? data.geocoding.status : null };
  }

  return { diagnostics, servicePoints };
}

async function adminSendcloud(action, body) {
  try {
    const client = createClient();
    if (action === 'sendcloudDiagnostics') return json(200, { sendcloud: await client.diagnostics() });
    if (action === 'searchSendcloudServicePoints') return json(200, await client.servicePoints(body));
    return json(400, { error: 'Action Sendcloud inconnue.' });
  } catch (error) {
    const safe = safeError(error);
    return json(safe.statusCode, { code: safe.code, error: safe.message });
  }
}

module.exports = { createClient, adminSendcloud };
