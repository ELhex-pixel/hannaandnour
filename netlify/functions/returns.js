const { json, getSupabase, isConfigured, readBody, getBearer, requireUser, rateLimit, getSetting, CORS_HEADERS } = require('./shared');

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
    let photo = null;
    if (body.photo_base64) {
      try { photo = require('./lib/images').decodeImage(body.photo_base64, 2 * 1024 * 1024); }
      catch (error) { return json(400, { error: error.message }); }
    }
    const shipping = await getSetting(sb, 'shipping', {});
    const days = Number.isInteger(shipping.returns_days) ? Math.min(365, Math.max(0, shipping.returns_days)) : 30;
    const { data, error } = await sb.rpc('request_return', { p_user_id: auth.user.id, p_order_id: body.order_id, p_item_id: body.order_item_id, p_quantity: Number(body.quantity), p_reason: String(body.reason || '').slice(0, 1000), p_days: days, p_category: body.category || 'withdrawal' });
    if (error) return json(409, { error: 'Return unavailable or already requested' });
    let evidenceSaved = !photo;
    if (photo) {
      try {
        const { data: bucket } = await sb.storage.getBucket('return-evidence');
        if (!bucket) {
          const { error: bucketError } = await sb.storage.createBucket('return-evidence', { public: false, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] });
          if (bucketError && bucketError.statusCode !== '409') throw bucketError;
        } else if (bucket.public) throw new Error('Return evidence bucket must be private');
        const path = auth.user.id + '/' + data + photo.ext;
        const { error: uploadError } = await sb.storage.from('return-evidence').upload(path, photo.data, { contentType: photo.mime, upsert: false });
        if (uploadError) throw uploadError;
        const { error: updateError } = await sb.from('return_requests').update({ evidence_paths: [path] }).eq('id', data).eq('user_id', auth.user.id);
        if (updateError) throw updateError;
        evidenceSaved = true;
      } catch (error) { console.error('Return evidence upload failed'); }
    }
    return json(201, { id: data, status: 'requested', evidence_saved: evidenceSaved });
  } catch (error) { return json(500, { error: 'Returns temporarily unavailable' }); }
};
