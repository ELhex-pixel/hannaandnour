const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, calculate, discountedLines } = require('../public/js/commerce');
const { validateDraft, imageUrl } = require('../netlify/functions/lib/product-assistant');
const { trackingLink } = require('../netlify/functions/lib/tracking');
const { signToken, verifyToken, getBearer, json, readBody } = require('../netlify/functions/shared');
const { isConfigured } = require('../netlify/functions/shared');
const { execFileSync } = require('node:child_process');

test('les doublons sont regroupés et la quantité totale est plafonnée', () => {
  assert.deepEqual(normalize([{ slug: 'pull', qty: 8, color: 'Beige' }, { slug: 'pull', qty: 8, color: 'beige' }]), [{ slug: 'pull', color: 'Beige', size: '', qty: 10 }]);
  assert.throws(() => normalize([null]));
});
test('port, remise et taxe partagent une formule en centimes', () => {
  assert.deepEqual(calculate([{ price_cents: 3490, qty: 2 }], {}, 'standard', 15), { subtotal: 6980, discount: 1047, shipping: 699, tax: 415, total: 7047 });
  assert.equal(calculate([{ price_cents: 7500, qty: 1 }], {}, 'standard', 15).shipping, 0);
  assert.throws(() => calculate([{ price_cents: 10, qty: 1 }], { pickup_enabled: false }, 'pickup', 0));
});
test('allocation exacte des remises, même sans ligne de quantité unitaire', () => {
  for (const percent of [0, 1, 15, 33, 99, 100]) {
    for (let qty = 1; qty <= 10; qty++) {
      const items = [{ price_cents: 3491, qty }, { price_cents: 101, qty: 3 }];
      const totals = calculate(items, {}, 'standard', percent);
      const lines = discountedLines(items, totals.discount);
      assert.equal(lines.reduce((sum, line) => sum + line.quantity * line.unit_amount, 0), totals.subtotal - totals.discount);
      assert(lines.every(line => line.unit_amount >= 0));
      assert.equal(lines.reduce((sum, line) => sum + line.quantity, 0), qty + 3);
    }
  }
});
test('jetons en en-tête, signatures et révocation par version', () => {
  const token = signToken('test-only', 2);
  assert(verifyToken(token, 'test-only', 2));
  assert(!verifyToken(token, 'test-only', 3));
  assert(!verifyToken(token + 'x', 'test-only', 2));
  assert.equal(getBearer({ queryStringParameters: { token } }), '');
  assert.equal(getBearer({ headers: { authorization: 'Bearer ' + token } }), token);
  assert.equal(json(200, {}).headers['Cache-Control'], 'no-store');
  assert.deepEqual(readBody({ body: 'null' }), {});
});
test('l’IA retourne uniquement des champs autorisés', () => {
  const entry = { name: 'Veste', description: 'Veste à manches longues.', features: ['Boutons visibles'] };
  const draft = validateDraft({ category: 'jacket', en: entry, fr: entry, ar: entry, price_cents: 1, fabric_comp_fr: 'Soie' });
  assert.equal(draft.category, 'jacket');
  assert.equal(draft.price_cents, undefined);
  assert.equal(draft.fabric_comp_fr, undefined);
  assert.throws(() => validateDraft({ category: 'wrong' }));
  assert.throws(() => imageUrl('http://127.0.0.1/private.jpg'));
  assert.throws(() => imageUrl('https://example.org/image.jpg'));
});
test('le lien transporteur est borné à des domaines connus', () => {
  assert.equal(trackingLink('unknown', '123'), null);
  assert.equal(trackingLink('dhl', '123&evil=1'), 'https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=123%26evil%3D1');
});
test('les trois langues ont les mêmes clés', () => {
  const dict = require('../public/js/i18n');
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.fr).sort());
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.ar).sort());
});
test('le staging refuse la base de production et les clés Stripe live', () => {
  const keys = ['CONTEXT', 'STAGING_MODE', 'EXPECTED_STAGING_SUPABASE_URL', 'PRODUCTION_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'];
  const saved = keys.map(key => process.env[key]);
  try {
    Object.assign(process.env, { CONTEXT: 'deploy-preview', STAGING_MODE: 'true', EXPECTED_STAGING_SUPABASE_URL: 'https://staging.example.test', PRODUCTION_SUPABASE_URL: 'https://production.example.test', SUPABASE_URL: 'https://staging.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', STRIPE_SECRET_KEY: 'sk_test_fake' });
    assert(isConfigured());
    process.env.SUPABASE_URL = process.env.PRODUCTION_SUPABASE_URL;
    process.env.EXPECTED_STAGING_SUPABASE_URL = process.env.PRODUCTION_SUPABASE_URL;
    assert(!isConfigured());
    process.env.SUPABASE_URL = process.env.EXPECTED_STAGING_SUPABASE_URL = 'https://staging.example.test';
    process.env.STRIPE_SECRET_KEY = 'sk_live_fake';
    assert(!isConfigured());
  } finally { keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
});
test('les liens serveur et CORS utilisent le domaine officiel sans écraser les URLs configurées', () => {
  function config(env) {
    const code = "const shared = require('./netlify/functions/shared'); console.log(JSON.stringify({ siteUrl: shared.siteUrl, origin: shared.CORS_HEADERS['Access-Control-Allow-Origin'] }));";
    return JSON.parse(execFileSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 10000 }));
  }
  assert.deepEqual(config({}), { siteUrl: 'https://hannanour.com', origin: 'https://hannanour.com' });
  assert.deepEqual(config({ SITE_URL: 'http://localhost:8888/' }), { siteUrl: 'http://localhost:8888', origin: 'http://localhost:8888' });
  assert.deepEqual(config({ SITE_URL: 'https://staging.example.test/' }), { siteUrl: 'https://staging.example.test', origin: 'https://staging.example.test' });
  for (const context of ['deploy-preview', 'branch-deploy']) {
    assert.deepEqual(config({ CONTEXT: context, SITE_URL: 'https://hannanour.com', DEPLOY_PRIME_URL: 'https://preview.example.test/' }), {
      siteUrl: 'https://preview.example.test', origin: 'https://preview.example.test'
    });
  }
});
