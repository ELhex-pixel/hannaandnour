const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { quote, publicQuote } = require('../netlify/functions/lib/commerce');

test('masquer la TVA ne change ni le devis réel, ni la taxe, ni le total transmis au paiement', async () => {
  let expected;
  for (const show_tax of [true, false]) {
    const shipping = { standard_cents: 699, tax_rate: 0.2, show_tax };
    const tables = {
      settings: [{ key: 'shipping', value: shipping }, { key: 'currency', value: { code: 'eur' } }],
      products: [{ id: 'fixture', slug: 'veste', price_cents: 2000, active: true, name_en: 'Test', image: 'images/hero.jpg' }],
      product_variants: [{ id: 'variant', product_id: 'fixture', active: true, color: 'Noir', size: 'M', stock: 3 }]
    };
    const sb = { from: table => ({ select() { return this; }, in() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: tables[table], error: null }).then(resolve); } }) };
    const result = await quote(sb, { items: [{ slug: 'veste', color: 'Noir', size: 'M', qty: 2 }], shipping_method: 'standard', show_tax: !show_tax });
    assert.equal(result.totals.tax, 800);
    assert.equal(result.totals.total, 5499);
    if (expected) assert.deepEqual(result.totals, expected); else expected = result.totals;
    assert.deepEqual(publicQuote(result).totals, expected);
  }
});

test('la case admin reflète le choix enregistré et peut être décochée puis recochée sans modifier le taux', async () => {
  const nodes = {}, calls = [];
  const settings = { tax_rate: 0.2, show_tax: false, standard_cents: 699, express_cents: 1200, nextday_cents: 2500, pickup_cents: 0, free_threshold_cents: 7500 };
  const node = id => nodes[id] || (nodes[id] = { value: '', checked: false, textContent: '', handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const context = {
    document: { getElementById: node }, COLORS: {}, ADMIN_CURRENCY_SYMBOL: '€',
    setVal: (id, value) => node(id).value = String(value), getVal: id => node(id).value,
    dollars: cents => (Number(cents) / 100).toFixed(2), toCents: value => Math.round(Number(value) * 100), renderProducts() {}, toast() {},
    call: async (action, body) => {
      if (action === 'saveSettings') { calls.push(body); Object.assign(settings, body.shipping); }
      return { settings: { ...settings }, currency: { code: 'eur', symbol: '€' } };
    }
  };
  const source = fs.readFileSync('public/js/admin.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function loadSettings()'), source.indexOf('  /* ---------------- Messages')) + '\nwireSettings();', context);
  await context.loadSettings();
  assert.equal(nodes.setShowTax.checked, false);
  assert.equal(nodes.setTax.value, '20');
  for (const choice of [true, false]) {
    nodes.setShowTax.checked = choice;
    nodes.saveSettingsBtn.handlers.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1).shipping.show_tax, choice);
    assert.equal(calls.at(-1).shipping.tax_rate, 0.2);
    await context.loadSettings();
    assert.equal(nodes.setShowTax.checked, choice);
  }
  delete settings.show_tax;
  await context.loadSettings();
  assert.equal(nodes.setShowTax.checked, true);
});
