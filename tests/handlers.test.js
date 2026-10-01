const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function checkout(overrides = {}, stripeError = false) {
  const exports = {};
  const state = { inserted: 0, stripe: 0, releases: 0 };
  const value = { items: [{ slug: 'veste', qty: 2, price_cents: 1000, color: '', size: '', variantId: null, product: { id: 'product', name_en: 'Jacket', image: 'images/hero.jpg' } }], totals: { subtotal: 2000, discount: 0, tax: 140, shipping: 699, total: 2839 }, currency: { code: 'eur', symbol: '€' }, method: 'standard', promo: null };
  const query = { insert() { state.inserted++; return Promise.resolve({ error: null }); }, update() { return this; }, delete() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); } };
  const shared = {
    json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }), getSupabase: () => ({ from: () => query, rpc: async name => { if (name === 'release_order') state.releases++; return { data: true }; } }), isConfigured: () => true,
    readBody: event => JSON.parse(event.body || '{}'), requireUser: async () => ({ ok: true, user: { id: 'user' } }), getBearer: () => '', rateLimit: async () => null, siteUrl: 'https://example.test', CORS_HEADERS: {}, ...overrides
  };
  class Stripe {
    constructor() { this.checkout = { sessions: { create: async payload => { state.stripe++; state.payload = payload; if (stripeError) throw new Error('Network timeout'); return { id: 'cs_test', url: 'https://checkout.stripe.com/test' }; }, expire: async () => {} } }; }
  }
  vm.runInNewContext(fs.readFileSync('netlify/functions/checkout.js', 'utf8'), { exports, process: { env: { STRIPE_SECRET_KEY: 'test-key-not-a-secret' } }, require: name => name === 'crypto' ? crypto : name === 'stripe' ? Stripe : name === './shared' ? shared : { ...require('../public/js/commerce'), quote: async () => value, publicQuote: data => data } });
  return { handler: exports.handler, state, value };
}
const event = payload => ({ httpMethod: 'POST', body: JSON.stringify(payload), headers: {} });
const customer = { email: 'customer@example.test', customer_name: 'Test', address1: 'Rue Test', city: 'Paris', postal_code: '75000', country: 'FR', expected_total_cents: 2839, expected_currency: 'eur' };

test('un devis ne crée ni commande ni session Stripe', async () => {
  const mock = checkout();
  assert.equal((await mock.handler(event({ action: 'quote' }))).statusCode, 200);
  assert.equal(mock.state.inserted, 0);
  assert.equal(mock.state.stripe, 0);
});
test('un prix changé exige une nouvelle confirmation', async () => {
  const mock = checkout();
  const response = await mock.handler(event({ ...customer, expected_total_cents: 1 }));
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).error, 'quote_changed');
  assert.equal(mock.state.stripe, 0);
});
test('un changement de devise ne peut pas être accepté silencieusement', async () => {
  const mock = checkout();
  assert.equal((await mock.handler(event({ ...customer, expected_currency: 'usd' }))).statusCode, 409);
  assert.equal(mock.state.inserted, 0);
});
test('la limite de débit arrête le checkout avant tout effet externe', async () => {
  const mock = checkout({ rateLimit: async () => ({ statusCode: 429 }) });
  assert.equal((await mock.handler(event(customer))).statusCode, 429);
  assert.equal(mock.state.stripe, 0);
});
test('les champs d’adresse sont bornés', async () => {
  const mock = checkout();
  assert.equal((await mock.handler(event({ ...customer, address1: 'x'.repeat(251) }))).statusCode, 400);
  assert.equal(mock.state.inserted, 0);
});
test('le montant des lignes Stripe et du port égale le devis', async () => {
  const mock = checkout();
  assert.equal((await mock.handler(event(customer))).statusCode, 200);
  const payload = mock.state.payload;
  assert.equal(payload.line_items.reduce((sum, line) => sum + line.quantity * line.price_data.unit_amount, 0) + payload.shipping_options[0].shipping_rate_data.fixed_amount.amount, mock.value.totals.total);
});

test('une réponse Stripe perdue ne libère pas aveuglément la réservation', async () => {
  const mock = checkout({}, true);
  assert.equal((await mock.handler(event(customer))).statusCode, 503);
  assert.equal(mock.state.releases, 0);
});

function webhook(type, overrides = {}) {
  const exports = {};
  const state = { rpc: [], raw: null, mail: 0 };
  const object = type === 'charge.refunded' ? { payment_intent: 'pi_test', amount: 2839, currency: 'eur', amount_refunded: 2839 } : { id: 'cs_test', client_reference_id: 'order', payment_status: 'paid', amount_total: 2839, currency: 'eur', payment_intent: 'pi_test' };
  const query = { select() { return this; }, eq() { return this; }, update() { return this; }, is() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const sb = { from: () => query, rpc: async (name, args) => { state.rpc.push({ name, args }); return { data: { changed: false }, error: null }; }, ...overrides };
  const shared = { json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }), isConfigured: () => true, getSupabase: () => sb, siteUrl: 'https://example.test', sendEmail: async () => { state.mail++; } };
  class Stripe {
    constructor() {
      this.webhooks = { constructEvent(raw, signature) { if (signature !== 'valid-test-signature') throw new Error('Invalid signature'); state.raw = raw; return { type, data: { object } }; } };
      this.paymentIntents = { retrieve: async () => ({ metadata: { order_id: 'order' } }) };
    }
  }
  vm.runInNewContext(fs.readFileSync('netlify/functions/stripe-webhook.js', 'utf8'), { exports, Buffer, console: { error() {} }, process: { env: { STRIPE_WEBHOOK_SECRET: 'test-only', STRIPE_SECRET_KEY: 'test-only' } }, require: name => name === 'stripe' ? Stripe : shared });
  return { handler: exports.handler, state };
}

test('un webhook sans signature valide ne touche pas la base', async () => {
  const mock = webhook('checkout.session.completed');
  assert.equal((await mock.handler(event({}))).statusCode, 400);
  assert.equal(mock.state.rpc.length, 0);
});
test('le webhook conserve les octets du corps encodé en base64', async () => {
  const mock = webhook('checkout.session.completed');
  const raw = '{"id":"evt_test"}';
  assert.equal((await mock.handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'valid-test-signature' }, body: Buffer.from(raw).toString('base64'), isBase64Encoded: true })).statusCode, 200);
  assert.equal(mock.state.raw.toString(), raw);
  assert.equal(mock.state.mail, 0);
});
test('une erreur de finalisation demande une nouvelle livraison Stripe', async () => {
  const mock = webhook('checkout.session.completed', { rpc: async () => ({ error: new Error('Database unavailable') }) });
  assert.equal((await mock.handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'valid-test-signature' }, body: '{}' })).statusCode, 500);
});
test('un remboursement arrivé avant le paiement retrouve la commande via les métadonnées Stripe', async () => {
  const mock = webhook('charge.refunded');
  assert.equal((await mock.handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'valid-test-signature' }, body: '{}' })).statusCode, 200);
  assert.equal(mock.state.rpc[0].name, 'reconcile_order_refund');
  assert.equal(mock.state.rpc[0].args.p_order_id, 'order');
});
