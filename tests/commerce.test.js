const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, calculate, discountedLines } = require('../public/js/commerce');
const { validateDraft, imageUrl } = require('../netlify/functions/lib/product-assistant');
const { trackingLink } = require('../netlify/functions/lib/tracking');
const { signToken, verifyToken, getBearer, json, readBody } = require('../netlify/functions/shared');
const { isConfigured } = require('../netlify/functions/shared');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const vm = require('node:vm');

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

function productStockUI(product, language = 'fr') {
  const dict = require('../public/js/i18n');
  const state = { color: 'Noir', adds: [], toasts: [] };
  const button = size => ({ textContent: size, disabled: false, classes: {}, classList: { toggle(name, enabled) { this[name] = enabled; } }, addEventListener(name, handler) { this[name] = handler; } });
  const nodes = { selectedSize: { textContent: 'S' }, selectedColor: {}, quantity: { value: '1' }, addToCartBtn: button(''), buyNowBtn: button('') };
  const sizes = ['S', 'M', 'L'].map(button);
  const head = { appendChild(node) { state.schema = JSON.parse(node.textContent); } };
  const context = {
    current: product,
    stockEl: { style: {}, textContent: '' },
    document: {
      getElementById: id => nodes[id] || null,
      querySelector: selector => selector === '.color-option.active' ? { getAttribute: () => state.color } : null,
      querySelectorAll: selector => selector === '.size-option' ? sizes : [],
      getElementsByTagName: () => [head],
      createElement: () => ({})
    },
    window: { location: { origin: 'https://example.test' }, hnToast: (...args) => state.toasts.push(args) },
    HN: { productName: () => 'Produit fictif', lang: () => language, currency: () => 'eur', cart: { add: (...args) => state.adds.push(args) } },
    COLORS: { label: color => color },
    tr: (key, values) => (dict[language][key] || key).replace('{n}', values ? values.n : ''),
    localized: () => '', URL
  };
  const source = fs.readFileSync('public/js/product.js', 'utf8');
  const stock = source.slice(source.indexOf('  function productVariants('), source.indexOf('  /* ---- Reviews'));
  const actions = source.slice(source.indexOf('  function selectedOptions('), source.indexOf('  /* ---- Init'));
  const schema = source.slice(source.indexOf('  function injectProductSchema('), source.indexOf('  function renderDetails('));
  vm.createContext(context);
  vm.runInContext(stock + actions + schema, context);
  context.stockEl = { style: {}, textContent: '' };
  return { context, state, nodes, sizes, update: () => context.updateStockUI() };
}
const stockVariant = (size, stock, active = true, color = 'Noir') => ({ id: size + '-' + color, size, color, stock, active });

test('les variantes désactivées et les combinaisons inexistantes sont indisponibles, pas en stock faible', () => {
  const mock = productStockUI({ variants: [stockVariant('S', 10, false), stockVariant('M', 4)] });
  mock.update();
  assert.equal(mock.context.stockFor(mock.context.current, 'Noir', 'S'), 0);
  assert.equal(mock.context.stockFor(mock.context.current, 'Noir', 'L'), 0);
  assert.deepEqual(mock.sizes.map(button => button.disabled), [true, false, true]);
  assert.equal(mock.nodes.addToCartBtn.disabled, true);
  assert.equal(mock.nodes.buyNowBtn.disabled, true);
  assert.equal(mock.context.stockEl.textContent, 'Indisponible');
  mock.nodes.selectedSize.textContent = 'L';
  mock.update();
  assert.equal(mock.context.stockEl.textContent, 'Indisponible');
});
test('zéro affiche Épuisé ; une variante active conserve son stock et borne la quantité', () => {
  const mock = productStockUI({ variants: [stockVariant('S', 0), stockVariant('M', 3)] });
  mock.update();
  assert.equal(mock.context.stockEl.textContent, 'Épuisé');
  mock.nodes.selectedSize.textContent = 'M';
  mock.nodes.quantity.value = '9';
  mock.update();
  assert.equal(mock.context.stockEl.textContent, 'Plus que 3 disponibles');
  assert.equal(mock.nodes.addToCartBtn.disabled, false);
  assert.equal(mock.nodes.buyNowBtn.disabled, false);
  assert.equal(mock.nodes.quantity.max, 3);
  assert.equal(mock.nodes.quantity.value, 3);
});
test('changer de coloris ne rend pas vendable une variante désactivée ou absente', () => {
  const mock = productStockUI({ variants: [stockVariant('S', 8), stockVariant('S', 8, false, 'Beige')] });
  mock.update();
  assert.equal(mock.nodes.addToCartBtn.disabled, false);
  mock.state.color = 'Beige';
  mock.update();
  assert.equal(mock.nodes.addToCartBtn.disabled, true);
  assert.equal(mock.context.stockEl.textContent, 'Indisponible');
  mock.state.color = 'Bleu';
  mock.update();
  assert.equal(mock.nodes.buyNowBtn.disabled, true);
  assert.equal(mock.context.stockEl.textContent, 'Indisponible');
});
test('aucune variante configurée ne devient artificiellement Épuisé, même avec la forme product_variants', () => {
  const unmanaged = productStockUI({ variants: [] });
  unmanaged.update();
  assert.equal(unmanaged.context.stockFor(unmanaged.context.current, 'Noir', 'S'), null);
  assert.equal(unmanaged.context.stockEl.style.display, 'none');
  assert.equal(unmanaged.nodes.addToCartBtn.disabled, false);
  const inactive = productStockUI({ product_variants: [stockVariant('S', 20, false)] });
  inactive.update();
  assert.equal(inactive.context.stockFor(inactive.context.current, 'Noir', 'S'), 0);
  assert.equal(inactive.context.stockEl.textContent, 'Indisponible');
  assert.equal(inactive.nodes.addToCartBtn.disabled, true);
});
test('le stock invalide ne produit jamais une disponibilité ou une quantité inventée', () => {
  for (const stock of [-1, 2.5, '4abc', Infinity, undefined]) {
    const mock = productStockUI({ variants: [stockVariant('S', stock)] });
    mock.update();
    assert.equal(mock.nodes.addToCartBtn.disabled, true);
    assert.equal(mock.context.stockFor(mock.context.current, 'Noir', 'S'), 0);
    assert(!mock.context.stockEl.textContent.includes('disponibles'));
  }
});
test('même un clic forcé ne peut ajouter au panier une variante désactivée, absente ou épuisée', () => {
  for (const variants of [[stockVariant('S', 5, false)], [stockVariant('M', 5)], [stockVariant('S', 0)]]) {
    const product = { slug: 'fixture', variants };
    const mock = productStockUI(product);
    mock.context.wireActions(product);
    mock.nodes.addToCartBtn.click();
    mock.nodes.buyNowBtn.click();
    assert.equal(mock.state.adds.length, 0);
    assert.equal(mock.state.toasts.length, 2);
    assert.equal(mock.context.selectedOptions().qty, 0);
  }
});
test('la disponibilité SEO ignore aussi les stocks des variantes désactivées', () => {
  for (const [product, expected] of [
    [{ variants: [stockVariant('S', 9, false), stockVariant('M', 0)] }, 'OutOfStock'],
    [{ product_variants: [stockVariant('S', 9, false)] }, 'OutOfStock'],
    [{ variants: [stockVariant('S', 0), stockVariant('M', 6)] }, 'InStock'],
    [{ variants: [] }, 'InStock']
  ]) {
    const mock = productStockUI(product);
    mock.context.injectProductSchema(product);
    assert.equal(mock.state.schema.offers.availability, 'https://schema.org/' + expected);
  }
});
test('les messages de disponibilité restent cohérents en français, anglais et arabe', () => {
  const dict = require('../public/js/i18n');
  for (const language of ['fr', 'en', 'ar']) {
    const mock = productStockUI({ variants: [stockVariant('S', 6, false), stockVariant('M', 0)] }, language);
    mock.update();
    assert.equal(mock.context.stockEl.textContent, dict[language].notAvailable);
    mock.nodes.selectedSize.textContent = 'M';
    mock.update();
    assert.equal(mock.context.stockEl.textContent, dict[language].stockOut);
  }
});

function colorLibrary() {
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/colors.js', 'utf8'), { window });
  return window.HN_COLORS;
}
test('gris clair et gris foncé ont leurs teintes partagées FR/EN/AR, indépendantes du thème', () => {
  const colors = colorLibrary();
  for (const name of ['Gris clair', ' light GREY ', 'Light gray', 'رمادي فاتح']) {
    assert.equal(colors.hex(name), '#D3D3D3');
    assert.equal(colors.has(name), true);
  }
  assert.equal(colors.hex('  GRIS   FONCÉ '), '#606060');
  for (const name of ['Charcoal', 'Espresso', 'Navy']) assert.notEqual(colors.hex(name), '#A67C00');
  assert.equal(colors.hex('Gold'), '#A67C00');
});
test('une couleur inconnue ne prend plus le doré et les noms réservés ne polluent pas la palette', () => {
  const colors = colorLibrary();
  for (const name of ['Une couleur inconnue', '__proto__', 'constructor', 'toString']) {
    assert.equal(colors.has(name), false);
    assert.match(colors.hex(name), /^repeating-linear-gradient/);
    assert.equal(colors.label(name, 'fr'), name);
  }
  assert.equal(colors.has('#123456'), true);
  assert.equal(colors.hex('#123456'), '#123456');
});
test('les teintes personnalisées acceptent uniquement des noms bornés et une couleur hexadécimale sûre', () => {
  const colors = colorLibrary();
  assert.equal(colors.setSwatch('Gris maison', '#abcd12'), true);
  assert.equal(colors.hex(' GRIS  MAISON '), '#ABCD12');
  assert.equal(colors.label('Gris maison', 'fr'), 'Gris maison');
  for (const [name, value] of [['Gris', 'red'], ['Gris', '#112233;display:none'], ['<script>', '#112233'], ['__proto__', '#112233'], ['constructor', '#112233'], ['a'.repeat(81), '#112233']]) assert.equal(colors.setSwatch(name, value), false);
  colors.setSwatches([{ name: 'Gris maison', hex: '#112233' }, { name: 'Gris', hex: 'url(x)' }, null]);
  assert.equal(colors.hex('Gris maison'), '#112233');
  assert.equal(colors.hex('Gris'), '#808080');
  colors.setSwatches([]);
  assert.equal(colors.has('Gris maison'), false);
});
test('seules les teintes validées sont exposées depuis settings, jamais les réglages privés', async () => {
  const { loadColorSwatches } = require('../netlify/functions/shared');
  const state = [];
  const query = {
    select(fields) { state.push(fields); return this; },
    like(field, pattern) { state.push([field, pattern]); return this; },
    order() { return this; },
    limit(value) { assert.equal(value, 1001); return Promise.resolve({ data: [
      { key: 'product-color:gris maison', value: { name: 'Gris maison', hex: '#ABCDEF', secret: 'must-not-return' } },
      { key: 'admin_auth', value: { name: 'admin', hex: '#112233', secret: 'must-not-return' } },
      { key: 'product-color:rouge', value: { name: 'Rouge', hex: 'url(x)' } }
    ] }); }
  };
  const result = await loadColorSwatches({ from(table) { assert.equal(table, 'settings'); return query; } });
  assert.deepEqual(result, [{ name: 'gris maison', hex: '#ABCDEF' }]);
  assert.deepEqual(state, ['key,value', ['key', 'product-color:%']]);
});

function returnsDisplay(language = 'fr') {
  const dict = require('../public/js/i18n');
  const footer = { textContent: '' }, events = [], requests = [], cache = {};
  const context = {
    CONFIG_DATA: {}, RETURN_DAYS: null, REVIEW_DEMO: false, DEMO_COUNT: 0, DEMO_SUM: 0,
    CURRENCY_SYMBOL: '€', CURRENCY_CODE: 'eur', CONFIG_CACHE_KEY: 'fixture-config', configPending: false, configPromise: null,
    window: { I18n: { t: (key, args) => dict[language][key].replace('{n}', args ? args.n : '') } },
    document: { getElementById: id => id === 'footerTrustReturns' ? footer : null, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    readLS: () => cache.config, writeLS: (key, data) => { cache.config = data; }, apiUrl: name => '/api/' + name,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => context.response }; }
  };
  const source = fs.readFileSync('public/js/store.js', 'utf8');
  const loader = source.slice(source.indexOf('  function loadConfig('), source.indexOf('  function isAuthed('));
  const apply = source.slice(source.indexOf('  function applyConfigCopy('), source.indexOf('  function currentLang('));
  const trust = source.slice(source.indexOf('  function refreshFooterTrust('), source.indexOf('  function productName('));
  vm.createContext(context);
  vm.runInContext(loader + apply + trust, context);
  return { context, footer, events, requests };
}
test('le pied de page utilise la politique actuelle et non le délai historique, dans les trois langues', () => {
  const dict = require('../public/js/i18n');
  for (const language of ['fr','en','ar']) {
    const mock = returnsDisplay(language);
    for (const days of [37,14,30]) {
      mock.context.applyConfigCopy({ return_policy: { days }, settings: { returns_days: 30 } });
      assert.equal(mock.context.RETURN_DAYS, days);
      assert.equal(mock.footer.textContent, dict[language].trustReturns.replace('{n}', days));
      assert.equal(mock.events.at(-1).type, 'hn:config');
    }
  }
});
test('un délai nul, illégal ou absent n’invente jamais 30 jours dans l’affichage', () => {
  const mock = returnsDisplay();
  for (const days of [0,13,366,14.5,'14',undefined]) {
    mock.context.applyConfigCopy({ return_policy: { days }, settings: { returns_days: 30 } });
    assert.equal(mock.context.RETURN_DAYS, null);
    assert.equal(mock.footer.textContent, 'Politique de retours');
  }
  mock.context.applyConfigCopy({});
  assert.equal(mock.footer.textContent, 'Politique de retours');
});
test('le rafraîchissement relit sans cache la politique et coalesce les requêtes simultanées', async () => {
  const mock = returnsDisplay();
  mock.context.response = { return_policy: { days: 37 }, settings: { returns_days: 30 } };
  await mock.context.loadConfig();
  await mock.context.loadConfig();
  assert.equal(mock.requests.length, 1);
  mock.context.response = { return_policy: { days: 14 }, settings: { returns_days: 30 } };
  await Promise.all([mock.context.loadConfig(true), mock.context.loadConfig(true)]);
  assert.equal(mock.requests.length, 2);
  assert(mock.requests.every(request => request.options.cache === 'no-store'));
  assert.equal(mock.footer.textContent, 'Retours sous 14 jours');
});
test('une erreur d’un affichage secondaire n’empêche pas la synchronisation du délai', () => {
  const mock = returnsDisplay();
  mock.context.window.I18n.refreshCurrency = () => { throw new Error('Fixture'); };
  mock.context.applyConfigCopy({ return_policy: { days: 37 }, settings: {} });
  assert.equal(mock.footer.textContent, 'Retours sous 37 jours');
  assert.equal(mock.events.at(-1).type, 'hn:config');
});
