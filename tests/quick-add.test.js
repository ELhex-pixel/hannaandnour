const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const translations = require('../public/js/i18n');
const clone = value => JSON.parse(JSON.stringify(value));
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(variants = [], options = {}) {
  const cache = new Map(), nodes = [], events = {};
  const state = { lang: options.lang || 'fr', calls: [], messages: [], product: { id: randomUUID(), slug: 'veste-test', name_fr: 'Veste test', name_en: 'Test jacket', name_ar: 'سترة اختبار', price_cents: 2000, active: true, catalog_deleted_at: null, colors: [], sizes: [], variants }, config: { currency: { code: 'eur', symbol: '€' }, settings: { tax_rate: 0.2 }, return_policy: { days: 14 } }, failed: false, gates: [] };
  function element(tag) {
    const node = { tag, children: [], handlers: {}, disabled: false, hidden: false, open: false, _value: '', _text: '', attrs: {},
      addEventListener(type, handler) { this.handlers[type] = handler; }, appendChild(child) { this.children.push(child); }, setAttribute(key, value) { this.attrs[key] = value; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
      get textContent() { return this._text + this.children.map(child => child.textContent).join(' '); }, set textContent(value) { this._text = String(value); this.children = []; this._value = ''; },
      get value() { return this._value; }, set value(value) { const text = String(value); this._value = tag === 'select' && !this.children.some(child => child.value === text) ? '' : text; }
    }; nodes.push(node); return node;
  }
  const document = { readyState: 'loading', body: element('body'), contains: () => true, createElement: element, getElementById: id => nodes.find(node => node.id === id) || null, querySelectorAll: () => [], addEventListener(type, handler) { (events[type] || (events[type] = [])).push(handler); }, dispatchEvent(event) { (events[event.type] || []).forEach(handler => handler(event)); } };
  const context = { window: { HN_CONFIG: { API_BASE: '/api' }, location: { href: '' }, localStorage: { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value) }, I18n: { lang: () => state.lang, t: (key, params = {}) => (translations[state.lang][key] || key).replace(/\{(\w+)\}/g, (_, name) => params[name]) }, hnToast: (title, message, type) => state.messages.push({ title, message, type }) }, document, CustomEvent: class { constructor(type) { this.type = type; } }, AbortController, URLSearchParams, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      state.calls.push({ url, options });
      if (state.failed) throw new Error('Local network failure');
      if (url.includes('/products') && state.wait) await new Promise(resolve => state.gates.push(resolve));
      return { ok: true, json: async () => url.endsWith('/config') ? clone(state.config) : url.includes('/products') ? { products: state.product ? [clone(state.product)] : [] } : {} };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('public/js/store.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('public/js/quick-add.js', 'utf8'), context);
  const button = element('button'); button.closest = () => ({ getAttribute: () => 'veste-test' });
  const HN = context.window.HN;
  return { state, cache, context, nodes, HN, button, node: document.getElementById, dialog: () => nodes.find(node => node.tag === 'dialog'), add: () => HN.quickAdd(button), choose(id) { const select = document.getElementById('quickAddVariant'); select.value = id; select.handlers.change(); }, submit() { nodes.find(node => node.tag === 'form').handlers.submit({ preventDefault() {} }); return settle(); } };
}
const variant = (color, stock, active = true) => ({ id: randomUUID(), color, size: 'Unique', stock, active });

test('Ajout rapide ajoute la seule variante réelle avec son prix frais et sans navigation', async () => {
  const v = variant('Vin', 3), mock = setup([v]);
  mock.cache.set('hn-products', JSON.stringify([{ slug: 'veste-test', price_cents: 1 }]));
  await mock.add();
  const item = mock.HN.cart.list()[0];
  assert.equal(item.priceCents, 2000); assert.equal(item.variantId, v.id); assert.equal(item.color, 'Vin'); assert.equal(item.size, 'Unique'); assert.equal(item.qty, 1);
  assert.equal(mock.context.window.location.href, ''); assert.equal(mock.dialog(), undefined);
  assert.equal(mock.state.messages.at(-1).type, 'success');
});

test('plusieurs variantes exigent un choix explicite ; les options désactivées ou épuisées ne sont pas ajoutées', async () => {
  const good = variant('Vin', 2), empty = variant('Noir', 0), disabled = variant('Bleu', 30, false);
  const mock = setup([good, empty, disabled]); await mock.add();
  assert.equal(mock.dialog().open, true); assert.equal(mock.HN.cart.list().length, 0); assert.equal(mock.node('quickAddConfirm').disabled, true);
  for (const v of [empty, disabled]) { mock.choose(v.id); await mock.submit(); assert.equal(mock.HN.cart.list().length, 0); }
  mock.choose(good.id); await mock.submit();
  assert.equal(mock.HN.cart.list()[0].variantId, good.id); assert.equal(mock.dialog().open, false);
});

test('le stock et les quantités déjà dans le panier sont revérifiés avant chaque ajout', async () => {
  const a = variant('Vin', 2), b = variant('Noir', 3), mock = setup([a, b]);
  await mock.add(); mock.choose(a.id); await mock.submit();
  await mock.add(); mock.choose(a.id); await mock.submit();
  await mock.add(); mock.choose(a.id); await mock.submit();
  assert.equal(mock.HN.cart.list()[0].qty, 2);
  assert(mock.state.messages.at(-1).message.includes(translations.fr.quickAddLimit));
  mock.context.window.HN_QUICK_ADD.close();
  mock.state.product.variants[0].stock = 5;
  await mock.add(); mock.choose(a.id); await mock.submit();
  assert.equal(mock.HN.cart.list()[0].qty, 3); assert.equal(mock.HN.cart.list()[0].maxQty, 5);
  await mock.add(); mock.choose(b.id); mock.state.product.variants[1].stock = 0; await mock.submit();
  assert.equal(mock.HN.cart.list().length, 1); assert.equal(mock.node('quickAddConfirm').disabled, true);
});

test('un prix ou une devise modifiés sont montrés et exigent une nouvelle confirmation', async () => {
  for (const change of ['price', 'currency']) {
    const a = variant('Vin', 5), mock = setup([a, variant('Noir', 5)]);
    await mock.add(); mock.choose(a.id);
    if (change === 'price') mock.state.product.price_cents = 2400;
    else mock.state.config.currency = { code: 'usd', symbol: '$' };
    await mock.submit();
    assert.equal(mock.HN.cart.list().length, 0);
    assert.equal(mock.node('quickAddStatus').textContent, translations.fr.quickAddPriceChanged);
    await mock.submit();
    assert.equal(mock.HN.cart.list()[0].priceCents, change === 'price' ? 2400 : 2000);
  }
});

test('un produit retiré, un stock inconnu ou un échec réseau ne deviennent jamais un ajout fictif', async () => {
  for (const mode of ['deleted','inactive','unknown','network']) {
    const mock = setup([variant('Vin', mode === 'unknown' ? null : 5)]);
    if (mode === 'deleted') mock.state.product.catalog_deleted_at = '2026-10-11T12:00:00Z';
    if (mode === 'inactive') mock.state.product.active = false;
    if (mode === 'network') mock.state.failed = true;
    await mock.add();
    if (mode === 'unknown') { assert.equal(mock.node('quickAddConfirm').disabled, true); await mock.submit(); }
    assert.equal(mock.HN.cart.list().length, 0); assert(!mock.state.messages.some(message => message.type === 'success'));
  }
});

test('les doubles clics et les réponses arrivées après fermeture ne dupliquent pas le panier', async () => {
  const mock = setup([variant('Vin', 5)]); mock.state.wait = true;
  const first = mock.add(); await mock.add(); await settle();
  assert.equal(mock.state.calls.filter(call => call.url.includes('/products')).length, 1);
  mock.state.gates[0](); await first; assert.equal(mock.HN.cart.list()[0].qty, 1);
  const a = variant('Vin', 5), dialog = setup([a, variant('Noir', 5)]);
  await dialog.add(); dialog.choose(a.id); dialog.state.wait = true; await dialog.submit();
  dialog.context.window.HN_QUICK_ADD.close(); dialog.state.gates[0](); await settle();
  assert.equal(dialog.HN.cart.list().length, 0); assert.equal(dialog.dialog().open, false);
});

test('les options et le bouton de confirmation sont traduits FR/EN/AR et les choix sont conservés', async () => {
  for (const lang of ['fr','en','ar']) {
    const a = variant('Vin', 5), mock = setup([a, variant('Noir', 5)], { lang });
    await mock.add(); mock.choose(a.id);
    assert.equal(mock.node('quickAddConfirm').textContent, translations[lang].quickAddConfirm);
    assert.equal(mock.node('quickAddStatus').textContent, translations[lang].quickAddStock.replace('{n}', '5'));
    await mock.submit(); assert.equal(mock.HN.cart.list()[0].color, 'Vin');
  }
});
test('ajouter depuis les favoris utilise aussi le sélecteur de variantes, sans ajout direct incomplet',()=>{
  let click,chosen=null;
  const button={kind:'add'},card={getAttribute:()=> 'veste-test'};
  const context={document:{getElementById:()=>({addEventListener:(type,fn)=>{click=fn;}})},HN:{quickAdd:btn=>{chosen=btn;},cart:{add(){throw new Error('Unselected variant must not be added');}}}};
  const source=fs.readFileSync('public/js/account.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf('  function wireWishlistGrid()'),source.indexOf('  function renderWishlist()'))+';wireWishlistGrid();',context);
  click({target:{closest:selector=>selector==='.wishlist-add'?button:selector==='.product-card'?card:null}});
  assert.equal(chosen,button);
});
