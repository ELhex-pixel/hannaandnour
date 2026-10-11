const { json } = require('../shared');
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const sampleLimit = 3;

async function counted(query) {
  const result = await query.limit(sampleLimit).abortSignal(AbortSignal.timeout(5000));
  if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || result.count < result.data.length) throw new Error('Unconfirmed diagnostic');
  return result;
}

async function productDeletionInfo(sb, id) {
  const { data: product, error } = await sb.from('products').select('id,name_fr,name_en,slug,sku,active').eq('id', id).maybeSingle().abortSignal(AbortSignal.timeout(5000));
  if (error) throw error;
  if (!product) return { id, missing: true, product: null, reasons: [], eligible: false };
  if (product.id !== id || typeof product.slug !== 'string' || typeof product.active !== 'boolean') throw new Error('Unconfirmed product');
  const slug = JSON.stringify(product.slug);
  const otherProduct = `or(product_id.neq.${id},product_id.is.null)`;
  const otherSlug = `or(product_slug.neq.${slug},product_slug.is.null)`;
  const orderFields = 'id,order_id,quantity,orders!order_items_order_id_fkey(id,order_number,status,created_at)';
  // Disjoint predicates mirror all three legacy links in purge_unused_products:
  // product ID, slug, or variant ID. A line is counted only once, even if it
  // matches several links. Explicit FK names avoid the duplicate history FKs.
  const queries = [
    counted(sb.from('order_items').select(orderFields, { count: 'exact' }).eq('product_id', id).order('id')),
    counted(sb.from('order_items').select(orderFields, { count: 'exact' }).eq('product_slug', product.slug).or(otherProduct).order('id')),
    counted(sb.from('order_items').select(orderFields + ',matched_variant:product_variants!order_items_variant_history_fk!inner(product_id)', { count: 'exact' }).eq('matched_variant.product_id', id).or(`and(${otherProduct},${otherSlug})`).order('id')),
    counted(sb.from('product_variants').select('id,color,size,stock,active', { count: 'exact' }).eq('product_id', id).neq('stock', 0).order('id')),
    counted(sb.from('reviews').select('id,status,rating,created_at', { count: 'exact' }).eq('product_id', id).order('created_at', { ascending: false })),
    counted(sb.from('inventory_adjustments').select('id,variant_id,mode,stock_before,stock_after,reason,color,size,created_at,product_variants!inner(product_id)', { count: 'exact' }).eq('product_variants.product_id', id).order('created_at', { ascending: false })),
    counted(sb.from('variant_costs').select('variant_id,unit_cost_cents,currency,updated_at,product_variants!inner(product_id,color,size)', { count: 'exact' }).eq('product_variants.product_id', id).order('variant_id')),
    counted(sb.from('variant_cost_history').select('id,variant_id,unit_cost_cents,currency,reason,created_at,product_variants!inner(product_id,color,size)', { count: 'exact' }).eq('product_variants.product_id', id).order('created_at', { ascending: false }))
  ];
  const [byProduct, bySlug, byVariant, stock, reviews, adjustments, costs, costHistory] = await Promise.all(queries);
  const reasons = [];
  if (product.active) reasons.push({ kind: 'visibility', count: 1, samples: [] });
  function add(kind, result, sample) {
    if (result.count) reasons.push({ kind, count: result.count, samples: result.data.slice(0, sampleLimit).map(sample) });
  }
  add('stock', stock, row => ({ id: row.id, color: row.color, size: row.size, stock: row.stock, active: row.active }));
  add('orders', { count: byProduct.count + bySlug.count + byVariant.count, data: [...byProduct.data, ...bySlug.data, ...byVariant.data] }, row => ({ id: row.id, order_id: row.order_id, quantity: row.quantity, order_number: row.orders?.order_number || row.order_id, status: row.orders?.status || '', created_at: row.orders?.created_at || null }));
  add('reviews', reviews, row => ({ id: row.id, status: row.status, rating: row.rating, created_at: row.created_at }));
  add('adjustments', adjustments, row => ({ id: row.id, variant_id: row.variant_id, color: row.color, size: row.size, mode: row.mode, stock_before: row.stock_before, stock_after: row.stock_after, reason: row.reason, created_at: row.created_at }));
  const costSample = row => ({ id: row.id || row.variant_id, variant_id: row.variant_id, color: row.product_variants?.color || '', size: row.product_variants?.size || '', unit_cost_cents: row.unit_cost_cents, currency: row.currency, reason: row.reason || '', created_at: row.created_at || row.updated_at });
  add('costs', costs, costSample);
  add('cost_history', costHistory, costSample);
  return { id, missing: false, product: { id, name: product.name_fr || product.name_en || product.slug, sku: product.sku || '', slug: product.slug }, reasons, eligible: reasons.length === 0, checked_at: new Date().toISOString() };
}

async function adminProductDeletionInfo(sb, body) {
  if (!body || typeof body.id !== 'string' || !uuid.test(body.id)) return json(400, { error: 'Identifiant de produit invalide.' });
  try { return json(200, await productDeletionInfo(sb, body.id)); }
  catch (error) { return json(503, { error: 'Diagnostic non confirmé : impossible de vérifier tous les liens. Actualisez pour réessayer.' }); }
}

module.exports = { adminProductDeletionInfo, productDeletionInfo };
