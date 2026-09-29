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
 *   getOrder           { id }                                      -> { order } (inclut les retours)
 *   updateOrder        { id, tracking_number?, shipping_status?, delivery_type?, pickup_point? } -> { ok }
 *   saleStats          { period?, threshold? }                      -> { totals, products, monthly }
 *   recordReturn       { order_id, order_item_id, quantity, reason?, return_ref } -> { ok, refundCents }
 *   resetStock         {}                                            -> { reset } (toutes les variantes a 0)
 *   exportOrdersCsv    {}                                            -> { ok, filename, csv } (sauvegarde avant effacement)
 *   resetAll           {}                                            -> { ok, deleted_orders } (TOUTES les commandes + stock a 0)
 *   ensureBarcodes     {}                                            -> { generated } (codes manquants)
 *   scanLookup         { barcode }                                   -> { variant, product, stats, pending }
 *   scanSetStock       { variant_id, qty }                           -> { ok, stock }
 *   scanSale           { items, customer_name? }                     -> { ok, order_number, total_cents }
 *   getSettings        {}                                          -> { settings, catalog }
 *   saveSettings       { shipping, catalog? }                       -> { ok }
 *   listMessages       {}                                          -> { messages }
 *   deleteMessage      { id }                                      -> { ok }
 */
const { json, getSupabase, isConfigured, readBody, CORS_HEADERS, sendEmail,
  signToken, verifyToken, requireAdmin, getSetting, saveSetting, defaultCatalog, intEnv, floatEnv,
  hashAdminPassword, checkAdminCredentials, siteUrl } = require('./shared');

const crypto = require('crypto');
const Stripe = require('stripe');

const STRIPE = () => new Stripe(process.env.STRIPE_SECRET_KEY || '');

const ADMIN_RESET_TTL_MS = 15 * 60 * 1000;
const ADMIN_RESET_COOLDOWN_MS = 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

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

// Login with brute-force lockout. Failures are counted in the same `admin_auth`
// settings row as the OTP flow, so the counter is shared across lambda
// instances (unlike in-memory throttling). MAX fails -> temporary lock.
async function handleLogin(sb, body) {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) return json(503, { error: 'ADMIN_PASSWORD is not set on the server' });
  const auth = (await getSetting(sb, 'admin_auth', null)) || {};
  if (auth.login_locked_until && Date.now() < auth.login_locked_until) {
    return json(429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }
  const given = String(body.password || '');
  const match = await checkAdminCredentials(sb, given);
  if (!match) {
    const attempts = (auth.login_attempts || 0) + 1;
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      await saveSetting(sb, 'admin_auth', Object.assign({}, auth, {
        login_attempts: 0,
        login_locked_until: Date.now() + LOGIN_LOCK_MS
      }));
      return json(429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
    }
    await saveSetting(sb, 'admin_auth', Object.assign({}, auth, { login_attempts: attempts }));
    return json(401, { error: 'Mot de passe incorrect' });
  }
  if (auth.login_attempts || auth.login_locked_until) {
    await saveSetting(sb, 'admin_auth', Object.assign({}, auth, {
      login_attempts: 0,
      login_locked_until: null
    }));
  }
  return json(200, { token: signToken(secret) });
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

function cleanBarcode(v) {
  const b = v && typeof v.barcode === 'string' ? v.barcode.trim().toUpperCase() : '';
  return b.slice(0, 40);
}

// Attribue le prochain code-barres HN0000001, ... (compteur dans les réglages).
async function nextBarcode(sb) {
  const cur = await getSetting(sb, 'barcode_seq', 0);
  const n = (typeof cur === 'number' ? cur : parseInt(cur, 10) || 0) + 1;
  await saveSetting(sb, 'barcode_seq', n);
  return 'HN' + String(n).padStart(7, '0');
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

    if (action === 'login') return handleLogin(sb, body);

    // ---- Everything below requires a valid admin session ----
    const auth = requireAdmin(event);
    if (!auth.ok) return json(401, { error: auth.error || 'Not authorized' });

    switch (action) {
      case 'listProducts': {
        const { data, error } = await sb
          .from('products')
          .select('*, product_variants(id, color, size, stock, active, barcode)')
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
        // Chaque variante garde son code-barres s'il est fourni, sinon se voit
        // attribuer automatiquement le prochain code de la séquence HN0000001...
        if (Array.isArray(body.variants)) {
          const rows = [];
          for (const v of body.variants) {
            const row = {
              product_id: productId,
              color: String(v.color || ''),
              size: String(v.size || ''),
              stock: Math.max(0, parseInt(v.stock, 10) || 0),
              active: v.active !== false
            };
            let code = cleanBarcode(v);
            if (!code) code = await nextBarcode(sb);
            row.barcode = code;
            rows.push(row);
          }
          const codes = rows.map((r) => r.barcode);
          const localSeen = {};
          for (const code of codes) {
            if (localSeen[code]) return json(400, { error: 'Code-barres en double dans la grille : ' + code });
            localSeen[code] = true;
          }
          // Collisions avec d'AUTRES produits (les variantes de ce produit vont
          // être remplacées de toute façon). Vérifié AVANT la suppression pour
          // ne jamais laisser un produit sans variantes en cas d'erreur.
          if (codes.length) {
            const { data: dup, error: dupErr } = await sb
              .from('product_variants')
              .select('barcode')
              .in('barcode', codes)
              .neq('product_id', productId);
            if (dupErr) throw dupErr;
            for (const d of dup || []) {
              return json(400, { error: 'Code-barres d\u00e9j\u00e0 utilis\u00e9 par une autre variante : ' + d.barcode });
            }
          }
          await sb.from('product_variants').delete().eq('product_id', productId);
          if (rows.length) {
            const { error: vErr } = await sb.from('product_variants').insert(rows);
            if (vErr) throw vErr;
          }
        }

        const { data: saved, error: savedErr } = await sb
          .from('products')
          .select('*, product_variants(id, color, size, stock, active, barcode)')
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
        if (data) {
          const { data: returns, error: rErr } = await sb
            .from('order_returns')
            .select('*')
            .eq('order_id', oid)
            .order('created_at', { ascending: false });
          if (rErr) throw rErr;
          data.returns = returns || [];
        }
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

        // Envoie un email d'invitation à noter les produits quand la commande
        // est marquée livrée (best-effort). Gardes : commande payée, email réel
        // et compte lié (le formulaire d'avis de la page produit exige un client
        // connecté). review_email_sent_at rend l'envoi idempotent (claim-first).
        if (update.shipping_status === 'delivered') {
          try {
            const { data: ord, error: oErr2 } = await sb
              .from('orders')
              .select('*, order_items(product_name, product_slug, quantity, variant)')
              .eq('id', body.id)
              .single();
            if (!oErr2 && ord && ord.email && ord.user_id && ord.status === 'paid') {
              const claimed = await sb
                .from('orders')
                .update({ review_email_sent_at: new Date().toISOString() })
                .eq('id', ord.id)
                .is('review_email_sent_at', null)
                .select('id');
              if (claimed.error) throw claimed.error;
              if (claimed.data && claimed.data.length) {
                const items = (ord.order_items || []).filter((it) => it.product_slug);
                const links = items.map((it) => {
                  const url = siteUrl + '/product.html?slug=' + encodeURIComponent(it.product_slug);
                  return '<li style="margin:0 0 8px 0;"><a href="' + url + '" style="display:inline-block;background:#8a2c2c;color:#fff;text-decoration:none;border-radius:6px;padding:8px 14px;font-size:13px;">Donner mon avis sur ' + esc(it.product_name || 'ce produit') + '</a></li>';
                }).join('');
                const html =
                  '<div style="background:#f6f1e8;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;' +
                  'font-family:Helvetica,Arial,sans-serif;padding:28px;"><h2 style="color:#8a2c2c;font-size:18px;">Votre commande est livr\u00e9e, merci !</h2>' +
                  '<p style="font-size:14px;color:#221f1a;">Bonjour ' + esc(ord.customer_name) + ', votre commande <strong>' + esc(ord.order_number) + '</strong> est arriv\u00e9e. Votre avis aide d\u2019autres clientes \u00e0 choisir : notez vos articles en quelques \u00e9toiles et quelques mots.</p>' +
                  '<ul style="list-style:none;padding:0;margin:12px 0;">' + links + '</ul>' +
                  '<p style="font-size:14px;color:#221f1a;">Vous pouvez aussi retrouver vos commandes sur la page <a href="' + siteUrl + '/account.html" style="color:#7d9b76;">Mon compte</a>.</p>' +
                  '<p style="font-size:12px;color:#8a7d66;">Merci de votre confiance.</p></div></div>';
                await sendEmail({
                  to: ord.email,
                  subject: 'Votre avis compte \u2014 commande ' + ord.order_number + ' (Hanna & Nour)',
                  html
                });
              }
            }
          } catch (mailErr) {
            console.error('Review invitation email failed:', mailErr.message);
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
        const story = await getSetting(sb, 'story', null);
        return json(200, { settings, catalog, currency, reviews, home, story });
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

        let story;
        if (body.story && typeof body.story === 'object') {
          story = await saveSetting(sb, 'story', body.story);
        }
        return json(200, { ok: true, settings: value, catalog, currency, reviews, home, story });
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

      case 'listPosts': {
        const { data, error } = await sb
          .from('blog_posts')
          .select('*')
          .order('published_at', { ascending: false });
        if (error) throw error;
        return json(200, { posts: data || [] });
      }

      case 'savePost': {
        const title = String(body.title || '').trim();
        if (!title) return json(400, { error: 'Titre manquant' });
        let slug = String(body.slug || '').trim().toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (!slug) {
          slug = title.toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '').slice(0, 60);
        }
        if (!slug) return json(400, { error: 'Slug invalide' });
        const fields = {
          slug,
          title: title.slice(0, 180),
          category: String(body.category || '').trim().slice(0, 60),
          image: String(body.image || '').trim().slice(0, 500),
          excerpt: String(body.excerpt || '').trim().slice(0, 400),
          body: String(body.body || '').trim().slice(0, 20000),
          author: String(body.author || '').trim().slice(0, 80),
          read_minutes: Math.max(1, Math.min(120, parseInt(body.read_minutes, 10) || 5)),
          active: body.active !== false,
          updated_at: new Date().toISOString()
        };
        if (body.published_at) {
          const d = new Date(body.published_at);
          if (!isNaN(d.getTime())) fields.published_at = d.toISOString();
        }
        const id = String(body.id || '').trim();
        if (id) {
          const { data, error } = await sb.from('blog_posts').update(fields).eq('id', id).select().maybeSingle();
          if (error) throw error;
          return json(200, { ok: true, post: data });
        }
        const { data: ins, error: insError } = await sb.from('blog_posts').insert(fields).select().maybeSingle();
        if (insError) throw insError;
        return json(200, { ok: true, post: ins });
      }

      case 'deletePost': {
        const id = String(body.id || '').trim();
        if (!id) return json(400, { error: 'Missing id' });
        const { error } = await sb.from('blog_posts').delete().eq('id', id);
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

      case 'saleStats': {
        const day = 24 * 60 * 60 * 1000;
        const ranges = { d30: 30 * day, d90: 90 * day, y1: 365 * day, all: 0 };
        const range = ranges[body.period] !== undefined ? ranges[body.period] : ranges.d30;
        const since = range > 0 ? new Date(Date.now() - range).toISOString() : null;
        const threshold = Math.max(0, parseInt(body.threshold, 10) || 5);

        const currency = (await getSetting(sb, 'currency', null)) || { code: 'usd', symbol: '$' };

        // Commandes payées (non annulées : un statut 'cancelled'/'refunded' sort
        // de ce filtre) — période sur la date de paiement.
        let oq = sb.from('orders')
          .select('id, order_number, total_cents, subtotal_cents, discount_cents, paid_at, order_items(product_slug, product_name, unit_price_cents, quantity, variant_id)')
          .eq('status', 'paid');
        if (since) oq = oq.gte('paid_at', since);
        oq = oq.order('paid_at', { ascending: true }).limit(5000);
        const { data: orders, error: oErr } = await oq;
        if (oErr) throw oErr;

        let rq = sb.from('order_returns').select('*');
        if (since) rq = rq.gte('created_at', since);
        rq = rq.limit(2000);
        const { data: returns, error: rErr } = await rq;
        if (rErr) throw rErr;

        const { data: products, error: pErr } = await sb
          .from('products')
          .select('slug, name_en, name_fr, image, product_variants(id, color, size, stock, active)');
        if (pErr) throw pErr;

        const productName = {};
        for (const p of products || []) productName[p.slug] = (p.name_fr || p.name_en || p.slug);

        // Série mensuelle : 12 derniers mois (indépendante du filtre de période).
        const monthly = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          monthly.push({
            key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
            label: String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2),
            revenueCents: 0, returnedCents: 0, unitsSold: 0, returnedUnits: 0
          });
        }
        const bucket = (iso) => {
          if (!iso) return null;
          const d = new Date(iso);
          if (isNaN(d.getTime())) return null;
          const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          return monthly.find((m) => m.key === k);
        };

        const totals = { orders: 0, unitsSold: 0, returnedUnits: 0, revenueCents: 0, returnedCents: 0, stockTotal: 0, lowStock: 0, managedProducts: 0 };
        const bySlug = {};

        for (const ord of orders || []) {
          const total = parseInt(ord.total_cents, 10) || 0;
          totals.orders++;
          totals.revenueCents += total;
          const b = bucket(ord.paid_at);
          if (b) b.revenueCents += total;

          // Au prorata de la remise éventuelle pour le CA par produit.
          let factor = 1;
          const sub = parseInt(ord.subtotal_cents, 10) || 0;
          const disc = parseInt(ord.discount_cents, 10) || 0;
          if (sub > 0 && disc > 0) factor = (sub - disc) / sub;

          for (const it of ord.order_items || []) {
            const qty = parseInt(it.quantity, 10) || 0;
            if (qty <= 0 || !it.product_slug) continue;
            const line = Math.round((parseInt(it.unit_price_cents, 10) || 0) * qty * factor);
            const row = bySlug[it.product_slug] || (bySlug[it.product_slug] = {
              slug: it.product_slug, name: productName[it.product_slug] || it.product_name || it.product_slug, image: null,
              sold: 0, returned: 0, revenueCents: 0, returnedCents: 0
            });
            row.sold += qty;
            row.revenueCents += line;
            totals.unitsSold += qty;
            if (b) b.unitsSold += qty;
          }
        }

        for (const r of returns || []) {
          const qty = parseInt(r.quantity, 10) || 0;
          const amt = parseInt(r.total_refund_cents, 10) || 0;
          totals.returnedUnits += qty;
          totals.returnedCents += amt;
          const b = bucket(r.created_at);
          if (b) { b.returnedUnits += qty; b.returnedCents += amt; }
          const row = bySlug[r.product_slug] || (bySlug[r.product_slug] = {
            slug: r.product_slug, name: productName[r.product_slug] || r.product_slug, image: null,
            sold: 0, returned: 0, revenueCents: 0, returnedCents: 0
          });
          row.returned += qty;
          row.returnedCents += amt;
        }

        const productRows = [];
        const seen = {};
        for (const p of products || []) {
          const variants = p.product_variants || [];
          const managed = variants.length > 0;
          const stock = managed ? variants.reduce((n, v) => n + (parseInt(v.stock, 10) || 0), 0) : null;
          const s = bySlug[p.slug];
          if (managed) {
            totals.stockTotal += stock;
            totals.managedProducts++;
            if (stock <= threshold) totals.lowStock++;
          }
          seen[p.slug] = true;
          productRows.push({
            slug: p.slug,
            name: (p.name_fr || p.name_en || p.slug),
            image: p.image || null,
            stock,
            low: managed && stock <= threshold,
            sold: s ? s.sold : 0,
            returned: s ? s.returned : 0,
            revenueCents: s ? s.revenueCents : 0,
            returnedCents: s ? s.returnedCents : 0
          });
        }
        // Ventes de produits supprimés : toujours visibles dans le tableau.
        for (const slug of Object.keys(bySlug)) {
          if (!seen[slug]) {
            const s = bySlug[slug];
            productRows.push({ slug, name: s.name, image: null, stock: null, low: false, sold: s.sold, returned: s.returned, revenueCents: s.revenueCents, returnedCents: s.returnedCents });
          }
        }
        productRows.sort((a, b) => (b.sold + b.returned) - (a.sold + a.returned));

        return json(200, {
          period: body.period || 'd30',
          threshold,
          currency,
          totals: {
            orders: totals.orders,
            unitsSold: totals.unitsSold,
            returnedUnits: totals.returnedUnits,
            netUnits: totals.unitsSold - totals.returnedUnits,
            revenueCents: totals.revenueCents,
            returnedCents: totals.returnedCents,
            netRevenueCents: totals.revenueCents - totals.returnedCents,
            stockTotal: totals.stockTotal,
            lowStock: totals.lowStock,
            managedProducts: totals.managedProducts
          },
          products: productRows,
          monthly
        });
      }

      case 'resetStock': {
        // Action admin volontaire : toutes les variantes repassent à 0.
        // Les commandes existantes (et leur facturation) ne sont pas touchées.
        // Les futures ventes seront bloquées atomiquement (decrement_stock exige stock >= qty).
        const { error } = await sb
          .from('product_variants')
          .update({ stock: 0 })
          .neq('stock', 0);
        if (error) throw error;
        return json(200, { reset: true });
      }

      case 'exportOrdersCsv': {
        // Sauvegarde AVANT effacement : CSV bien organisé pour Excel (FR/EN).
        // 1 ligne = 1 commande ; séparateur « ; » ; décimales « , » ; BOM UTF-8
        // ajouté côté client. Colonne « Articles » : détail complet des lignes.
        const { data: orders, error } = await sb
          .from('orders')
          .select('id, order_number, created_at, paid_at, status, email, customer_name, phone, address1, city, state, postal_code, country, currency, subtotal_cents, shipping_cents, tax_cents, discount_cents, total_cents, shipping_status, delivery_type, pickup_point, order_items(product_name, variant, quantity, unit_price_cents)')
          .order('created_at', { ascending: true })
          .limit(5000);
        if (error) throw error;
        const cell = (v) => {
          const s = v == null ? '' : String(v);
          return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const money = (c) => ((parseInt(c, 10) || 0) / 100).toFixed(2).replace('.', ',');
        const sym = (o) => (o.currency === 'eur' ? '\u20AC' : o.currency === 'usd' ? '$' : (o.currency || '').toUpperCase());
        const STATUS = { pending: 'En attente', paid: 'Pay\u00e9e', abandoned: 'Abandonn\u00e9e', refunded: 'Rembours\u00e9e', cancelled: 'Annul\u00e9e', payment_failed: 'Paiement \u00e9chou\u00e9' };
        const SHIP = { new: '\u00c0 exp\u00e9dier', shipped: 'Exp\u00e9di\u00e9e', delivered: 'Livr\u00e9e' };
        const TYPE = { home: 'Domicile', pickup: 'Retrait' };
        const header = ['N\u00b0 commande', 'Date cr\u00e9ation', 'Pay\u00e9e le', 'Statut', 'Client', 'Email', 'T\u00e9l\u00e9phone', 'Adresse', 'Ville', 'Code postal', 'Pays', 'Devise', 'Sous-total', 'Livraison', 'Taxe', 'Remise', 'Total', 'Exp\u00e9dition', 'Type livraison', 'Point retrait', 'Articles'].join(';');
        const rows = [];
        for (const o of orders || []) {
          const items = o.order_items || [];
          const detail = items.map((it) => {
            const label = !it.variant ? (it.product_name || '') : (it.product_name || '') + ' (' + it.variant + ')';
            return (label || 'Article') + ' x' + it.quantity + ' = ' + money((it.unit_price_cents || 0) * (it.quantity || 0)) + ' ' + sym(o);
          }).join(' ; ');
          rows.push([
            o.order_number, o.created_at, o.paid_at, STATUS[o.status] || o.status, o.customer_name, o.email, o.phone,
            o.address1, o.city, o.postal_code, o.country, o.currency,
            money(o.subtotal_cents), money(o.shipping_cents), money(o.tax_cents), money(o.discount_cents),
            money(o.total_cents), SHIP[o.shipping_status] || o.shipping_status, TYPE[o.delivery_type] || o.delivery_type, o.pickup_point, detail
          ].map(cell).join(';'));
        }
        const orderCount = (orders || []).length;
        const grandTotal = (orders || []).reduce((s, o) => s + (parseInt(o.total_cents, 10) || 0), 0);
        const footer = [];
        for (let i = 0; i < 21; i++) footer.push('');
        footer[0] = 'TOTAL';
        footer[1] = orderCount + ' commande(s)';
        footer[16] = money(grandTotal);
        rows.push(footer.map(cell).join(';'));
        const stamp = new Date().toISOString().slice(0, 10);
        return json(200, { ok: true, filename: 'commandes-hanna-nour-' + stamp + '.csv', csv: header + '\n' + rows.join('\n') + '\n' });
      }

      case 'resetAll': {
        // Tout remettre à zéro (admin volontaire, IRRÉVERSIBLE — l'export CSV
        // est supposé téléchargé avant l'appel) :
        //  1) supprime TOUTES les commandes (order_items et order_returns en
        //     cascade via leurs FK on delete cascade),
        //  2) remet le stock de toutes les variantes à 0.
        // Le CA et les ventes sont recalculés en direct depuis les commandes
        // payées : supprimer les commandes ramène donc ventes, CA et la
        // préparation de commande à zéro.
        const { count, error: cErr } = await sb
          .from('orders')
          .select('*', { count: 'exact', head: true });
        if (cErr) throw cErr;
        const { error: dErr } = await sb
          .from('orders')
          .delete()
          .gte('created_at', '1970-01-01T00:00:00+00:00');
        if (dErr) throw dErr;
        const { error: uErr } = await sb
          .from('product_variants')
          .update({ stock: 0 })
          .neq('stock', 0);
        if (uErr) throw uErr;
        return json(200, { ok: true, deleted_orders: count || 0 });
      }

      case 'ensureBarcodes': {
        // Attribue un code-barres à toute variante qui n'en a pas encore.
        const { data: variants, error: vErr } = await sb
          .from('product_variants')
          .select('id, barcode');
        if (vErr) throw vErr;
        const missing = (variants || []).filter((v) => !v.barcode || !String(v.barcode).trim());
        for (const v of missing) {
          const code = await nextBarcode(sb);
          const { error: upErr } = await sb.from('product_variants').update({ barcode: code }).eq('id', v.id);
          if (upErr) throw upErr;
        }
        return json(200, { generated: missing.length });
      }

      case 'scanLookup': {
        // Fiche d'une variante à partir du code scanné : stock + ventes de
        // CETTE variante (commandes payées, retours déduits) + commandes en
        // attente qui la contiennent (préparation).
        const code = cleanBarcode(body);
        if (!code) return json(400, { error: 'Code barres vide' });
        const currency = (await getSetting(sb, 'currency', null)) || { code: 'usd', symbol: '$' };
        const { data: v, error: vErr } = await sb
          .from('product_variants')
          .select('id, product_id, color, size, stock, active, barcode, products(id, slug, name_en, name_fr, price_cents, image, active)')
          .eq('barcode', code)
          .maybeSingle();
        if (vErr) throw vErr;
        if (!v) return json(404, { error: 'Article introuvable' });
        const prod = v.products || {};

        let sold = 0, revenueCents = 0;
        const { data: items, error: iErr } = await sb
          .from('order_items')
          .select('quantity, unit_price_cents, orders(status)')
          .eq('variant_id', v.id)
          .limit(2000);
        if (iErr) throw iErr;
        for (const it of items || []) {
          if (it.orders && it.orders.status === 'paid') {
            sold += it.quantity;
            revenueCents += it.quantity * (it.unit_price_cents || 0);
          }
        }

        let returned = 0;
        const { data: rets, error: rErr } = await sb
          .from('order_returns')
          .select('quantity, order_items(variant_id)')
          .limit(2000);
        if (rErr) throw rErr;
        for (const rt of rets || []) {
          if (rt.order_items && rt.order_items.variant_id === v.id) returned += rt.quantity;
        }

        const pending = [];
        const { data: pendItems, error: pErr } = await sb
          .from('order_items')
          .select('quantity, orders(order_number, status, shipping_status)')
          .eq('variant_id', v.id)
          .limit(500);
        if (pErr) throw pErr;
        for (const it of pendItems || []) {
          const o = it.orders || {};
          if (o.status === 'paid' && (o.shipping_status === 'new' || o.shipping_status == null)) {
            pending.push({ order_number: o.order_number, quantity: it.quantity });
          }
        }

        return json(200, {
          variant: { id: v.id, product_id: v.product_id, color: v.color, size: v.size, stock: v.stock, active: v.active, barcode: v.barcode },
          product: {
            id: prod.id, slug: prod.slug, name_fr: prod.name_fr, name_en: prod.name_en,
            price_cents: prod.price_cents, image: prod.image, active: prod.active
          },
          stats: { sold, revenueCents, returned },
          pending,
          currency
        });
      }

      case 'scanSetStock': {
        // Comptage réel : remplace le stock d'une variante.
        const vid = String(body.variant_id || '').trim();
        const qty = parseInt(body.qty, 10);
        if (!vid) return json(400, { error: 'variant_id requis' });
        if (!(qty >= 0)) return json(400, { error: 'Quantit\u00e9 invalide' });
        const { data, error } = await sb
          .from('product_variants')
          .update({ stock: qty })
          .eq('id', vid)
          .select('id, stock')
          .maybeSingle();
        if (error) throw error;
        if (!data) return json(404, { error: 'Variante introuvable' });
        return json(200, { ok: true, stock: data.stock });
      }

      case 'scanSale': {
        // Caisse manuelle : l'admin encaisse lui-même et confirme la vente.
        // Crée une commande 'paid' (remise en main propre) et décrémente le
        // stock de façon atomique — si une ligne manque, rien n'est débité.
        const lines = Array.isArray(body.items) ? body.items : [];
        const merged = {};
        for (const li of lines) {
          const vid = String(li.variant_id || '').trim();
          const qty = parseInt(li.qty, 10);
          if (!vid || !(qty >= 1)) return json(400, { error: 'Ligne de vente invalide' });
          merged[vid] = (merged[vid] || 0) + qty;
        }
        const cleaned = Object.keys(merged).map((vid) => ({ variant_id: vid, qty: merged[vid] }));
        if (!cleaned.length) return json(400, { error: 'Panier vide' });

        const { data: variants, error: vErr } = await sb
          .from('product_variants')
          .select('id, product_id, color, size, stock, active, products(id, slug, name_en, name_fr, image, price_cents, active)')
          .in('id', cleaned.map((c) => c.variant_id));
        if (vErr) throw vErr;
        const byId = {};
        for (const v of variants || []) byId[v.id] = v;
        if (cleaned.some((c) => {
          const v = byId[c.variant_id];
          return !v || v.active === false || !v.products || v.products.active === false;
        })) {
          return json(400, { error: 'Article inactif ou introuvable' });
        }

        // Décrément atomique (stock >= qty), tout ou rien.
        const debited = [];
        for (const c of cleaned) {
          const r = await sb.rpc('decrement_stock', { p_variant_id: c.variant_id, p_qty: c.qty });
          if (r.error) throw r.error;
          if (r.data !== true) {
            for (const d of debited) {
              await sb.from('product_variants').update({ stock: d.stock + d.qty }).eq('id', d.variant_id);
            }
            const v = byId[c.variant_id];
            const name = v && v.products ? (v.products.name_fr || v.products.name_en) : c.variant_id;
            return json(400, { error: 'Stock insuffisant pour ' + name });
          }
          debited.push({ variant_id: c.variant_id, qty: c.qty, stock: byId[c.variant_id].stock });
        }

        // Totaux : mêmes sources que l'affichage client (prix produit + taxe).
        const ship = await loadSettings(sb);
        const currency = (await getSetting(sb, 'currency', null)) || { code: 'usd', symbol: '$' };
        const taxRate = typeof ship.tax_rate === 'number' ? ship.tax_rate : 0;
        let subtotal = 0;
        const itemsRows = [];
        for (const c of cleaned) {
          const v = byId[c.variant_id];
          const p = v.products;
          const unit = p.price_cents;
          const variantLabel = [v.color, v.size].filter(Boolean).join(' x ');
          subtotal += unit * c.qty;
          itemsRows.push({
            product_id: p.id,
            product_slug: p.slug,
            product_name: (p.name_fr || p.name_en) + (variantLabel ? ' - ' + variantLabel : ''),
            image: p.image,
            unit_price_cents: unit,
            quantity: c.qty,
            variant_id: v.id,
            variant: variantLabel || null
          });
        }
        const taxCents = taxRate > 0 ? Math.round(subtotal * taxRate) : 0;
        const totalCents = subtotal + taxCents;

        const orderId = crypto.randomUUID();
        const orderNumber = 'HN-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const now = new Date().toISOString();
        const { error: oErr } = await sb.from('orders').insert({
          id: orderId,
          order_number: orderNumber,
          email: 'vente@directe.local',
          customer_name: String(body.customer_name || '').trim().slice(0, 80) || 'Vente directe',
          phone: null,
          address1: 'Vente directe',
          address2: null,
          city: '\u2014',
          state: '\u2014',
          postal_code: '\u2014',
          country: '\u2014',
          shipping_method: 'pickup',
          delivery_type: 'pickup',
          pickup_point: 'Vente directe',
          subtotal_cents: subtotal,
          shipping_cents: 0,
          tax_cents: taxCents,
          discount_cents: 0,
          total_cents: totalCents,
          currency: currency.code,
          status: 'paid',
          paid_at: now,
          created_at: now,
          shipping_status: 'delivered',
          delivered_at: now
        });
        if (oErr) {
          for (const d of debited) {
            await sb.from('product_variants').update({ stock: d.stock + d.qty }).eq('id', d.variant_id);
          }
          throw oErr;
        }
        const insertItems = itemsRows.map((r) => Object.assign({ order_id: orderId }, r));
        const { error: itemsErr } = await sb.from('order_items').insert(insertItems);
        if (itemsErr) {
          await sb.from('orders').delete().eq('id', orderId);
          for (const d of debited) {
            await sb.from('product_variants').update({ stock: d.stock + d.qty }).eq('id', d.variant_id);
          }
          throw itemsErr;
        }
        return json(200, {
          ok: true,
          order_number: orderNumber,
          total_cents: totalCents,
          currency: currency.code,
          symbol: currency.symbol,
          item_count: cleaned.length
        });
      }

      case 'recordReturn': {
        const oid = String(body.order_id || '').trim();
        const itemId = String(body.order_item_id || '').trim();
        const qty = parseInt(body.quantity, 10);
        const reason = String(body.reason || '').trim().slice(0, 200) || 'retour_client';
        const returnRef = String(body.return_ref || '').trim();
        if (!oid || !itemId) return json(400, { error: 'order_id et order_item_id requis' });
        if (!(qty >= 1)) return json(400, { error: 'Quantité invalide' });
        if (!returnRef) return json(400, { error: 'return_ref requis' });

        const { data: order, error: oErr2 } = await sb
          .from('orders')
          .select('*, order_items(*)')
          .eq('id', oid)
          .maybeSingle();
        if (oErr2) throw oErr2;
        if (!order) return json(404, { error: 'Commande introuvable' });
        if (order.status !== 'paid') return json(400, { error: 'Seules les commandes payées peuvent avoir des retours' });

        const item = (order.order_items || []).find((it) => it.id === itemId);
        if (!item) return json(404, { error: 'Ligne de commande introuvable' });

        // Ne jamais dépasser la quantité vendue (retours déjà enregistrés déduits).
        const { data: existingR, error: xErr } = await sb
          .from('order_returns')
          .select('quantity')
          .eq('order_item_id', itemId);
        if (xErr) throw xErr;
        const already = (existingR || []).reduce((n, r) => n + (parseInt(r.quantity, 10) || 0), 0);
        const maxQty = Math.max(0, (parseInt(item.quantity, 10) || 0) - already);
        if (qty > maxQty) {
          return json(400, { error: 'Quantité retournée supérieure au restant vendu (' + maxQty + ')' });
        }

        // Montant recalculé serveur (au prorata de la remise éventuelle).
        let factor = 1;
        const sub2 = parseInt(order.subtotal_cents, 10) || 0;
        const disc2 = parseInt(order.discount_cents, 10) || 0;
        if (sub2 > 0 && disc2 > 0) factor = (sub2 - disc2) / sub2;
        const refundCents = Math.round((parseInt(item.unit_price_cents, 10) || 0) * qty * factor);

        // Idempotent : double envoi du même return_ref => DO NOTHING.
        const { data: inserted, error: insErr } = await sb
          .from('order_returns')
          .upsert({
            return_ref: returnRef,
            order_id: oid,
            order_item_id: itemId,
            product_slug: item.product_slug,
            quantity: qty,
            unit_price_cents: parseInt(item.unit_price_cents, 10) || 0,
            total_refund_cents: refundCents,
            reason
          }, { onConflict: 'return_ref', ignoreDuplicates: true })
          .select('id');
        if (insErr) throw insErr;
        if (!inserted || inserted.length === 0) {
          return json(200, { ok: true, already: true });
        }

        // Restock automatique (variantes gérées uniquement) — même RPC que le refund.
        if (item.variant_id) {
          try {
            const { error: rpcErr } = await sb.rpc('increment_stock', { p_variant_id: item.variant_id, p_qty: qty });
            if (rpcErr) console.error('Return restock failed:', rpcErr.message, item.variant_id);
          } catch (e) {
            console.error('Return restock failed:', e.message);
          }
        }

        return json(200, { ok: true, refundCents });
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
