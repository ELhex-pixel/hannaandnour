const { json, getSupabase, isConfigured, readBody, getBearer, requireUser, rateLimit, getSetting, CORS_HEADERS } = require('./shared');
const { randomUUID } = require('node:crypto');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS };
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'Method not allowed' });
  if (!isConfigured()) return json(503, { error: 'temporarily_unavailable' });
  try {
    const sb = getSupabase();
    const auth = await requireUser(sb, getBearer(event));
    if (!auth.ok) return json(401, { error: 'Not authenticated' });
    const limited = await rateLimit(sb, event, 'returns', 30, 600, auth.user.id);
    if (limited) return limited;
    if (event.httpMethod === 'GET') {
      const { data, error } = await sb.from('return_requests').select('id, order_id, order_item_id, quantity, reason, status, created_at').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { requests: data || [] });
    }
    const body = readBody(event);
    if (body.operation_id !== undefined && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.operation_id)) return json(400, { error: 'Invalid return operation' });
    let photo = null;
    if (body.photo_base64) {
      try { photo = require('./lib/images').decodeImage(body.photo_base64, 2 * 1024 * 1024); }
      catch (error) { return json(400, { error: error.message }); }
    }
    const shipping = await getSetting(sb, 'shipping', {});
    const days = Number.isInteger(shipping.returns_days) ? Math.min(365, Math.max(0, shipping.returns_days)) : 30;
    const { data, error } = await sb.rpc('request_return_with_operation', { p_user_id: auth.user.id, p_order_id: body.order_id, p_item_id: body.order_item_id, p_quantity: Number(body.quantity), p_reason: String(body.reason || '').slice(0, 1000), p_days: days, p_category: body.category || 'withdrawal', p_operation_id: body.operation_id || randomUUID() });
    if (error) return json(409, { error: 'Return unavailable or already requested' });
    if (!data || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.id||'') || !['requested','approved','rejected','received'].includes(data.status)) return json(503, { error: 'Return not confirmed' });
    let evidenceSaved = !photo || data.evidence_saved === true;
    if (photo && !evidenceSaved) {
      try {
        const { data: bucket } = await sb.storage.getBucket('return-evidence');
        if (!bucket) {
          const { error: bucketError } = await sb.storage.createBucket('return-evidence', { public: false, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] });
          if (bucketError && bucketError.statusCode !== '409') throw bucketError;
        } else if (bucket.public) throw new Error('Return evidence bucket must be private');
        const path = auth.user.id + '/' + data.id + photo.ext;
        const { error: uploadError } = await sb.storage.from('return-evidence').upload(path, photo.data, { contentType: photo.mime, upsert: false });
        if (uploadError && !(data.already === true && String(uploadError.statusCode || uploadError.status)==='409')) throw uploadError;
        const { error: updateError } = await sb.from('return_requests').update({ evidence_paths: [path] }).eq('id', data.id).eq('user_id', auth.user.id);
        if (updateError) throw updateError;
        evidenceSaved = true;
      } catch (error) { console.error('Return evidence upload failed'); }
    }
    return json(201, { id: data.id, status: data.status, already: data.already === true, evidence_saved: evidenceSaved });
  } catch (error) { return json(500, { error: 'Returns temporarily unavailable' }); }
};
