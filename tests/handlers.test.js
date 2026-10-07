const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

function checkout(overrides = {}, stripeError = false) {
  const exports = {};
  const state = { inserted: 0, stripe: 0, releases: 0 };
  const value = { return_policy:{ version:'initial',days:30,withdrawal_payer:'customer',fault_payer:'store' }, items: [{ slug: 'veste', qty: 2, price_cents: 1000, color: '', size: '', variantId: null, product: { id: 'product', name_en: 'Jacket', image: 'images/hero.jpg' } }], totals: { subtotal: 2000, discount: 0, tax: 140, shipping: 699, total: 2839 }, currency: { code: 'eur', symbol: '€' }, method: 'standard', promo: null };
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
const customer = { email: 'customer@example.test', customer_name: 'Test', address1: 'Rue Test', city: 'Paris', postal_code: '75000', country: 'FR', expected_total_cents: 2839, expected_currency: 'eur', expected_policy_version:'initial' };

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
test('un changement des conditions de retour exige une nouvelle confirmation avant paiement',async () => {
  const mock = checkout();
  assert.equal((await mock.handler(event({ ...customer,expected_policy_version:'old' }))).statusCode,409);
  assert.equal(mock.state.inserted,0);
  assert.equal(mock.state.stripe,0);
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

function archiveAdmin(overrides = {}, databaseError = false, returnedIds = null) {
  const exports = {};
  const state = { writes: [], ids: [], tables: [], limits: 0, inventory: [] };
  const query = {
    upsert(row) { assert(state.tables.includes('settings')); state.writes.push(row); return Promise.resolve({ error: databaseError ? new Error('Database unavailable') : null }); },
    update(fields) { state.writes.push(fields); return this; },
    in(field, ids) { assert.equal(field, 'id'); state.ids = Array.from(ids); return this; },
    select(fields) { assert.equal(fields, 'id'); return Promise.resolve({ data: (returnedIds || state.ids).map(id => ({ id })), error: databaseError ? new Error('Database unavailable') : null }); }
  };
  const shared = {
    json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }), isConfigured: () => true,
    getSupabase: () => ({ from(table) { state.tables.push(table); return query; } }),
    readBody: event => JSON.parse(event.body), requireAdmin: async () => ({ ok: true }),
    rateLimit: async () => { state.limits++; return null; }, ...overrides
  };
  vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js', 'utf8'), {
    exports, process: { env: {} }, Buffer, console: { error() {} },
    require: name => name === './shared' ? shared : name === '../../public/js/colors' ? require('../public/js/colors') : name === 'crypto' ? crypto : ['./lib/admin-inventory','./lib/returns','./lib/admin-operations','./lib/admin-sales'].includes(name) ? Object.fromEntries(['adminInventory','adminReturns','adminOperations','adminSales'].map(key => [key,async (sb,action) => { state.inventory.push(action); return shared.json(200,{ ok:true }); }])) : class Stripe { constructor() { throw new Error('No payment expected'); } }
  });
  return { handler: exports.handler, state };
}
const archiveId = '11111111-1111-4111-8111-111111111111';
test('la teinte personnalisée exige une session admin et une limite avant toute écriture', async () => {
  const denied = archiveAdmin({ requireAdmin: async () => ({ ok: false }) });
  assert.equal((await denied.handler(event({ action: 'saveColorSwatch', name: 'Gris maison', hex: '#C0C0C0' }))).statusCode, 401);
  assert.equal(denied.state.writes.length, 0);
  assert.equal(denied.state.limits, 0);
  const limited = archiveAdmin({ rateLimit: async () => ({ statusCode: 429 }) });
  assert.equal((await limited.handler(event({ action: 'saveColorSwatch', name: 'Gris maison', hex: '#C0C0C0' }))).statusCode, 429);
  assert.equal(limited.state.writes.length, 0);
});
test('une teinte est enregistrée atomiquement par nom sans modifier produit, variante, stock ou autres réglages', async () => {
  const mock = archiveAdmin({ saveSetting: require('../netlify/functions/shared').saveSetting });
  for (const name of ['Gris maison', 'Bleu maison', 'Gris maison']) {
    const response = await mock.handler(event({ action: 'saveColorSwatch', name, hex: '#c0c0c0', stock: 999, active: true }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { swatch: { name: name.toLowerCase(), hex: '#C0C0C0' } });
  }
  assert.deepEqual(mock.state.tables, ['settings', 'settings', 'settings']);
  assert.deepEqual(mock.state.writes.map(row => row.key), ['product-color:gris maison', 'product-color:bleu maison', 'product-color:gris maison']);
  assert.deepEqual(mock.state.writes.map(row => Object.keys(row).sort()), Array(3).fill(['key', 'updated_at', 'value']));
});
test('nom et teinte invalides ou erreur SQL ne deviennent jamais un faux succès', async () => {
  for (const [name, hex] of [['', '#112233'], ['x'.repeat(81), '#112233'], ['Deux,couleurs', '#112233'], ['__proto__', '#112233'], ['Gris', 'url(https://example.test)'], ['Gris', '#123'], ['Gris', '#112233; color:red']]) {
    const mock = archiveAdmin();
    assert.equal((await mock.handler(event({ action: 'saveColorSwatch', name, hex }))).statusCode, 400);
    assert.equal(mock.state.writes.length, 0);
    assert.equal(mock.state.limits, 0);
  }
  const failed = archiveAdmin({ saveSetting: async () => { throw new Error('private provider details'); } });
  const result = await failed.handler(event({ action: 'saveColorSwatch', name: 'Gris', hex: '#112233' }));
  assert.equal(result.statusCode, 503);
  assert(!result.body.includes('private provider details'));
});
test('l’archivage en lot exige la session admin avant toute écriture', async () => {
  const mock = archiveAdmin({ requireAdmin: async () => ({ ok: false }) });
  assert.equal((await mock.handler(event({ action: 'archiveProducts', ids: [archiveId] }))).statusCode, 401);
  assert.equal(mock.state.writes.length, 0);
});
test('l’archivage refuse une sélection vide, trop longue ou mal formée', async () => {
  for (const ids of [[], ['invalid'], [null], Array(101).fill(archiveId), 'not-an-array']) {
    const mock = archiveAdmin();
    assert.equal((await mock.handler(event({ action: 'archiveProducts', ids }))).statusCode, 400);
    assert.equal(mock.state.writes.length, 0);
  }
});
test('l’archivage modifie seulement la visibilité en une requête, sans stock ni suppression', async () => {
  const mock = archiveAdmin();
  const response = await mock.handler(event({ action: 'archiveProducts', ids: [archiveId, archiveId] }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).archived_ids, [archiveId]);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.state.writes)), [{ active: false }]);
  assert.deepEqual(mock.state.ids, [archiveId]);
  assert.deepEqual(mock.state.tables, ['products']);
  assert.equal(mock.state.limits, 1);
});
test('la limite de débit et les erreurs de base ne produisent pas de faux succès d’archivage', async () => {
  const limited = archiveAdmin({ rateLimit: async () => ({ statusCode: 429 }) });
  assert.equal((await limited.handler(event({ action: 'archiveProducts', ids: [archiveId] }))).statusCode, 429);
  assert.equal(limited.state.writes.length, 0);
  const failed = archiveAdmin({}, true);
  assert.equal((await failed.handler(event({ action: 'archiveProducts', ids: [archiveId] }))).statusCode, 500);
});
test('l’activation en lot exige la session admin avant toute écriture ou limite', async () => {
  const mock = archiveAdmin({ requireAdmin: async () => ({ ok: false }) });
  assert.equal((await mock.handler(event({ action: 'activateProducts', ids: [archiveId] }))).statusCode, 401);
  assert.equal(mock.state.writes.length, 0);
  assert.equal(mock.state.limits, 0);
});
test('l’activation refuse une sélection vide, trop longue ou mal formée', async () => {
  for (const ids of [undefined, [], ['invalid'], [null], [1], Array(101).fill(archiveId), 'not-an-array']) {
    const mock = archiveAdmin();
    assert.equal((await mock.handler(event({ action: 'activateProducts', ids }))).statusCode, 400);
    assert.equal(mock.state.writes.length, 0);
  }
});
test('l’activation force uniquement la visibilité et déduplique les identifiants sans stock ni paiement', async () => {
  const mock = archiveAdmin();
  const response = await mock.handler(event({ action: 'activateProducts', ids: [archiveId, archiveId], active: false, stock: 999, price_cents: 1 }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { activated_ids: [archiveId] });
  assert.deepEqual(JSON.parse(JSON.stringify(mock.state.writes)), [{ active: true }]);
  assert.deepEqual(mock.state.ids, [archiveId]);
  assert.deepEqual(mock.state.tables, ['products']);
  assert.equal(mock.state.limits, 1);
});
test('la limite de débit et les erreurs de base empêchent un faux succès d’activation', async () => {
  const limited = archiveAdmin({ rateLimit: async () => ({ statusCode: 429 }) });
  assert.equal((await limited.handler(event({ action: 'activateProducts', ids: [archiveId] }))).statusCode, 429);
  assert.equal(limited.state.writes.length, 0);
  const failed = archiveAdmin({}, true);
  assert.equal((await failed.handler(event({ action: 'activateProducts', ids: [archiveId] }))).statusCode, 500);
});
test('l’activation ne déclare que les produits retrouvés, y compris une sélection disparue', async () => {
  const otherId = '22222222-2222-4222-8222-222222222222';
  for (const returned of [[archiveId], []]) {
    const mock = archiveAdmin({}, false, returned);
    const response = await mock.handler(event({ action: 'activateProducts', ids: [archiveId, otherId] }));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).activated_ids, returned);
  }
});
test('réessayer une activation conserve la même visibilité sans mouvement de stock', async () => {
  const mock = archiveAdmin();
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await mock.handler(event({ action: 'activateProducts', ids: [archiveId] }))).statusCode, 200);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(mock.state.writes)), [{ active: true }, { active: true }]);
  assert.deepEqual(mock.state.tables, ['products', 'products']);
});
test('l’upload de photos exige une session et respecte le débit avant tout accès Storage', async () => {
  const denied = archiveAdmin({ requireAdmin: async () => ({ ok: false }) });
  assert.equal((await denied.handler(event({ action: 'uploadImage' }))).statusCode, 401);
  const limited = archiveAdmin({ rateLimit: async () => ({ statusCode: 429 }) });
  assert.equal((await limited.handler(event({ action: 'uploadImage' }))).statusCode, 429);
  assert.equal(limited.state.tables.length, 0);
});
test('la limite serveur reste de 4 Mo et le MIME déclaré ne remplace jamais la signature de la photo', async () => {
  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(oversized);
  for (const body of [
    { mime: 'image/png', data_base64: oversized.toString('base64') },
    { mime: 'image/webp', data_base64: Buffer.from('<svg>not an image</svg>').toString('base64') },
    { mime: 'image/jpeg', data_base64: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64') }
  ]) {
    const mock = archiveAdmin();
    assert.equal((await mock.handler(event({ action: 'uploadImage', name: 'copie.webp', ...body }))).statusCode, 400);
    assert.equal(mock.state.tables.length, 0);
    assert.equal(mock.state.writes.length, 0);
  }
});
test('toutes les actions stock/préparation exigent la session et le débit avant le module', async () => {
  for (const action of ['adjustInventory', 'listInventoryAdjustments', 'scanSetStock', 'setPreparationQuantity', 'completePreparation']) {
    const denied = archiveAdmin({ requireAdmin: async () => ({ ok: false }) });
    assert.equal((await denied.handler(event({ action }))).statusCode, 401);
    assert.equal(denied.state.inventory.length, 0);
    const limited = archiveAdmin({ rateLimit: async () => ({ statusCode: 429 }) });
    assert.equal((await limited.handler(event({ action }))).statusCode, 429);
    assert.equal(limited.state.inventory.length, 0);
    const allowed = archiveAdmin();
    assert.equal((await allowed.handler(event({ action }))).statusCode, 200);
    assert.deepEqual(allowed.state.inventory, [action]);
  }
});
test('les retours, coûts, politique et rapports exigent la session et le débit avant tout module',async () => {
  for (const action of ['recordReturn','listReturnRequests','updateReturnRequest','getReturnPolicy','saveReturnPolicy','listVariantCosts','saveVariantCost','saleStats']) {
    const denied = archiveAdmin({ requireAdmin:async () => ({ ok:false }) });
    assert.equal((await denied.handler(event({ action }))).statusCode,401);
    assert.equal(denied.state.inventory.length,0);
    const limited = archiveAdmin({ rateLimit:async () => ({ statusCode:429 }) });
    assert.equal((await limited.handler(event({ action }))).statusCode,429);
    assert.equal(limited.state.inventory.length,0);
    const allowed = archiveAdmin();
    assert.equal((await allowed.handler(event({ action }))).statusCode,200);
    assert.equal(allowed.state.inventory.length,1);
  }
});
test('les anciennes ventes et remises à zéro sont suspendues sans accès au stock',async () => {
  for (const action of ['scanSale','resetAll','resetStock']) {
    const mock = archiveAdmin();
    assert.equal((await mock.handler(event({ action }))).statusCode,409);
    assert.equal(mock.state.tables.length,0);
    assert.equal(mock.state.inventory.length,0);
  }
});
