const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function ui(response) {
  const nodes = {}, elements = [], events = {}, state = { token: 'fixture', calls: [] };
  function element(tag) {
    const value = { tag, children: [], text: '', hidden: true, handlers: {}, attributes: {},
      appendChild(child) { this.children.push(child); }, setAttribute(key, val) { this.attributes[key] = val; },
      addEventListener(type, handler) { this.handlers[type] = handler; },
      get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); },
      set textContent(text) { this.text = String(text); this.children = []; }
    }; elements.push(value); return value;
  }
  const node = id => nodes[id] || (nodes[id] = element('div'));
  const info = id => ({ id, missing: false, product: { id, name: 'Cape test', sku: 'HN-TEST', slug: 'cape-test' }, reasons: [], eligible: true });
  const window = { HN_ADMIN: { token: () => state.token, call: async (action, body) => { state.calls.push({ action, id: body.id }); return response ? response(body.id) : info(body.id); } } };
  vm.runInNewContext(fs.readFileSync('public/js/admin-product-deletion.js', 'utf8'), { window, document: { getElementById: node, createElement: element, addEventListener(type, handler) { events[type] = handler; } } });
  return { nodes, elements, events, state, controller: window.HN_PRODUCT_DELETION, info };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('les détails affichent la fiche, les compteurs, les références et le bouton de commande sans HTML actif', async () => {
  const id = randomUUID(), order = randomUUID(), variant = randomUUID();
  const mock = ui(() => ({ id, missing: false, eligible: false, product: { id, name: '<img src=x onerror=alert(1)>', sku: 'HN-PREP-CA05', slug: 'cape-test' }, reasons: [
    { kind: 'orders', count: 7, samples: [{ id: randomUUID(), order_id: order, order_number: 'HN-1234', status: 'paid', quantity: 2, created_at: '2026-10-11T12:00:00Z' }] },
    { kind: 'adjustments', count: 1, samples: [{ id: randomUUID(), variant_id: variant, color: 'Vin', size: 'Unique', mode: 'count', stock_before: 5, stock_after: 0, reason: '<script>exemple</script>', created_at: '2026-10-11T12:00:00Z' }] },
    { kind: 'costs', count: 1, samples: [{ id: variant, variant_id: variant, unit_cost_cents: 0, currency: 'eur' }] }
  ] }));
  mock.controller.show([id]); await settle();
  const text = mock.nodes.productDeletionDetails.textContent;
  assert.match(text, /HN-PREP-CA05/); assert.match(text, /Ligne\(s\) de commande liée\(s\) : 7/);
  assert.match(text, /HN-1234/); assert.match(text, /Payée/); assert.match(text, /Références présentées : 1 sur 7/);
  assert.match(text, /Comptage/); assert.match(text, /5 → 0/); assert.match(text, /0.00 EUR/);
  assert(text.includes('<script>exemple</script>')); assert(!mock.elements.some(element => ['script','img','a'].includes(element.tag)));
  const button = mock.elements.find(element => element.tag === 'button');
  assert.equal(button.textContent, 'Voir la commande'); assert.equal(button.attributes['data-id'], order);
  assert.equal(mock.state.calls[0].action, 'getProductDeletionInfo');
});

test('la vérification est paginée trois fiches à la fois, sans demande de suppression', async () => {
  const ids = Array.from({ length: 5 }, randomUUID), mock = ui();
  mock.controller.show([...ids, ids[0], 'invalid']); await settle();
  assert.equal(mock.state.calls.length, 3); assert.match(mock.nodes.productDeletionPage.textContent, /1–3 sur 5/);
  mock.nodes.productDeletionNext.handlers.click(); await settle();
  assert.deepEqual(mock.state.calls.slice(3).map(call => call.id), ids.slice(3));
  assert.equal(mock.nodes.productDeletionNext.disabled, true);
  assert(mock.state.calls.every(call => call.action === 'getProductDeletionInfo'));
  mock.nodes.closeProductDeletionInfo.handlers.click(); assert.equal(mock.nodes.productDeletionInfo.hidden, true);
});

test('erreur de lecture et réponse incomplète n’annoncent jamais un produit supprimable', async () => {
  const id = randomUUID();
  for (const response of [() => Promise.reject(new Error('Lecture indisponible')), () => ({ id, missing: false, product: { id, name: 'Test' }, reasons: [] })]) {
    const mock = ui(response); mock.controller.show([id]); await settle();
    assert(!mock.nodes.productDeletionDetails.textContent.includes('Aucun historique'));
    assert.match(mock.nodes.productDeletionDetails.textContent, /non confirmé|incomplète/);
  }
});

test('les réponses tardives après fermeture, changement de sélection ou déconnexion sont ignorées', async () => {
  for (const action of ['close','selection','logout']) {
    const first = randomUUID(), next = randomUUID(), releases = [];
    const mock = ui(id => new Promise(resolve => releases.push(() => resolve(mock.info(id)))));
    mock.controller.show([first]);
    if (action === 'selection') mock.controller.show([next]);
    else if (action === 'close') mock.controller.clear();
    else { mock.state.token = ''; mock.events['hn:admin-logout'](); }
    releases[0](); await settle();
    if (action === 'selection') {
      assert.equal(mock.nodes.productDeletionDetails.textContent, 'Vérification des liens…'); releases[1](); await settle();
      assert(!mock.nodes.productDeletionDetails.textContent.includes(first)); assert(mock.nodes.productDeletionDetails.textContent.includes(next));
    } else { assert.equal(mock.nodes.productDeletionInfo.hidden, true); assert.equal(mock.nodes.productDeletionDetails.textContent, ''); }
  }
});
test('ouvrir une commande depuis un diagnostic ignore les réponses après fermeture ou déconnexion', async () => {
  for (const action of ['normal','close','logout','detached']) {
    const handlers = {}, nodes = {}, state = { token: 'fixture', opened: [] }; let release;
    const node = id => nodes[id] || (nodes[id] = { handlers: {}, classList: { remove() {} }, addEventListener(type, handler) { this.handlers[type] = handler; } });
    const button = { isConnected: true, getAttribute: () => 'fixture-order' };
    const context = { document: { getElementById: node, addEventListener(type, handler) { handlers[type] = handler; } }, token: () => state.token, call: () => new Promise(resolve => { release = resolve; }), loadOrders() {}, openOrder: order => state.opened.push(order), toast() {} };
    const source = fs.readFileSync('public/js/admin.js', 'utf8');
    vm.runInNewContext(source.slice(source.indexOf('  function wireOrders()'), source.indexOf('  /* ---------------- Ventes & Stock')) + '\nwireOrders();', context);
    handlers.click({ target: { closest: selector => selector === '.view-order' ? button : null } });
    if (action === 'close') node('closeOrderBtn').handlers.click();
    if (action === 'logout') { state.token = ''; handlers['hn:admin-logout'](); }
    if (action === 'detached') button.isConnected = false;
    release({ order: { id: 'fixture-order' } }); await settle();
    assert.equal(state.opened.length, action === 'normal' ? 1 : 0);
  }
});
