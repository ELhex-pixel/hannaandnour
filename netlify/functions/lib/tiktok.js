const { json, saveSetting, siteUrl } = require('../shared');
const commerce = require('./commerce');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ['category', 'parcel_weight', 'parcel_length', 'parcel_width', 'parcel_height', 'manufacturer_ids', 'rp_ids', 'packaging_safety'];

function cleanMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informations TikTok invalides');
  const result = {};
  for (const field of fields) {
    const value = String(input[field] ?? '').trim();
    if (value.length > 1000) throw new Error('Champ TikTok trop long : ' + field);
    result[field] = value;
  }
  if (result.packaging_safety && !['Oui', 'Non'].includes(result.packaging_safety)) throw new Error('Sélectionnez Oui ou Non pour les informations de sécurité');
  for (const field of ['parcel_weight', 'parcel_length', 'parcel_width', 'parcel_height']) {
    if (result[field] && (!Number.isFinite(Number(result[field])) || Number(result[field]) <= 0 || Number(result[field]) > 1000000000)) throw new Error('Mesure de colis invalide : ' + field);
  }
  result.extra = {};
  if (input.extra != null && (typeof input.extra !== 'object' || Array.isArray(input.extra))) throw new Error('Attributs TikTok invalides');
  const entries = Object.entries(input.extra || {});
  if (entries.length > 80) throw new Error('Trop d’attributs TikTok');
  for (const [key, value] of entries) {
    if (!/^(?:product_property\/\d+|qualification\/\d+|size_chart|sku_unit_count|brand)$/.test(key) || typeof value !== 'string' || value.length > 4000) throw new Error('Attribut TikTok invalide : ' + key.slice(0, 80));
    result.extra[key] = value.trim();
  }
  return result;
}

function imageUrl(value) {
  const url = new URL(value, siteUrl + '/');
  if (url.protocol !== 'https:' || url.username || url.password || !/\.(?:jpe?g|png)$/i.test(url.pathname)) throw new Error('Image TikTok : utilisez une URL HTTPS publique JPG ou PNG');
  return url.href;
}

function productRows(product, metadata, config) {
  if (config.currency.code !== 'eur') throw new Error('Export TikTok France : configurez la devise du site en EUR avant l’export. Aucune conversion USD/EUR automatique.');
  const meta = cleanMetadata(metadata);
  if (!meta.category) throw new Error('Catégorie TikTok manquante');
  const name = String(product.name_fr || '').trim();
  const description = String(product.description_fr || '').trim();
  if (!name || name.length > 254 || !description || description.length > 32000) throw new Error('Nom FR (1–254 caractères) et description FR (maximum 32 000 caractères) requis');
  const variants = (product.product_variants || []).filter(v => v.active !== false);
  if (!variants.length) throw new Error('Stock par variante requis : le stock illimité du site ne peut pas être exporté');
  const totals = commerce.calculate([{ price_cents: product.price_cents, qty: 1 }], { ...config.shipping, standard_cents: 0 }, 'standard', 0);
  const price = totals.subtotal + totals.tax;
  if (price < 1 || price > 630000) throw new Error('Prix TTC hors limite TikTok (0,01–6 300 EUR)');
  const images = [product.image, ...(product.gallery || []).filter(url => url !== product.image)].slice(0, 9).map(imageUrl);
  const base = { ...meta.extra, category: meta.category, product_name: name, product_description: description, main_image: images[0], price: price / 100 };
  images.slice(1).forEach((url, i) => { base['image_' + (i + 2)] = url; });
  for (const key of ['parcel_weight', 'parcel_length', 'parcel_width', 'parcel_height']) if (meta[key]) base[key] = Number(meta[key]);
  for (const key of ['manufacturer_ids', 'rp_ids']) if (meta[key]) base[key] = meta[key];
  if (meta.packaging_safety) base['product_property/102277'] = meta.packaging_safety;
  const seen = new Set();
  return variants.map(variant => {
    if (!Number.isInteger(variant.stock) || variant.stock < 0 || variant.stock > 999999) throw new Error('Stock TikTok invalide (0–999 999)');
    const sku = String(variant.barcode || variant.id || '').trim();
    if (!sku || sku.length > 50 || seen.has(sku)) throw new Error('UGS vendeur manquante, dupliquée ou trop longue');
    seen.add(sku);
    const row = { ...base, quantity: product.active === false ? 0 : variant.stock, seller_sku: sku };
    if (variant.color) { row.property_name_1 = 'Couleur'; row.property_value_1 = variant.color; }
    if (variant.size) {
      row[variant.color ? 'property_name_2' : 'property_name_1'] = 'Taille';
      row[variant.color ? 'property_value_2' : 'property_value_1'] = variant.size;
    }
    if (String(variant.color || '').length > 50 || String(variant.size || '').length > 50) throw new Error('Couleur ou taille trop longue (50 caractères maximum)');
    return row;
  });
}

async function metadataFor(sb, ids) {
  const { data, error } = await sb.from('settings').select('key,value').in('key', ids.map(id => 'tiktok:' + id));
  if (error) throw error;
  return Object.fromEntries((data || []).map(row => [row.key.slice(7), row.value]));
}

async function adminTiktok(sb, action, body) {
  if (action === 'exportTiktokProducts') {
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(ids).size !== ids.length) return json(400, { error: 'Sélectionnez entre 1 et 100 produits distincts' });
    const { data, error } = await sb.from('products').select('id,name_fr,description_fr,image,gallery,price_cents,active,product_variants(id,color,size,stock,active,barcode)').in('id', ids);
    if (error) throw error;
    const metadata = await metadataFor(sb, ids);
    const config = await commerce.settings(sb);
    const rows = [], errors = [];
    for (const id of ids) {
      const product = (data || []).find(p => p.id === id);
      try {
        if (!product) throw new Error('Produit introuvable');
        rows.push(...productRows(product, metadata[id] || {}, config));
      } catch (error) { errors.push((product?.name_fr || id) + ' : ' + error.message); }
    }
    if (rows.length > 4994) errors.push('Maximum 4 994 variantes par fichier TikTok');
    if (Buffer.byteLength(JSON.stringify(rows)) > 4 * 1024 * 1024) errors.push('Sélection trop volumineuse pour l’API : exportez moins de produits à la fois');
    if (errors.length) return json(400, { error: errors.join('\n') });
    return json(200, { rows, currency: config.currency.code, tax_rate: config.shipping.tax_rate, generated_at: new Date().toISOString() });
  }
  if (typeof body.id !== 'string' || !uuid.test(body.id)) return json(400, { error: 'Enregistrez d’abord le produit sur le site' });
  const { data: product, error } = await sb.from('products').select('id').eq('id', body.id).maybeSingle();
  if (error) throw error;
  if (!product) return json(404, { error: 'Produit introuvable' });
  if (action === 'saveTiktokMetadata') {
    let metadata;
    try { metadata = cleanMetadata(body.metadata); } catch (error) { return json(400, { error: error.message }); }
    await saveSetting(sb, 'tiktok:' + body.id, metadata);
    return json(200, { metadata });
  }
  return json(200, { metadata: (await metadataFor(sb, [body.id]))[body.id] || {} });
}

module.exports = { adminTiktok, cleanMetadata, productRows };
