const rules = require('../../../public/js/commerce');
const { intEnv, floatEnv } = require('../shared');

async function settings(sb) {
  const { data, error } = await sb.from('settings').select('key, value').in('key', ['shipping', 'currency']);
  if (error) throw error;
  const shipping = (data || []).find(row => row.key === 'shipping')?.value || {};
  const currency = (data || []).find(row => row.key === 'currency')?.value || {};
  const code = ['eur', 'usd'].includes(currency.code) ? currency.code : process.env.STRIPE_PRICE_CURRENCY === 'eur' ? 'eur' : 'usd';
  return {
    shipping: Object.assign({}, rules.defaults, {
      standard_cents: intEnv('SHIPPING_STANDARD_CENTS', 699), express_cents: intEnv('SHIPPING_EXPRESS_CENTS', 1200),
      nextday_cents: intEnv('SHIPPING_NEXTDAY_CENTS', 2500), free_threshold_cents: intEnv('FREE_SHIPPING_THRESHOLD_CENTS', 7500), tax_rate: floatEnv('TAX_RATE', 0.07)
    }, shipping),
    currency: { code, symbol: code === 'eur' ? '€' : '$' }
  };
}

async function quote(sb, body) {
  const items = rules.normalize(body.items);
  const config = await settings(sb);
  const { data: products, error } = await sb.from('products').select('id, slug, name_en, name_fr, name_ar, image, price_cents, active').in('slug', items.map(i => i.slug)).eq('active', true);
  if (error) throw error;
  const { data: variants, error: vErr } = await sb.from('product_variants').select('id, product_id, color, size, stock, active').in('product_id', (products || []).map(p => p.id));
  if (vErr) throw vErr;
  const resolved = items.map(item => {
    const product = (products || []).find(p => p.slug === item.slug);
    if (!product) throw new Error('Product unavailable');
    const managed = (variants || []).filter(v => v.product_id === product.id);
    const variant = managed.find(v => String(v.color).toLowerCase() === item.color.toLowerCase() && String(v.size).toLowerCase() === item.size.toLowerCase());
    if (managed.length && (!variant || !variant.active || variant.stock < item.qty)) throw new Error('Stock unavailable');
    return { ...item, product, variantId: variant ? variant.id : null, price_cents: product.price_cents };
  });
  let promo = null;
  if (body.promo) {
    const { data, error: pErr } = await sb.from('promo_codes').select('code, percent_off, active, expires_at, single_use, used_count').eq('code', String(body.promo).trim().toUpperCase().slice(0, 60)).maybeSingle();
    if (pErr) throw pErr;
    if (!data || !data.active || (data.expires_at && new Date(data.expires_at) <= new Date()) || (data.single_use && data.used_count > 0)) throw new Error('Invalid promo code');
    promo = data;
  }
  const method = body.shipping_method || 'standard';
  const totals = rules.calculate(resolved, config.shipping, method, promo ? promo.percent_off : 0);
  return { items: resolved, totals, currency: config.currency, promo, method };
}

function publicQuote(value) {
  return { totals: value.totals, currency: value.currency, items: value.items.map(i => ({ slug: i.slug, color: i.color, size: i.size, qty: i.qty, price_cents: i.price_cents, image: i.product.image, name: i.product.name_en, name_en: i.product.name_en, name_fr: i.product.name_fr, name_ar: i.product.name_ar, variantId: i.variantId })) };
}

module.exports = { ...rules, settings, quote, publicQuote };
