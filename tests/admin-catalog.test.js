const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cheerio = require('cheerio');
const catalog = require('../public/js/admin-catalog');
const product = (id, variants = [], active = true) => ({ id, slug: id, name_fr: 'Écharpe ' + id, active, category: 'accessory', price_cents: 1000, variants });

test('le stock non configuré, invalide, désactivé et épuisé sont distincts', () => {
  for (const [variants, state] of [[[], 'unconfigured'], [[{ stock: 0 }], 'empty'], [[{ stock: 20, active: false }], 'disabled'], [[{ stock: 0 }, { stock: 20, active: false }], 'empty'], [[{ stock: 2 }, { stock: 0 }], 'available']]) {
    const p = product('test', variants);
    assert.equal(catalog.stock(p).state, state);
    assert(catalog.matchesStock(p, state));
    if (state !== 'empty') assert.equal(catalog.matchesStock(p, 'empty'), false);
  }
  for (const value of [null, undefined, '0', '5', -1, 1.5, NaN, 1000001]) {
    const p = product('test', [{ stock: value }]);
    assert.equal(catalog.stock(p).state, 'invalid');
    assert.equal(catalog.matchesStock(p, 'empty'), false);
    assert.equal(catalog.matchesStock(p, 'low'), false);
  }
  const p = product('test', [{ stock: 3 }, { stock: 20 }, { stock: 100, active: false }], false);
  assert.equal(catalog.stock(p).total, 23);
  assert(catalog.matchesStock(p, 'low'));
  assert(catalog.matchesProduct(p, { stock: 'available', visibility: 'inactive', query: 'echarpe', category: 'accessory' }));
  assert.equal(catalog.matchesProduct(p, { stock: 'available', visibility: 'active' }), false);
});

test('le tri laisse les stocks inconnus après les quantités confirmées et ne mute pas les fiches', () => {
  const list = [product('missing'), product('high', [{ stock: 30 }]), product('zero', [{ stock: 0 }]), product('low', [{ stock: 3 }]), product('invalid', [{ stock: null }])];
  const before = JSON.stringify(list);
  assert.deepEqual(catalog.sort(list, 'stock-asc').map(p => p.id), ['zero', 'low', 'high', 'invalid', 'missing']);
  assert.deepEqual(catalog.sort(list, 'stock-desc').map(p => p.id), ['high', 'low', 'zero', 'invalid', 'missing']);
  assert.equal(JSON.stringify(list), before);
  assert.equal(catalog.page(list, 50, 10).number, 1);
  assert.deepEqual(catalog.page([], 2, 10), { items: [], number: 1, pages: 1, total: 0, first: 0, last: 0 });
});

function productUI(products) {
  const nodes = {}, calls = [];
  function node(id) {
    return nodes[id] || (nodes[id] = { value: '', innerHTML: '', textContent: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, querySelectorAll(selector) {
      const $ = cheerio.load(this.innerHTML);
      return $(selector).map((_, el) => ({ getAttribute: attr => $(el).attr(attr) })).get();
    } });
  }
  node('productPageSize').value = '10';
  node('sortProducts').value = 'name';
  const context = { window: { HN_ADMIN_CATALOG: catalog }, document: { getElementById: node }, token: () => 'fixture', call: async action => { calls.push(action); return { products }; }, esc: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), money: value => String(value), confirm: () => false };
  vm.createContext(context);
  const source = fs.readFileSync('public/js/admin.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('  var productsAll ='), source.indexOf('  // Copie un produit')) + source.slice(source.indexOf('  function wireFilters()'), source.indexOf('  /* ---------------- Boot')) + '\nwireFilters();', context);
  context.productsAll = products;
  context.renderProducts();
  return { context, nodes, calls, change(id, value) { node(id).value = value; node(id).handlers[id === 'filterProducts' ? 'input' : 'change'](); }, selectPage(checked) { node('productsList').handlers.change.call(node('productsList'), { target: { id: 'selectVisibleProducts', checked } }); } };
}

test('sélectionner la page conserve les choix inter-pages et hors filtre, sans écriture', () => {
  const ui = productUI(Array.from({ length: 23 }, (_, i) => product(String(i + 1))));
  assert.match(ui.nodes.productResults.textContent, /1–10 sur 23/);
  ui.nodes.selectProductPage.handlers.click();
  assert.equal(Object.keys(ui.context.productSelection).length, 10);
  ui.nodes.productNext.handlers.click();
  assert.match(ui.nodes.productResults.textContent, /11–20 sur 23/);
  ui.selectPage(true);
  assert.equal(Object.keys(ui.context.productSelection).length, 20);
  ui.nodes.productPrevious.handlers.click(); ui.selectPage(false);
  assert.equal(Object.keys(ui.context.productSelection).length, 10);
  ui.change('filterProducts', 'Écharpe 23');
  assert.match(ui.nodes.productResults.textContent, /1–1 sur 1/);
  assert.equal(Object.keys(ui.context.productSelection).length, 10);
  assert.match(ui.nodes.productSelectionCount.textContent, /hors page et hors filtre/);
  ui.selectPage(true);
  assert.equal(Object.keys(ui.context.productSelection).length, 11);
  ui.context.productBulkBusy = true;
  ui.selectPage(false);
  assert.equal(Object.keys(ui.context.productSelection).length, 11);
  assert.deepEqual(ui.calls, []);
});

test('changer un filtre réinitialise la page et un rechargement réduit borne la pagination', async () => {
  const products = Array.from({ length: 23 }, (_, i) => product(String(i), i % 2 ? [{ stock: 0 }] : []));
  const ui = productUI(products);
  ui.nodes.productNext.handlers.click(); ui.nodes.productNext.handlers.click();
  assert.equal(ui.context.productPage, 3);
  ui.change('filterProductStock', 'empty');
  assert.equal(ui.context.productPage, 1);
  assert.match(ui.nodes.productResults.textContent, /1–10 sur 11/);
  ui.nodes.productNext.handlers.click();
  products.splice(1);
  await ui.context.loadProducts();
  assert.equal(ui.context.productPage, 1);
  assert.equal(ui.nodes.productNext.disabled, true);
  assert.match(ui.nodes.productsList.innerHTML, /Aucun produit pour ces filtres/);
  ui.nodes.resetProductFilters.handlers.click();
  assert.match(ui.nodes.productResults.textContent, /1–1 sur 1/);
});
