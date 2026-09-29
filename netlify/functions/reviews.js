/**
 * Reviews
 * GET  /api/reviews?product=<slug>   -> approved reviews + product aggregate
 * GET  /api/reviews?demo=true        -> active admin-managed demo reviews
 * POST /api/reviews                   -> submit a review (stored as pending)
 *   Body: { product: "<slug>", rating (1-5), body }
 * POST /api/reviews                   -> guest order proof (no insert)
 *   Body: { action: "check", product, order_number, email }
 *
 * POST is restricted to customers whose paid order for that product has been
 * delivered (shipping_status = 'delivered'):
 *   - Account customers authenticate with a Bearer token (orders matched by
 *     user_id, and guest orders placed with the same email).
 *   - Guests prove their purchase with { order_number, email } (one review per
 *     order via reviews.order_id).
 * Every review lands in `pending` and is published only after admin approval.
 */
const { json, getSupabase, isConfigured, readBody, getBearer, requireUser } = require('./shared');

// Vérifie qu'une commande livrée contenant le produit correspond au couple
// (numéro de commande, e-mail). Retourne { order } ou { error }.
async function findGuestOrder(sb, slug, orderNumber, email) {
  const orderRef = String(orderNumber || '').trim();
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!orderRef || !emailNorm) return { error: 'missing' };

  const { data: ord, error } = await sb
    .from('orders')
    .select('id, email, customer_name, status, shipping_status, order_items(product_slug)')
    .eq('order_number', orderRef)
    .single();
  if (error || !ord) return { error: 'not_found' };
  if (String(ord.email || '').toLowerCase() !== emailNorm) return { error: 'not_found' };
  if (ord.status !== 'paid' || ord.shipping_status !== 'delivered') return { error: 'not_eligible' };
  const hasItem = Array.isArray(ord.order_items) &&
    ord.order_items.some((it) => it.product_slug === slug);
  if (!hasItem) return { error: 'not_eligible' };
  return { order: ord };
}

// Insertion d'un avis invité (sans compte connecté). Le nom et la preuve
// d'achat viennent de la commande, jamais du formulaire.
async function guestCreate(sb, body, slug, rating, text) {
  const { data: product, error: prodError } = await sb
    .from('products')
    .select('id, slug')
    .eq('slug', slug)
    .eq('active', true)
    .single();
  if (prodError) return json(404, { error: 'Product not found' });

  const found = await findGuestOrder(sb, slug, body.order_number, body.email);
  if (found.error) {
    const map = found.error === 'missing' ? 400 : 403;
    return json(map, { error: found.error });
  }

  // Anti-doublon : un seul avis par commande.
  const { data: existing, error: dupErr } = await sb
    .from('reviews')
    .select('id')
    .eq('order_id', found.order.id)
    .limit(1);
  if (dupErr) throw dupErr;
  if (existing && existing.length) return json(409, { error: 'already_reviewed' });

  const { error: insertError } = await sb
    .from('reviews')
    .insert({
      product_id: product.id,
      author_name: String(found.order.customer_name || 'Cliente').slice(0, 60),
      rating,
      body: text.slice(0, 1000),
      status: 'pending',
      order_id: found.order.id
    });
  if (insertError) throw insertError;

  // Do NOT touch the aggregate here: only approved reviews count towards
  // rating / review_count (recomputed in admin.js when a review is
  // approved). Counting pending reviews would inflate ratings.
  return json(201, { ok: true, pending: true });
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

    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};

      if (q.demo === 'true') {
        // Admin-managed demo reviews (global, used by the product page and the
        // home testimonials section when the illustration is enabled).
        try {
          const { data: demo, error: demoError } = await sb
            .from('demo_reviews')
            .select('id, author_name, rating, body, location, verified')
            .eq('active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
          if (demoError) throw demoError;
          return json(200, { reviews: demo || [] });
        } catch (demoErr) {
          // Migration not applied yet: treat as "no demo reviews" instead of 500.
          return json(200, { reviews: [] });
        }
      }

      const slug = q.product;
      if (!slug) return json(400, { error: 'Missing product slug' });

      const { data: product, error: prodError } = await sb
        .from('products')
        .select('id, slug, rating, review_count')
        .eq('slug', slug)
        .eq('active', true)
        .single();
      if (prodError) return json(404, { error: 'Product not found' });

      const { data: reviews, error: revError } = await sb
        .from('reviews')
        .select('id, author_name, rating, body, created_at')
        .eq('product_id', product.id)
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(20);
      if (revError) throw revError;

      return json(200, {
        product: { slug: product.slug, rating: product.rating, review_count: product.review_count },
        reviews
      });
    }

    if (event.httpMethod === 'POST') {
      const body = readBody(event);

      // Preuve d'achat invité (contrôle sans insertion) : confirme qu'une
      // commande livrée contenant le produit correspond aux infos fournies.
      if (body.action === 'check') {
        const { data: product, error: prodError } = await sb
          .from('products')
          .select('id, slug')
          .eq('slug', String(body.product || '').trim())
          .eq('active', true)
          .single();
        if (prodError) return json(404, { error: 'Product not found' });

        const found = await findGuestOrder(sb, String(body.product || '').trim(), body.order_number, body.email);
        if (found.error) {
          const map = found.error === 'missing' ? 400 : 403;
          return json(map, { error: found.error });
        }
        return json(200, { ok: true, customer_name: found.order.customer_name });
      }

      const slug = String(body.product || '').trim();
      const rating = parseInt(body.rating, 10);
      const text = String(body.body || '').trim();

      if (!slug || !text) return json(400, { error: 'Missing fields' });
      if (!(rating >= 1 && rating <= 5)) return json(400, { error: 'Rating must be between 1 and 5' });

      // Bearer token : client connecté. Sinon, parcours invité (preuve d'achat).
      const auth = await requireUser(sb, getBearer(event));
      if (!auth.ok) {
        return guestCreate(sb, body, slug, rating, text);
      }
      const user = auth.user;

      const { data: product, error: prodError } = await sb
        .from('products')
        .select('id, slug, rating, review_count')
        .eq('slug', slug)
        .eq('active', true)
        .single();
      if (prodError) return json(404, { error: 'Product not found' });

      // Éligibilité : le client doit posséder une commande payée ET livrée
      // contenant ce produit. On inclut les commandes passées en invité avec
      // le même e-mail (le client a pu créer son compte après coup).
      const sel = 'id, status, shipping_status, order_items(*)';
      const [q1, q2] = await Promise.all([
        sb.from('orders').select(sel).eq('user_id', user.id).eq('status', 'paid').eq('shipping_status', 'delivered').limit(100),
        sb.from('orders').select(sel).eq('email', user.email).eq('status', 'paid').eq('shipping_status', 'delivered').limit(100)
      ]);
      if (q1.error) throw q1.error;
      if (q2.error) throw q2.error;
      const orders = [...(q1.data || []), ...(q2.data || [])];
      const eligibleOrder = orders.find((o) =>
        Array.isArray(o.order_items) &&
        o.order_items.some((it) => it.product_slug === slug)
      );
      if (!eligibleOrder) return json(403, { error: 'not_eligible' });

      // Author comes from the account, never from the form.
      const meta = user.user_metadata || {};
      const author = String(meta.first_name || '').trim() || String(user.email || 'Cli-ente').split('@')[0];

      const { error: insertError } = await sb
        .from('reviews')
        .insert({
          product_id: product.id,
          author_name: author.slice(0, 60),
          rating,
          body: text.slice(0, 1000),
          status: 'pending',
          order_id: eligibleOrder.id
        });
      if (insertError) throw insertError;

      return json(201, { ok: true, pending: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('reviews.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};