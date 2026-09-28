/**
 * /api/admin/* - Admin API for Hanna & Nour.
 *
 * Authentication: POST { action: "login", password } returns a signed token;
 * every other action must send `Authorization: Bearer <token>` (or ?token=).
 * All data access goes through the Supabase service_role key.
 *
* Actions:
 *   login              { password }                                -> { token }
 *   forgotPassword     { email }                                   -> { ok } (emails a 6-digit OTP)
 *   applyReset         { otp, password }                           -> { ok }
 *   listProducts       {}                                          -> { products }
 *   saveProduct        { product, variants? }                      -> { product }
 *   deleteProduct      { id }                                      -> { ok }
 *   uploadImage        { name, mime, data_base64 }                 -> { url }
 *   listOrders         { status?, shipping_status? }                   -> { orders }
 *   getOrder           { id }                                      -> { order }
 *   updateOrder        { id, tracking_number?, shipping_status?, delivery_type?, pickup_point? } -> { ok }
 *   getSettings        {}                                          -> { settings, catalog }
 *   saveSettings       { shipping, catalog? }                       -> { ok }
 *   listMessages       {}                                          -> { messages }
 *   deleteMessage      { id }                                      -> { ok }
 */
const { json, getSupabase, isConfigured, readBody, CORS_HEADERS, sendEmail,
  signToken, verifyToken, requireAdmin, getSetting, saveSetting, defaultCatalog, intEnv, floatEnv,
  hashAdminPassword, checkAdminCredentials } = require('./shared');

const crypto = require('crypto');
const Stripe = require('stripe');

const STRIPE = () => new Stripe(process.env.STRIPE_SECRET_KEY || '');

const ADMIN_RESET_TTL_MS = 15 * 60 * 1000;
const ADMIN_RESET_COOLDOWN_MS = 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

// Reception address for the admin reset code. Falls back to the owner's
// Resend-verified inbox until a brand address is configured later.
function adminResetEmail() {
  return process.env.ADMIN_EMAIL || process.env.CONTACT_EMAIL || 'yassinaous92@gmail.com';
}

function otpHash(otp) {
  return crypto.createHash('sha256').update('admin-otp:' + otp).digest('hex');
}

// Sends the reset OTP. Never reveals whether the address is the admin's.
async function handleForgotPassword(sb, body) {
  const email = String(body.email || '').toLowerCase().trim();
  if (email !== adminResetEmail().toLowerCase()) {
    return json(200, { ok: true });
  }
  const auth = (await getSetting(sb, 'admin_auth', null)) || {};
  // Throttle: at most one reset code every 60s to avoid flooding the inbox.
  if (auth.reset_sent_at && Date.now() - auth.reset_sent_at < ADMIN_RESET_COOLDOWN_MS) {
    return json(200, { ok: true });
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  await saveSetting(sb, 'admin_auth', Object.assign({}, auth, {
    reset_otp_hash: otpHash(otp),
    reset_otp_exp: Date.now() + ADMIN_RESET_TTL_MS,
    reset_otp_attempts: 0,
    reset_sent_at: Date.now()
  }));
  if (!process.env.RESEND_API_KEY) {
    console.log('[admin reset] RESEND_API_KEY not set; OTP=' + otp + ' for ' + adminResetEmail());
    return json(200, { ok: true });
  }
  try {
    await sendEmail({
      to: adminResetEmail(),
      subject: 'Hanna & Nour - R\u00e9initialisation du mot de passe admin',
      html: '<h2 style="font-family:Georgia,serif;color:#B78A4A;">Hanna &amp; Nour</h2>'
        + '<p>Vous avez demand\u00e9 la r\u00e9initialisation du mot de passe d\u2019administration du site.</p>'
        + '<p>Votre code de v\u00e9rification :</p>'
        + '<p style="font-size:26px;font-weight:700;letter-spacing:4px;">' + otp + '</p>'
        + '<p>Ce code expire dans 15 minutes. Saisissez-le sur la page <code>/admin</code> avec votre nouveau mot de passe.</p>'
        + '<p>Si vous n\u2019\u00eates pas \u00e0 l\u2019origine de cette demande, ignorez cet email.</p>'
    });
  } catch (err) {
    console.error('[admin reset] email error:', err);
    return json(502, { error: 'send_failed', detail: String(err.message || err) });
  }
  return json(200, { ok: true });
}

// Validates the OTP and writes the new password hash.
async function handleApplyReset(sb, body) {
  const otp = String(body.otp || '').replace(/\D/g, '');
  const password = String(body.password || '');
  if (otp.length !== 6) return json(400, { error: 'Code invalide' });
  if (password.length < 6) return json(400, { error: 'Le mot de passe doit contenir au moins 6 caract\u00e8res' });
  const auth = (await getSetting(sb, 'admin_auth', null)) || {};
  if (!auth.reset_otp_hash || typeof auth.reset_otp_exp !== 'number') {
    return json(400, { error: 'Aucune demande de r\u00e9initialisation en cours' });
  }
  if (Date.now() > auth.reset_otp_exp) {
    return json(400, { error: 'Code expir\u00e9. Relancez une demande.' });
  }
  const attempt = (auth.reset_otp_attempts || 0) + 1;
  const a = Buffer.from(auth.reset_otp_hash);
  const b = Buffer.from(otpHash(otp));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) {
    if (attempt >= MAX_RESET_ATTEMPTS) {
      await saveSetting(sb, 'admin_auth', Object.assign({}, auth, {
        reset_otp_hash: null, reset_otp_exp: null, reset_otp_attempts: 0
      }));
      return json(400, { error: 'Trop de tentatives. Relancez une demande.' });
    }
    await saveSetting(sb, 'admin_auth', Object.assign({}, auth, { reset_otp_attempts: attempt }));
    return json(400, { error: 'Code incorrect' });
  }
  await saveSetting(sb, 'admin_auth', Object.assign({}, auth, {
    password_hash: hashAdminPassword(password),
    reset_otp_hash: null,
    reset_otp_exp: null,
    reset_otp_attempts: 0
  }));
  return json(200, { ok: true });
}

async function ensureBucket(sb) {
  const { error } = await sb.storage.getBucket('product-images');
  if (error) {
    await sb.storage.createBucket('product-images', { public: true });
  }
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product';
}

function strArr(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return (String(v == null ? '' : v).split(',').map((x) => x.trim()).filter(Boolean));
}

function cleanProductFields(body) {
  const p = {};
  const map = {
    name_en: 'name_en', name_fr: 'name_fr', name_ar: 'name_ar',
    description_en: 'description_en', description_fr: 'description_fr', description_ar: 'description_ar',
    fabric_comp_en: 'fabric_comp_en', fabric_comp_fr: 'fabric_comp_fr', fabric_comp_ar: 'fabric_comp_ar'
  };
  Object.keys(map).forEach((k) => {
    p[map[k]] = String(body[map[k]] == null ? '' : body[map[k]]).trim();
  });

  const names = ['description_en', 'description_fr', 'description_ar'];
  names.forEach((k) => { if (!p[k]) p[k] = p.description_en || ''; });

  p.features_en = strArr(body.features_en);
  p.features_fr = strArr(body.features_fr || body.features_en);
  p.features_ar = strArr(body.features_ar || body.features_en);
  p.care_en = strArr(body.care_en);
  p.care_fr = strArr(body.care_fr || body.care_en);
  p.care_ar = strArr(body.care_ar || body.care_en);
  p.fabrics = strArr(body.fabrics);
  p.occasions = strArr(body.occasions);
  p.colors = strArr(body.colors);
  p.sizes = strArr(body.sizes);

  p.price_cents = Math.max(1, parseInt(body.price_cents, 10) || 0);
  p.compare_at_price_cents = body.compare_at_price_cents != null && body.compare_at_price_cents
    ? Math.max(0, parseInt(body.compare_at_price_cents, 10))
    : null;
  p.category = ['hijab', 'abaya', 'prayer', 'dress', 'accessory'].includes(body.category)
    ? body.category
    : 'hijab';
  p.badge = String(body.badge || '').trim() || null;
  p.is_featured = !!body.is_featured;
  p.is_bestseller = !!body.is_bestseller;
  p.active = body.active !== false;
  p.image = String(body.image || 'images/hero.jpg').trim();
  p.gallery = Array.isArray(body.gallery) ? body.gallery.map(String).filter(Boolean) : [];
  if (!p.gallery.length && p.image) p.gallery = [p.image];
  p.rating = Math.min(5, Math.max(0, parseFloat(body.rating) || 4.5));
  p.review_count = Math.max(0, parseInt(body.review_count, 10) || 0);
  return p;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }

  try {
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }
    const sb = getSupabase();
    const body = readBody(event);
const action = body.action || (event.queryStringParameters && event.queryStringParameters.action);

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    // Unauthenticated reset flow (guarded by the emailed OTP).
    if (action === 'forgotPassword') return handleForgotPassword(sb, body);
    if (action === 'applyReset') return handleApplyReset(sb, body);

    if (action === 'login') {
      const secret = process.env.ADMIN_PASSWORD;
      if (!secret) return json(503, { error: 'ADMIN_PASSWORD is not set on the server' });
      const given = String(body.password || '');
      const match = await checkAdminCredentials(sb, given);
      if (!match) return json(401, { error: 'Mot de passe incorrect' });
      return json(200, { token: signToken(secret) });
    }

    // ---- Everything below requires a valid admin session ----
    const auth = requireAdmin(event);
    if (!auth.ok) return json(401, { error: auth.error || 'Not authorized' });

    switch (action) {
      case 'listProducts': {
        const { data, error } = await sb
          .from('products')
          .select('*, product_variants(id, color, size, stock, active)')
          .order('created_at', { ascending: true });
        if (error) throw error;
        const products = (data || []).map((p) => ({ ...p, variants: p.product_variants || [] }));
        return json(200, { products });
      }

      case 'saveProduct': {
        const id = String(body.id || '').trim();
        const fields = cleanProductFields(body);

        let productId = id || null;
        if (!productId) {
          const slug = slugify(body.slug || body.name_en);
          fields.slug = slug;
          fields.sku = String(body.sku || ('HN-' + slug + '-' + crypto.randomBytes(2).toString('hex').toUpperCase()));
          const { data: inserted, error: insErr } = await sb.from('products').insert(fields).select('id').single();
          if (insErr) throw insErr;
          productId = inserted.id;
} else {
          if (String(body.slug || '').trim()) fields.slug = slugify(body.slug);
          if (String(body.sku || '').trim()) fields.sku = String(body.sku).trim();
          const { error: updErr } = await sb.from('products').update(fields).eq('id', id);
          if (updErr) throw updErr;
        }

        // ---- Replace variants ----
        if (Array.isArray(body.variants)) {
          await sb.from('product_variants').delete().eq('product_id', productId);
          const rows = body.variants
            .map((v) => ({
              product_id: productId,
              color: String(v.color || ''),
              size: String(v.size || ''),
              stock: Math.max(0, parseInt(v.stock, 10) || 0),
              active: v.active !== false
            }));
          if (rows.length) {
            const { error: vErr } = await sb.from('product_variants').insert(rows);
            if (vErr) throw vErr;
          }
        }

        const { data: saved, error: savedErr } = await sb
          .from('products')
          .select('*, product_variants(id, color, size, stock, active)')
          .eq('id', productId)
          .maybeSingle();
        if (savedErr) throw savedErr;
        return json(200, { product: saved ? { ...saved, variants: saved.product_variants || [] } : saved });
      }

      case 'deleteProduct': {
        if (!body.id) return json(400, { error: 'Missing id' });
        await sb.from('reviews').delete().eq('product_id', body.id);
        await sb.from('product_variants').delete().eq('product_id', body.id);
        const { error } = await sb.from('products').delete().eq('id', body.id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case 'uploadImage': {
        const mime = String(body.mime || '');
        const allowed = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
        const ext = allowed[mime];
if (!ext) return json(400, { error: 'Type de fichier non supporté (JPG, PNG ou WEBP)' });

        const b64 = String(body.data_base64 || '').replace(/^data:[^;]+;base64,/, '');
        if (!b64) return json(400, { error: 'Image manquante' });
        // Reject oversized payloads BEFORE decoding (a huge base64 string would
        // otherwise allocate a big buffer just to fail the size check).
        if (b64.length > Math.ceil(4 * 1024 * 1024 * 1.34) + 8) {
          return json(400, { error: 'Image trop lourde (max 4 Mo)' });
        }
        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) return json(400, { error: 'Image vide' });
        // Never trust the client-declared mime: validate the file signature.
        const sig = (n) => buf.slice(0, n).toString('hex');
        const isJpeg = buf.length > 3 && sig(3) === 'ffd8ff';
        const isPng = buf.length > 8 && sig(8) === '89504e470d0a1a0a';
        const isWebp =
          buf.length > 12 &&
          sig(4) === '52494646' /* RIFF */ &&
          buf.toString('ascii', 8, 12) === 'WEBP';
        const detected = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : null;
        if (!detected || (mime && detected !== mime)) {
          return json(400, { error: 'Fichier corrompu ou type non supporté (JPG, PNG ou WEBP)' });
        }
        if (buf.length > 4 * 1024 * 1024) return json(400, { error: 'Image trop lourde (max 4 Mo)' });

        await ensureBucket(sb);
        const safeName = slugify(body.name || 'img').slice(0, 40);
        const path = 'uploads/' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
        const { error: upErr } = await sb.storage.from('product-images').upload(path, buf, { contentType: mime, upsert: true });
        if (upErr) throw upErr;

        const { data: pub } = sb.storage.from('product-images').getPublicUrl(path);
        return json(200, { url: pub.publicUrl });
      }

      case 'listOrders': {
        let q = sb
          .from('orders')
          .select('*, order_items(*)')
          .order('created_at', { ascending: false })
          .limit(200);
        if (body.status) q = q.eq('status', body.status);
        if (body.shipping_status) q = q.eq('shipping_status', body.shipping_status);
        const { data, error } = await q;
        if (error) throw error;
        return json(200, { orders: data || [] });
      }

case 'getOrder': {
        const oid = String(body.id || (event.queryStringParameters && event.queryStringParameters.id) || '').trim();
        if (!oid) return json(400, { error: 'Missing id' });
        const { data, error } = await sb
          .from('orders')
          .select('*, order_items(*)')
          .eq('id', oid)
          .maybeSingle();
        if (error) throw error;
        return json(200, { order: data || null });
      }

      case 'deleteOrder': {
        const oid = String(body.id || '').trim();
        if (!oid) return json(400, { error: 'Missing id' });
        const delItems = await sb.from('order_items').delete().eq('order_id', oid);
        if (delItems.error) throw delItems.error;
        const { error } = await sb.from('orders').delete().eq('id', oid);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case 'updateOrder': {
        if (!body.id) return json(400, { error: 'Missing id' });
        const update = {};
        if (body.tracking_number !== undefined) update.tracking_number = String(body.tracking_number || '').trim() || null;
        if (body.delivery_type !== undefined) update.delivery_type = body.delivery_type === 'pickup' ? 'pickup' : 'home';
        if (body.pickup_point !== undefined) update.pickup_point = String(body.pickup_point || '').trim() || null;

if (body.shipping_status !== undefined) {
          const f = ['new', 'shipped', 'delivered'].includes(body.shipping_status) ? body.shipping_status : 'new';
          update.shipping_status = f;
          if (f === 'shipped' || f === 'delivered') {
            // Preserve the original shipped timestamp if the order already has
            // one; otherwise stamp it now. This avoids overwriting the real
            // dispatch date every time the status is touched.
            let prevShippedAt = null;
            try {
              const { data: existing } = await sb
                .from('orders')
                .select('shipped_at')
                .eq('id', body.id)
                .maybeSingle();
              prevShippedAt = existing && existing.shipped_at;
            } catch (e) { /* keep null */ }
            update.shipped_at = prevShippedAt || new Date().toISOString();
          }
          if (f === 'delivered') {
            update.delivered_at = new Date().toISOString();
          }
          if (f === 'new') { update.shipped_at = null; update.delivered_at = null; }
        }

        const { error } = await sb.from('orders').update(update).eq('id', body.id);
        if (error) throw error;

        // Send "shipped" email to the customer (best-effort).
        if (update.shipping_status === 'shipped') {
          try {
            const { data: ord, error: oErr } = await sb
              .from('orders')
              .select('*, order_items(*)')
              .eq('id', body.id)
              .single();
            if (!oErr && ord && ord.email && ord.status === 'paid') {
              const { sendEmail } = require('./shared');
              const tracking = update.tracking_number || ord.tracking_number;
              const siteUrl = (process.env.SITE_URL || 'https://hannanour.netlify.app').replace(/\/$/, '');
              const html =
                '<div style="background:#f6f1e8;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;' +
                'font-family:Helvetica,Arial,sans-serif;padding:28px;"><h2 style="color:#8a2c2c;font-size:18px;">Votre commande est exp\u00E9di\u00E9e !</h2>' +
                '<p style="font-size:14px;color:#221f1a;">Bonjour ' + esc(ord.customer_name) + ', votre commande <strong>' + esc(ord.order_number) + '</strong> a quitt\u00E9 notre atelier.</p>' +
                (tracking ? '<p style="font-size:14px;color:#221f1a;">Num\u00E9ro de suivi : <strong>' + esc(tracking) + '</strong></p>' : '') +
                '<p style="font-size:14px;color:#221f1a;">Vous pouvez suivre vos commandes sur la page <a href="' + siteUrl + '/account.html" style="color:#7d9b76;">Mon compte</a>.</p>' +
                '<p style="font-size:12px;color:#8a7d66;">Merci de votre confiance.</p></div></div>';
              await sendEmail({
                to: ord.email,
                subject: 'Commande ' + ord.order_number + ' exp\u00E9di\u00E9e \u2014 Hanna & Nour',
                html
              });
            }
          } catch (mailErr) {
            console.error('Shipped email failed:', mailErr.message);
          }
        }

        return json(200, { ok: true, update });
      }

case 'getSettings': {
        const settings = await loadSettings(sb);
        const catalog = await loadCatalog(sb);
        const currency = await getSetting(sb, 'currency', null) || { code: 'usd', symbol: '$' };
        const reviews = (await getSetting(sb, 'reviews', null)) || { show_demo: false };
        const home = await getSetting(sb, 'home', null);
        return json(200, { settings, catalog, currency, reviews, home });
      }

      case 'saveSettings': {
        const shipping = body.shipping || {};
        const value = {
          standard_cents: Math.max(0, parseInt(shipping.standard_cents, 10) || 0),
          express_cents: Math.max(0, parseInt(shipping.express_cents, 10) || 0),
          nextday_cents: Math.max(0, parseInt(shipping.nextday_cents, 10) || 0),
          pickup_cents: Math.max(0, parseInt(shipping.pickup_cents, 10) || 0),
          free_threshold_cents: Math.max(0, parseInt(shipping.free_threshold_cents, 10) || 0),
          tax_rate: Math.max(0, Math.min(1, parseFloat(shipping.tax_rate) || 0)),
          pickup_enabled: shipping.pickup_enabled !== false,
          returns_days: Math.max(7, Math.min(90, parseInt(shipping.returns_days, 10) || 30))
        };
        const { error } = await sb.from('settings').upsert({ key: 'shipping', value, updated_at: new Date().toISOString() });
        if (error) throw error;

        let catalog;
        if (body.catalog) {
          const colors = Array.isArray(body.catalog.colors)
            ? body.catalog.colors.map(String).map((s) => s.trim()).filter(Boolean)
            : [];
          catalog = await saveSetting(sb, 'catalog', { colors });
        }

        let currency;
        if (body.currency) {
          const code = String(body.currency.code || '').toLowerCase();
          if (code === 'usd' || code === 'eur') {
            currency = await saveSetting(sb, 'currency', { code, symbol: code === 'eur' ? '\u20AC' : '$' });
          }
        }

        let reviews;
        if (body.reviews && typeof body.reviews === 'object') {
          reviews = await saveSetting(sb, 'reviews', { show_demo: !!body.reviews.show_demo });
        }

        let home;
        if (body.home && typeof body.home === 'object') {
          home = await saveSetting(sb, 'home', body.home);
        }
        return json(200, { ok: true, settings: value, catalog, currency, reviews, home });
      }

case 'deleteMessage': {
        const id = String(body.id || (event.queryStringParameters && event.queryStringParameters.id) || '').trim();
        if (!id) return json(400, { error: 'Missing id' });
        const { error } = await sb.from('contact_messages').delete().eq('id', id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case 'updateMessage': {
        const id = String(body.id || '').trim();
        if (!id) return json(400, { error: 'Missing id' });
        const fields = {};
        if (typeof body.read === 'boolean') fields.read = body.read;
        if (Object.keys(fields).length === 0) return json(400, { error: 'Nothing to update' });
        const { error } = await sb.from('contact_messages').update(fields).eq('id', id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case 'listMessages': {
        const { data, error } = await sb
          .from('contact_messages')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        return json(200, { messages: data || [] });
      }

      case 'listReviews': {
        const { data, error } = await sb
          .from('reviews')
          .select('*, products(name_en, slug)')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        const reviews = (data || []).map((r) => {
          const { products, ...rest } = r;
          return { ...rest, product: products || null };
        });
        return json(200, { reviews });
      }

      case 'approveReview': {
        const id = String(body.id || '').trim();
        if (!id) return json(400, { error: 'Missing id' });
        const { data: r, error: gErr } = await sb.from('reviews').select('product_id').eq('id', id).maybeSingle();
        if (gErr) throw gErr;
        if (!r) return json(404, { error: 'Review not found' });
        const { error } = await sb.from('reviews').update({ status: 'approved' }).eq('id', id);
        if (error) throw error;
        await recomputeRating(sb, r.product_id);
        return json(200, { ok: true });
      }

      case 'deleteReview': {
        const id = String(body.id || '').trim();
        if (!id) return json(400, { error: 'Missing id' });
        const { data: r, error: gErr } = await sb.from('reviews').select('product_id').eq('id', id).maybeSingle();
        if (gErr) throw gErr;
        if (!r) return json(404, { error: 'Review not found' });
        await sb.from('reviews').delete().eq('id', id);
        await recomputeRating(sb, r.product_id);
        return json(200, { ok: true });
      }

      case 'listDemoReviews': {
        try {
          const { data, error } = await sb
            .from('demo_reviews')
            .select('*')
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
          if (error) throw error;
          return json(200, { reviews: data || [] });
        } catch (err) {
          return json(200, { reviews: [], note: 'Table demo_reviews indisponible' });
        }
      }

      case 'saveDemoReview': {
        const author = String(body.author_name || '').trim();
        const rating = parseInt(body.rating, 10);
        if (!author) return json(400, { error: 'Nom manquant' });
        if (!(rating >= 1 && rating <= 5)) return json(400, { error: 'Note invalide (1-5)' });
        const fields = {
          author_name: author.slice(0, 60),
          rating,
          body: String(body.body || '').trim().slice(0, 1000),
          location: String(body.location || '').trim().slice(0, 120),
          verified: !!body.verified,
          active: body.active !== false,
          sort_order: Math.max(0, parseInt(body.sort_order, 10) || 0),
          updated_at: new Date().toISOString()
        };
        const id = String(body.id || '').trim();
        let saved;
        if (id) {
          const { data, error } = await sb.from('demo_reviews').update(fields).eq('id', id).select().maybeSingle();
          if (error) throw error;
          saved = data;
        } else {
          const { data, error } = await sb.from('demo_reviews').insert(fields).select().maybeSingle();
          if (error) throw error;
          saved = data;
        }
        return json(200, { ok: true, review: saved });
      }

      case 'deleteDemoReview': {
        const id = String(body.id || '').trim();
        if (!id) return json(400, { error: 'Missing id' });
        const { error } = await sb.from('demo_reviews').delete().eq('id', id);
        if (error) throw error;
        return json(200, { ok: true });
      }

      case 'listPromos': {
        const { data, error } = await sb.from('promo_codes').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return json(200, { promos: data || [] });
      }

      case 'savePromo': {
        const code = String(body.code || '').trim().toUpperCase();
        if (!code || code.length > 30) return json(400, { error: 'Code invalide' });
        const percent = parseInt(body.percent_off, 10);
        if (!(percent >= 1 && percent <= 100)) return json(400, { error: 'Pourcentage invalide (1-100)' });
        const original = body.original_code ? String(body.original_code).trim().toUpperCase() : null;
        if (original && original !== code) {
          await sb.from('promo_codes').delete().eq('code', original);
        }
        const fields = {
          code,
          percent_off: percent,
          active: body.active !== false,
          single_use: !!body.single_use,
          expires_at: body.expires_at ? String(body.expires_at) : null
        };
        const { error } = await sb.from('promo_codes').upsert(fields);
        if (error) throw error;
        return json(200, { ok: true, promo: fields });
      }

      case 'deletePromo': {
        const code = String(body.code || '').trim().toUpperCase();
        if (!code) return json(400, { error: 'Missing code' });
        await sb.from('promo_codes').delete().eq('code', code);
        return json(200, { ok: true });
      }

      case 'refundOrder': {
        const oid = String(body.id || '').trim();
        if (!oid) return json(400, { error: 'Missing id' });
        if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: 'Stripe is not configured' });
        const { data: order, error: oErr } = await sb
          .from('orders')
          .select('*, order_items(*)')
          .eq('id', oid)
          .maybeSingle();
        if (oErr) throw oErr;
        if (!order) return json(404, { error: 'Commande introuvable' });
        if (order.status !== 'paid') return json(400, { error: 'Seules les commandes payées peuvent être remboursées' });

        const ref = await stripeRefund(order);
        if (!ref.ok && ref.error !== 'Stripe is not configured') {
          return json(400, { error: ref.error });
        }

        // Guarded update: only a still-paid order may become refunded, so two
        // refunds racing each other cannot double-restock or double-email.
        const { data: refunded, error: updErr } = await sb.from('orders')
          .update({ status: 'refunded' })
          .eq('id', order.id)
          .eq('status', 'paid')
          .select('id');
        if (updErr) throw updErr;
        if (!refunded || refunded.length === 0) {
          return json(200, { ok: true, already: true });
        }

        await restockOrder(sb, order);

        try {
          const { sendEmail } = require('./shared');
          await sendEmail({
            to: order.email,
            subject: 'Remboursement de votre commande ' + order.order_number + ' \u2014 Hanna & Nour',
            html: buildRefundEmail(order)
          });
        } catch (mailErr) {
          console.error('Refund email failed:', mailErr.message);
        }

        return json(200, { ok: true, refunded: ref.ok });
      }

      case 'cancelOrder': {
        const oid = String(body.id || '').trim();
        if (!oid) return json(400, { error: 'Missing id' });
        const reason = ['defective', 'out_of_stock', 'other'].includes(body.reason) ? body.reason : 'other';
        const comment = String(body.comment || '').trim();
        const { data: order, error: oErr } = await sb
          .from('orders')
          .select('*, order_items(*)')
          .eq('id', oid)
          .maybeSingle();
        if (oErr) throw oErr;
        if (!order) return json(404, { error: 'Commande introuvable' });
        if (order.status !== 'paid') return json(400, { error: 'Seules les commandes pay\u00e9es peuvent \u00eatre annul\u00e9es' });

        // Guarded update: two cancels (or a refund race) cannot double-act.
        const { data: cancelled, error: updErr } = await sb.from('orders')
          .update({ status: 'cancelled', cancel_reason: reason === 'other' ? comment : reason, cancelled_at: new Date().toISOString() })
          .eq('id', order.id)
          .eq('status', 'paid')
          .select('id');
        if (updErr) throw updErr;
        if (!cancelled || cancelled.length === 0) {
          return json(200, { ok: true, already: true });
        }

        // Rupture de stock : libère les unités réservées. (Défectueux : en
        // revanche, on ne remet pas l'article en stock.)
        if (reason === 'out_of_stock') await restockOrder(sb, order);

        // Remboursement Stripe automatique (best-effort, non bloquant).
        const ref = await stripeRefund(order);
        if (!ref.ok) console.error('Cancel refund failed:', ref.error);

        try {
          const { sendEmail } = require('./shared');
          await sendEmail({
            to: order.email,
            subject: 'Votre commande ' + order.order_number + ' a \u00e9t\u00e9 annul\u00e9e \u2014 Hanna & Nour',
            html: buildCancelEmail(order, reason, comment, ref.ok)
          });
        } catch (mailErr) {
          console.error('Cancel email failed:', mailErr.message);
        }

        return json(200, { ok: true, refunded: ref.ok });
      }

      case 'analyticsSummary': {
        const day = 24 * 60 * 60 * 1000;
        const summary = {};
        const ranges = { all: 0, d7: 7 * day, d30: 30 * day };
        for (const key of Object.keys(ranges)) {
          let q = sb.from('analytics_events').select('event_type, product_slug');
          if (ranges[key] > 0) q = q.gte('created_at', new Date(Date.now() - ranges[key]).toISOString());
          // Cap huge tables so the summary stays responsive.
          q = q.limit(20000);
          const { data, error } = await q;
          if (error) throw error;
          const counts = { pageview: 0, product_view: 0, add_to_cart: 0, checkout_attempt: 0, purchase: 0 };
          const topBySlug = {};
          for (const e of data || []) {
            if (typeof counts[e.event_type] === 'number') counts[e.event_type]++;
            if (e.event_type === 'product_view' && e.product_slug) topBySlug[e.product_slug] = (topBySlug[e.product_slug] || 0) + 1;
          }
          summary[key] = {
            counts,
            topProducts: Object.keys(topBySlug)
              .sort((a, b) => topBySlug[b] - topBySlug[a])
              .slice(0, 10)
              .map((slug) => ({ slug, views: topBySlug[slug] }))
          };
        }
        const { data: paths, error: pathsErr } = await sb
          .from('analytics_events')
          .select('path')
          .eq('event_type', 'pageview')
          .gte('created_at', new Date(Date.now() - 30 * day).toISOString())
          .limit(2000);
        if (pathsErr) throw pathsErr;
        const byPath = {};
        for (const p of paths || []) {
          const k = p.path || '(vide)';
          byPath[k] = (byPath[k] || 0) + 1;
        }
summary.d30.topPaths = Object.keys(byPath)
          .sort((a, b) => byPath[b] - byPath[a])
          .slice(0, 10)
          .map((path) => ({ path, views: byPath[path] }));
        return json(200, { summary });
      }

      case 'resetStats': {
        if (body.confirm !== true) return json(400, { error: 'Confirmation requise' });
        const { error } = await sb.from('analytics_events').delete().gte('created_at', '1970-01-01T00:00:00+00:00');
        if (error) throw error;
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: 'Unknown action' });
    }
  } catch (err) {
    console.error('admin.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};

async function loadSettings(sb) {
  const row = await getSetting(sb, 'shipping', null);
  if (row) return row;
  return {
    standard_cents: intEnv('SHIPPING_STANDARD_CENTS', 699),
    express_cents: intEnv('SHIPPING_EXPRESS_CENTS', 1200),
    nextday_cents: intEnv('SHIPPING_NEXTDAY_CENTS', 2500),
    pickup_cents: 0,
    free_threshold_cents: intEnv('FREE_SHIPPING_THRESHOLD_CENTS', 7500),
    tax_rate: floatEnv('TAX_RATE', 0.07),
    returns_days: 30,
    pickup_enabled: true
  };
}

async function loadCatalog(sb) {
  const catalog = await getSetting(sb, 'catalog', null);
  if (catalog && Array.isArray(catalog.colors)) return { colors: catalog.colors };
  return defaultCatalog();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Recomputes the product rating/review_count from approved reviews only.
async function recomputeRating(sb, productId) {
  const { data: rows, error } = await sb
    .from('reviews')
    .select('rating')
    .eq('product_id', productId)
    .eq('status', 'approved');
  if (error) throw error;
  const count = rows ? rows.length : 0;
  const sum = rows ? rows.reduce((n, r) => n + r.rating, 0) : 0;
  const rating = count ? Math.round((sum / count) * 10) / 10 : 4.5;
  await sb.from('products').update({ rating, review_count: count }).eq('id', productId);
}

// Full Stripe refund for a paid order. Returns { ok, already, error }.
async function stripeRefund(order) {
  if (!process.env.STRIPE_SECRET_KEY) return { ok: false, error: 'Stripe is not configured' };
  let paymentIntent = null;
  if (order.stripe_session_id) {
    const sess = await STRIPE().checkout.sessions.retrieve(order.stripe_session_id);
    paymentIntent = sess && sess.payment_intent;
  }
  if (!paymentIntent) {
    const pi = await STRIPE().paymentIntents.search({ query: 'metadata["order_id"]:"' + order.id + '"' });
    if (pi && pi.data && pi.data.length) paymentIntent = pi.data[0].id;
  }
  if (!paymentIntent) return { ok: false, error: 'Aucun paiement associ\u00e9 \u00e0 cette commande' };
  try {
    await STRIPE().refunds.create({ payment_intent: paymentIntent });
    return { ok: true };
  } catch (err) {
    if (/already been refunded|anymore/i.test(err.message)) return { ok: true, already: true };
    return { ok: false, error: err.message };
  }
}

// Puts managed-variant stock back after a refund (only for managed products).
async function restockOrder(sb, order) {
  const items = (order.order_items || []).filter((it) => it.variant_id);
  for (const it of items) {
    try {
      await sb.rpc('increment_stock', { p_variant_id: it.variant_id, p_qty: parseInt(it.quantity, 10) || 1 });
    } catch (e) {
      console.error('restock failed for ' + it.variant_id + ':', e.message);
    }
  }
}

function buildRefundEmail(order) {
  const siteUrl = (process.env.SITE_URL || 'https://hannanour.netlify.app').replace(/\/$/, '');
  return '<div style="background:#f6f1e8;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;' +
    'font-family:Helvetica,Arial,sans-serif;padding:28px;"><h2 style="color:#8a2c2c;font-size:18px;">Votre commande a été remboursée</h2>' +
    '<p style="font-size:14px;color:#221f1a;">Bonjour ' + esc(order.customer_name) + ', le remboursement intégral de votre commande ' +
    '<strong>' + esc(order.order_number) + '</strong> a bien été effectué (montant restitué sur votre moyen de paiement).</p>' +
    '<p style="font-size:14px;color:#221f1a;">Si la commande avait déjà été expédiée, vous pouvez la conserver ou la retourner selon nos conditions.</p>' +
    '<p style="font-size:12px;color:#8a7d66;">Merci de votre confiance.</p></div></div>';
}

function buildCancelEmail(order, reason, comment, refunded) {
  const reasons = {
    defective: 'un article de votre commande s\u2019est r\u00e9v\u00e9l\u00e9 d\u00e9fectueux',
    out_of_stock: 'un article de votre commande n\u2019est plus disponible (rupture de stock)',
    other: comment || 'en raison d\u2019une indisponibilit\u00e9 impr\u00e9vue'
  };
  const text = reasons[reason] || reasons.other;
  const refundLine = refunded
    ? 'Le remboursement de votre paiement a d\u00e9j\u00e0 \u00e9t\u00e9 lanc\u00e9 automatiquement.'
    : 'Si un paiement a \u00e9t\u00e9 effectu\u00e9, celui-ci vous sera int\u00e9gralement rembours\u00e9 dans les plus brefs d\u00e9lais.';
  return '<div style="background:#f6f1e8;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;' +
    'font-family:Helvetica,Arial,sans-serif;padding:28px;"><h2 style="color:#8a2c2c;font-size:18px;">Votre commande a \u00e9t\u00e9 annul\u00e9e</h2>' +
    '<p style="font-size:14px;color:#221f1a;">Bonjour ' + esc(order.customer_name) + ',</p>' +
    '<p style="font-size:14px;color:#221f1a;">Nous vous remercions pour votre commande <strong>' + esc(order.order_number) + '</strong>. Nous sommes sinc\u00e8rement navr\u00e9s de devoir vous informer que nous ne sommes malheureusement pas en mesure de la confirmer : ' + esc(text) + '.</p>' +
    '<p style="font-size:14px;color:#221f1a;">' + refundLine + '</p>' +
    '<p style="font-size:14px;color:#221f1a;">Nous vous pr\u00e9sentons nos sinc\u00e8res excuses pour ce d\u00e9sagr\u00e9ment et restons \u00e0 votre disposition pour toute question.</p>' +
    '<p style="font-size:12px;color:#8a7d66;">L\u2019\u00e9quipe Hanna &amp; Nour</p></div></div>';
}
