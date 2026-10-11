const sizes = require('../../../public/js/product-sizes');

async function prepareVariantSizes(sb, productId, incoming) {
  const seen = new Set();
  for (const row of incoming) {
    if (!row || typeof row !== 'object') throw new Error('variant_size_invalid');
    const key = sizes.combination(row.color, row.size);
    if (seen.has(key)) throw new Error('variant_size_duplicate');
    seen.add(key);
  }
  let existing = [];
  if (productId) {
    const { data, error } = await sb.from('product_variants').select('id,color,size,stock,active,barcode').eq('product_id', productId);
    if (error || !Array.isArray(data)) throw new Error('variant_size_read_failed');
    existing = data;
  }
  return incoming.map(row => {
    const target = sizes.find(existing, row.color, row.size);
    // Use the original raw combination to update its existing row. Only new
    // combinations receive the canonical size; history IDs never move.
    if (target) {
      const conflicting = existing.filter(value => value.id !== target.id && value.active !== false && sizes.matches(value, row.color, row.size));
      if (conflicting.length) throw new Error('variant_size_conflict');
    }
    return { ...row, color: target ? target.color : String(row.color || '').trim(), size: target ? target.size : sizes.canonical(row.size), barcode: row.barcode || (target && target.barcode) || '' };
  });
}
module.exports = { prepareVariantSizes };
