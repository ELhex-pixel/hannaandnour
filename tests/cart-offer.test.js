const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const commerce = require('../netlify/functions/lib/commerce');
const { adminCartOffer } = require('../netlify/functions/lib/cart-offer');

function database(offer = { enabled: true, percent_off: 10 }) {
  const state = { offer, shipping: { standard_cents: 699, tax_rate: 0.2 }, writes: [], rpcs: [], reads: [], promo: null, error: null };
  const product = { id: 'fixture', slug: 'veste', name_en: 'Jacket', name_fr: 'Veste', name_ar: 'سترة', image: 'images/hero.jpg', price_cents: 2003, active: true };
  const sb = { from(table) {
    const query = {
      select(fields) { state.reads.push({ table, fields }); return this; }, in() { return this; }, eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: table === 'promo_codes' ? state.promo : { value: state.offer }, error: state.error }); },
      upsert(row) { state.writes.push({ table, row }); state.offer = row.value; return Promise.resolve({ error: state.error }); },
      insert(row) { state.writes.push({ table, row }); return Promise.resolve({ error: state.error }); },
      update(row) { state.writes.push({ table, row }); return this; }, delete() { return this; },
      then(resolve, reject) {
        const data = table === 'settings' ? [{ key: 'shipping', value: state.shipping }, { key: 'currency', value: { code: 'eur' } }, { key: 'cart_offer', value: state.offer }]
          : table === 'products' ? [product] : table === 'product_variants' ? [] : null;
        return Promise.resolve({ data, error: state.error }).then(resolve, reject);
      }
    }; return query;
  }, rpc: async (name, args) => { state.rpcs.push({ name, args }); return { data: true, error: null }; } };
  return { state, sb, product };
}
const items = [{ slug: 'veste', qty: 3 }];

test('la remise surprise reste inactive sans réglage valide et ne s’additionne pas aux codes', () => {
  for (const value of [null, {}, { enabled: true, percent_off: 0 }, { enabled: true, percent_off: 10.5 }, { enabled: true, percent_off: '20' }, { enabled: 'true', percent_off: 20 }, { enabled: true, percent_off: 101 }]) assert.deepEqual(commerce.cartOffer(value), { enabled: false, percent_off: 0 });
  for (const [enabled, automatic, code, kind, percent] of [[true,10,0,'surprise',10],[true,10,5,'surprise',10],[true,10,10,'surprise',10],[true,10,20,'code',20],[false,10,5,'code',5],[false,10,0,null,0]]) {
    assert.deepEqual(commerce.chooseDiscount({ enabled, percent_off: automatic }, code), { kind, percent_off: percent });
  }
});

test('le devis relit la remise serveur et ne réserve un code que si celui-ci est réellement retenu', async () => {
  for (const code of [null, 5, 10, 20]) {
    const mock = database();
    if (code !== null) mock.state.promo = { code: 'LOCAL', percent_off: code, active: true, single_use: true, used_count: 0 };
    const value = await commerce.quote(mock.sb, { items, promo: code === null ? '' : 'LOCAL', cart_offer: { enabled: true, percent_off: 100 }, discount_cents: 6009 });
    const pct = Math.max(10, code || 0);
    assert.equal(value.totals.subtotal, 6009);
    assert.equal(value.totals.discount, Math.round(6009 * pct / 100));
    assert.equal(value.totals.tax, Math.round((6009 - value.totals.discount) * 0.2));
    assert.equal(value.promo === null, code === null || code <= 10);
    assert.equal(commerce.publicQuote(value).discount.kind, code > 10 ? 'code' : 'surprise');
    assert.equal(mock.product.price_cents, 2003);
    assert.equal(mock.state.writes.length, 0);
    assert.equal(mock.state.rpcs.length, 0);
  }
  const expired = database(); expired.state.promo = { code: 'LOCAL', percent_off: 30, active: true, expires_at: '2000-01-01' };
  await assert.rejects(commerce.quote(expired.sb, { items, promo: 'LOCAL' }), /Invalid promo code/);
});

test('l’admin valide le pourcentage, écrit seulement la promotion et filtre les erreurs privées', async () => {
  for (const offer of [{ enabled: true, percent_off: 10 }, { enabled: false, percent_off: 10 }, { enabled: false, percent_off: 0 }, { enabled: true, percent_off: 100 }]) {
    const mock = database();
    const response = await adminCartOffer(mock.sb, 'saveCartOffer', { offer: { ...offer, tax_rate: 0, price_cents: 1 } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(mock.state.writes.map(write => [write.table, write.row.key]), [['settings', 'cart_offer']]);
    assert.deepEqual(mock.state.offer, offer);
    assert.equal(mock.state.shipping.tax_rate, 0.2);
    assert.deepEqual(JSON.parse((await adminCartOffer(mock.sb, 'getCartOffer', {})).body).offer, offer);
  }
  for (const offer of [{}, { enabled: true, percent_off: 0 }, { enabled: true, percent_off: 101 }, { enabled: true, percent_off: -1 }, { enabled: true, percent_off: '10' }, { enabled: true, percent_off: 1.5 }]) {
    const mock = database(); assert.equal((await adminCartOffer(mock.sb, 'saveCartOffer', { offer })).statusCode, 400); assert.equal(mock.state.writes.length, 0);
  }
  for (const action of ['getCartOffer', 'saveCartOffer']) {
    const mock = database(); mock.state.error = new Error('private-database-value');
    const response = await adminCartOffer(mock.sb, action, { offer: { enabled: true, percent_off: 10 } });
    assert.equal(response.statusCode, 503); assert(!response.body.includes('private-database-value'));
  }
});

function payment(mock) {
  const exports = {}, stripeCalls = [];
  class Stripe { constructor() { this.checkout = { sessions: { create: async payload => { stripeCalls.push(payload); return { id: 'cs_test', url: 'https://checkout.stripe.com/local-test' }; }, expire: async () => {} } }; } }
  const shared = { json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }), getSupabase: () => mock.sb, isConfigured: () => true, readBody: event => JSON.parse(event.body), rateLimit: async () => null, getBearer: () => '', siteUrl: 'https://example.test', CORS_HEADERS: {} };
  vm.runInNewContext(fs.readFileSync('netlify/functions/checkout.js', 'utf8'), { exports, process: { env: { STRIPE_SECRET_KEY: 'local-test-only' } }, console: { error() {} }, require: name => name === 'crypto' ? crypto : name === 'stripe' ? Stripe : name === './shared' ? shared : name === './lib/customer-email' ? require('../netlify/functions/lib/customer-email') : commerce });
  return { stripeCalls, run: body => exports.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) }) };
}
test('une offre désactivée ou modifiée impose la confirmation du nouveau total avant tout paiement', async () => {
  const mock = database(), old = await commerce.quote(mock.sb, { items });
  const handler = payment(mock);
  for (const offer of [{ enabled: false, percent_off: 10 }, { enabled: true, percent_off: 20 }]) {
    mock.state.offer = offer;
    const response = await handler.run({ items, expected_total_cents: old.totals.total, expected_currency: 'eur', expected_policy_version: old.return_policy.version });
    assert.equal(response.statusCode, 409);
    assert.equal(JSON.parse(response.body).error, 'quote_changed');
    assert.equal(handler.stripeCalls.length, 0); assert.equal(mock.state.writes.length, 0); assert.equal(mock.state.rpcs.length, 0);
  }
});
test('Stripe et les lignes nettes remboursables reçoivent la remise exacte, avec taxe et port cohérents', async () => {
  const mock = database(), handler = payment(mock), quote = await commerce.quote(mock.sb, { items });
  const response = await handler.run({ items, email: 'client@example.test', customer_name: 'Test', address1: 'Rue test', city: 'Paris', postal_code: '75000', country: 'FR', expected_total_cents: quote.totals.total, expected_currency: 'eur', expected_policy_version: quote.return_policy.version });
  assert.equal(response.statusCode, 200);
  const payload = handler.stripeCalls[0];
  assert.equal(payload.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0) + payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, quote.totals.total);
  const order = mock.state.writes.find(write => write.table === 'orders' && write.row.total_cents).row;
  assert.equal(order.discount_cents, 601); assert.equal(order.promo_code, null);
  const lines = mock.state.writes.find(write => write.table === 'order_items').row;
  assert.equal(lines.reduce((sum, line) => sum + line.net_total_cents, 0), quote.totals.subtotal - quote.totals.discount);
  assert.equal(mock.state.rpcs[0].name, 'reserve_order');
});

function editor(response) {
  const nodes = {}, events = {}, state = { token: 'fixture', writes: [] };
  const node = id => nodes[id] || (nodes[id] = { value: '', checked: false, disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, reset() {} });
  const context = { window: { HN_ADMIN: { token: () => state.token, call: async (action, body) => { if (body) state.writes.push(body); return response ? response(action, body) : { offer: body ? body.offer : { enabled: false, percent_off: 10 } }; } } }, document: { getElementById: node, querySelector: node, addEventListener(type, handler) { events[type] = handler; } } };
  vm.runInNewContext(fs.readFileSync('public/js/admin-cart-offer.js', 'utf8'), context);
  return { nodes, state, events, load: () => node('refreshCartOffer').handlers.click(), submit: () => node('cartOfferForm').handlers.submit({ preventDefault() {} }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('les réglages restent verrouillés avant chargement, puis sauvegardent activation et désactivation', async () => {
  const ui = editor(); ui.submit(); assert.equal(ui.state.writes.length, 0);
  ui.load(); await settle(); assert.equal(ui.nodes.saveCartOffer.disabled, false);
  for (const percent of ['', '-1', '0', '101', '3.5']) { ui.nodes.cartOfferEnabled.checked = true; ui.nodes.cartOfferPercent.value = percent; ui.submit(); }
  assert.equal(ui.state.writes.length, 0);
  for (const enabled of [true, false]) { ui.nodes.cartOfferEnabled.checked = enabled; ui.nodes.cartOfferPercent.value = '10'; ui.submit(); await settle(); assert.equal(ui.state.writes.at(-1).offer.enabled, enabled); }
  assert.match(ui.nodes.cartOfferStatus.textContent, /désactivée/);
});
test('une sauvegarde ne double pas l’envoi et une réponse après déconnexion est ignorée', async () => {
  let release;
  const ui = editor((action, body) => action === 'getCartOffer' ? { offer: { enabled: false, percent_off: 10 } } : new Promise(resolve => { release = () => resolve({ offer: body.offer }); }));
  ui.load(); await settle(); ui.nodes.cartOfferEnabled.checked = true; ui.nodes.cartOfferPercent.value = '10'; ui.submit(); ui.submit();
  assert.equal(ui.state.writes.length, 1); assert.equal(ui.nodes.saveCartOffer.disabled, true);
  ui.state.token = ''; ui.events['hn:admin-logout'](); release(); await settle();
  assert.equal(ui.nodes.saveCartOffer.disabled, true); assert(!ui.nodes.cartOfferStatus.textContent.includes('active :'));
});

test('le panier et le paiement révèlent seulement l’offre réellement appliquée dans les trois langues', () => {
  const store = fs.readFileSync('public/js/store.js', 'utf8');
  const cart = fs.readFileSync('public/js/cart-page.js', 'utf8');
  const checkout = fs.readFileSync('public/js/checkout.js', 'utf8');
  const translations = require('../public/js/i18n');
  for (const lang of ['fr', 'en', 'ar']) {
    const nodes = {}, state = { promo: 0, settings: { tax_rate: 0.2, standard_cents: 699 }, quote: null };
    const node = id => nodes[id] || (nodes[id] = { hidden: true, textContent: '', style: {} });
    const cartItems = [{ slug: 'veste', priceCents: 5000, qty: 1 }];
    const tr = (key, args = {}) => translations[lang][key].replace(/\{(\w+)\}/g, (_, name) => args[name]);
    const context = { window: { HN_COMMERCE: commerce }, document: { getElementById: node }, tr, state, summaryBox: { querySelector: () => null }, ready: true,
      getPromo: () => state.promo ? 'CODE' : '', promoRate: () => state.promo / 100, totals: () => state.quote.totals, formatMoney: cents => '€' + (cents / 100).toFixed(2),
      HN: { cart: { list: () => cartItems }, money: cents => '€' + (cents / 100).toFixed(2) } };
    vm.createContext(context);
    vm.runInContext(store.slice(store.indexOf('  function renderCartOffer('), store.indexOf('  function currentLang(')), context);
    context.HN.renderCartOffer = context.renderCartOffer;
    vm.runInContext(cart.slice(cart.indexOf('  var TAX_RATE'), cart.indexOf('  var itemsEl')) + cart.slice(cart.indexOf('  function totals()'), cart.indexOf('  function renderItems()')) + cart.slice(cart.indexOf('  function renderSummary()'), cart.indexOf('  function wireEvents()')), context);
    context.ready = true;
    for (const [enabled, code, surprise, discount] of [[true,0,true,500],[true,5,true,500],[true,20,false,1000],[false,0,false,0]]) {
      state.promo = code;
      context.applyConfig({ settings: state.settings, cart_offer: { enabled, percent_off: 10 } });
      context.renderSummary();
      assert.equal(nodes.cartOfferNotice.hidden, !surprise);
      assert.equal(nodes.cartSummaryDiscount.textContent, '-€' + (discount / 100).toFixed(2));
      const totals = context.totals(), applied = context.discount();
      if (surprise) assert(nodes.cartOfferNotice.textContent.includes('€5.00'));
      state.quote = { totals, discount: applied };
      vm.runInContext(checkout.slice(checkout.indexOf('  function renderSummary()'), checkout.indexOf('  function setEmptyCartButton()')), context);
      context.totals = () => state.quote.totals;
      context.renderSummary();
      assert.equal(nodes.checkoutOfferNotice.hidden, !surprise);
      assert.equal(nodes.checkoutSummaryTotal.textContent, nodes.cartSummaryTotal.textContent);
      // Restore the real cart implementations for the next case.
      vm.runInContext(cart.slice(cart.indexOf('  function totals()'), cart.indexOf('  function renderItems()')) + cart.slice(cart.indexOf('  function renderSummary()'), cart.indexOf('  function wireEvents()')), context);
    }
    cartItems.length = 0; context.applyConfig({ settings: state.settings, cart_offer: { enabled: true, percent_off: 10 } }); context.renderSummary();
    assert.equal(nodes.cartOfferNotice.hidden, true);
  }
});
test('le paiement en cours n’est pas doublé ni remplacé par un rafraîchissement de promotion', async () => {
  const calls = [], listeners = {}, confirmations = [], quotes = [];
  let release;
  const button = { disabled: false, addEventListener(type, handler) { this.click = handler; } };
  const quote = { totals: { total: 2859 }, currency: { code: 'eur', symbol: '€' }, return_policy: { version: 'fixture' } };
  const state = { quote, method: 'standard', loaded: true, paying: false };
  const context = { state, window: { location: {} }, document: { getElementById: () => button, addEventListener(type, handler) { listeners[type] = handler; } },
    HN: { lang: () => 'ar', api: name => '/api/' + name, cart: { list: () => items }, request: () => { quotes.push(true); return Promise.resolve(quote); } },
    tr: key => key, getPromo: () => '', val: id => ({ contactEmail: 'client@example.test', fullName: 'Test', address1: 'Rue test', city: 'Paris', postalCode: '75000', country: 'FR' })[id] || '',
    fetch: (url, options) => { calls.push(JSON.parse(options.body)); return new Promise(resolve => { release = data => resolve({ status: 409, json: async () => data }); }); },
    acceptQuote: data => { confirmations.push(data); state.quote = data; button.disabled = false; }, totals: () => state.quote.totals, formatMoney: cents => String(cents), showPendingQuote() {} };
  const source = fs.readFileSync('public/js/checkout.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function refreshQuote()'), source.indexOf('  function renderSummary()')) + source.slice(source.indexOf('  function wirePlaceOrder()'), source.indexOf('  function showPendingQuote()')) + source.slice(source.indexOf("  document.addEventListener('hn:config'"), source.indexOf('  init();')) + '\nwirePlaceOrder();', context);
  button.click(); button.click(); listeners['hn:config']();
  assert.equal(state.paying, true); assert.equal(calls.length, 1); assert.equal(quotes.length, 0);
  assert.equal(calls[0].lang, 'ar');
  release({ totals: { total: 3099 }, currency: quote.currency, return_policy: quote.return_policy }); await settle();
  assert.equal(state.paying, false); assert.equal(confirmations.length, 1); assert.equal(calls[0].expected_total_cents, 2859);
  button.click(); assert.equal(calls[1].expected_total_cents, 3099);
  release({ totals: { total: 3099 }, currency: quote.currency, return_policy: quote.return_policy }); await settle();
});
