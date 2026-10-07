const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function uploader(response) {
  const calls = [];
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/admin-api.js', 'utf8'), {
    window, sessionStorage: { getItem: () => 'fixture-not-a-real-token' },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ url, headers: options.headers, payload });
      return { ok: payload.name !== 'fail.png', json: async () => response ? response(payload) : payload.name === 'fail.png' ? { error: 'Upload refusé' } : { url: 'images/' + payload.name } };
    }
  });
  return { upload: window.HN_ADMIN.uploadImages, calls };
}
const photo = name => ({ name, type: 'image/png', size: 42 });
test('les photos sont envoyées en série et dans l’ordre, par Authorization', async () => {
  const mock = uploader();
  const photos = [photo('one.png'), photo('two.png'), photo('three.png')];
  const urls = [], progress = [];
  const result = await mock.upload(photos, { read: async file => { assert.equal(mock.calls.length, photos.indexOf(file)); return 'ZmFrZQ=='; }, success: url => urls.push(url), progress: (file, index) => progress.push(index) });
  assert.equal(result.uploaded, 3);
  assert.deepEqual(urls, ['images/one.png', 'images/two.png', 'images/three.png']);
  assert.deepEqual(progress, [1, 2, 3]);
  for (const call of mock.calls) {
    assert.equal(call.payload.action, 'uploadImage');
    assert.equal(call.headers.Authorization, 'Bearer fixture-not-a-real-token');
    assert(!call.url.includes('token='));
  }
});
test('tout le lot est validé avant la première lecture ou le premier envoi', async () => {
  const mock = uploader();
  for (const files of [[], Array(21).fill(photo('photo.png')), [photo('ok.png'), { ...photo('large.png'), size: 4 * 1024 * 1024 + 1 }], [{ ...photo('invalid.svg'), type: 'image/svg+xml' }], [{ ...photo('empty.png'), size: 0 }]]) {
    await assert.rejects(mock.upload(files, { read: () => { throw new Error('Must not read'); } }));
  }
  assert.equal(mock.calls.length, 0);
});
test('un échec de photo est signalé sans perdre les succès ni arrêter les suivantes', async () => {
  const mock = uploader();
  const result = await mock.upload([photo('one.png'), photo('fail.png'), photo('three.png')], { read: async () => 'ZmFrZQ==' });
  assert.equal(result.uploaded, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].name, 'fail.png');
  assert.equal(mock.calls.length, 3);
});
test('l’arrêt laisse finir la photo en cours et ne lance pas la suivante', async () => {
  const mock = uploader();
  let stop = false;
  const result = await mock.upload([photo('one.png'), photo('two.png')], { read: async () => 'ZmFrZQ==', stop: () => stop, success: () => { stop = true; } });
  assert.equal(result.uploaded, 1);
  assert.equal(result.stopped, true);
  assert.equal(mock.calls.length, 1);
});
test('un changement de fiche pendant la lecture ne lance aucun upload', async () => {
  const mock = uploader();
  let active = true;
  const result = await mock.upload([photo('one.png')], { active: () => active, read: async () => { active = false; return 'ZmFrZQ=='; }, success: () => assert.fail('No late rendering') });
  assert.equal(result.stopped, true);
  assert.equal(mock.calls.length, 0);
});
test('une réponse tardive après déconnexion ne remplit pas la nouvelle fiche', async () => {
  let active = true;
  const mock = uploader(() => { active = false; return { url: 'images/one.png' }; });
  const result = await mock.upload([photo('one.png'), photo('two.png')], { active: () => active, read: async () => 'ZmFrZQ==', success: () => assert.fail('No late rendering') });
  assert.equal(result.uploaded, 0);
  assert.equal(result.stopped, true);
  assert.equal(mock.calls.length, 1);
});
test('une erreur de lecture ou une URL manquante sont des échecs identifiés', async () => {
  const readFailure = uploader();
  const result = await readFailure.upload([photo('one.png')], { read: async () => { throw new Error('Unreadable'); } });
  assert.equal(result.failed[0].error, 'Unreadable');
  assert.equal(readFailure.calls.length, 0);
  const missingUrl = uploader(() => ({}));
  const missing = await missingUrl.upload([photo('one.png')], { read: async () => 'ZmFrZQ==' });
  assert.equal(missing.uploaded, 0);
  assert.equal(missing.failed.length, 1);
});

function bulkProducts(response) {
  const nodes = {};
  const state = { calls: [], confirms: [], allowed: true, token: 'fixture-token', loads: 0, toasts: [] };
  const node = id => nodes[id] || (nodes[id] = { handlers: {}, disabled: false, hidden: true, textContent: '', addEventListener(name, handler) { this.handlers[name] = handler; } });
  const context = {
    document: { getElementById: node },
    productSelection: { one: true, two: true },
    productsAll: [{ id: 'one', name_fr: 'Fiche affichée' }, { id: 'two', name_fr: 'Fiche hors filtre' }],
    productBulkBusy: false, productBulkRevision: 0,
    token: () => state.token,
    confirm: message => { state.confirms.push(message); return state.allowed; },
    toast: message => state.toasts.push(message),
    call: (action, body) => { state.calls.push({ action, ids: Array.from(body.ids) }); return response ? response(action, body) : Promise.resolve({ activated_ids: body.ids }); },
    loadProducts: async () => { state.loads++; },
    renderProducts: () => context.updateProductSelection()
  };
  const source = fs.readFileSync('public/js/admin.js', 'utf8');
  const selection = source.slice(source.indexOf('  function updateProductSelection()'), source.indexOf('  function productRow('));
  const filters = source.slice(source.indexOf('  function wireFilters()'), source.indexOf('  /* ---------------- Boot'));
  vm.createContext(context);
  vm.runInContext(selection + filters + '\nwireFilters(); updateProductSelection();', context);
  return { state, context, nodes, click: () => node('activateSelectedProducts').handlers.click() };
}
const settleBulk = () => new Promise(resolve => setImmediate(resolve));

test('l’activation demande confirmation avec les produits hors filtre et ne part pas après annulation', async () => {
  const mock = bulkProducts();
  mock.state.allowed = false;
  mock.click();
  await settleBulk();
  assert.equal(mock.state.calls.length, 0);
  assert.match(mock.state.confirms[0], /Fiche hors filtre/);
  assert.match(mock.state.confirms[0], /ventes sans limite/);
  assert.deepEqual(Object.keys(mock.context.productSelection), ['one', 'two']);
});
test('l’activation vide ou dépassant 100 produits est refusée sans requête', async () => {
  for (const count of [0, 101]) {
    const mock = bulkProducts();
    mock.context.productSelection = Object.fromEntries(Array.from({ length: count }, (_, index) => ['id-' + index, true]));
    mock.context.updateProductSelection();
    mock.click();
    await settleBulk();
    assert.equal(mock.state.calls.length, 0);
    assert.equal(mock.nodes.activateSelectedProducts.disabled, count === 0);
  }
});
test('l’activation verrouille les boutons et ne double pas une requête en cours', async () => {
  let resolve;
  const mock = bulkProducts(() => new Promise(done => { resolve = done; }));
  mock.click();
  for (const id of ['activateSelectedProducts', 'archiveSelectedProducts', 'clearProductSelection']) assert.equal(mock.nodes[id].disabled, true);
  mock.click();
  assert.equal(mock.state.calls.length, 1);
  assert.deepEqual(mock.state.calls[0], { action: 'activateProducts', ids: ['one', 'two'] });
  resolve({ activated_ids: ['one', 'two'] });
  await settleBulk();
  assert.match(mock.nodes.productBulkStatus.textContent, /2 produit\(s\) activé\(s\)/);
  assert.equal(mock.state.loads, 1);
  assert.equal(mock.nodes.activateSelectedProducts.disabled, true);
});
test('une activation partielle ne désélectionne que les produits confirmés et compte les doublons une seule fois', async () => {
  const mock = bulkProducts(() => Promise.resolve({ activated_ids: ['one', 'one'] }));
  mock.click();
  await settleBulk();
  assert.deepEqual(Object.keys(mock.context.productSelection), ['two']);
  assert.match(mock.nodes.productBulkStatus.textContent, /1 produit\(s\) activé\(s\)/);
  assert.match(mock.nodes.productBulkStatus.textContent, /Certains produits/);
  assert.equal(mock.nodes.activateSelectedProducts.disabled, false);
});
test('une activation refusée ou une réponse incomplète ne produit pas de faux succès', async () => {
  for (const response of [() => Promise.reject(new Error('Erreur simulée')), () => Promise.resolve({}), () => Promise.resolve({ activated_ids: ['unexpected'] })]) {
    const mock = bulkProducts(response);
    mock.click();
    await settleBulk();
    assert.deepEqual(Object.keys(mock.context.productSelection), ['one', 'two']);
    assert.match(mock.nodes.productBulkStatus.textContent, /Activation non confirmée/);
    assert.equal(mock.state.loads, 0);
    assert.equal(mock.nodes.activateSelectedProducts.disabled, false);
  }
});
test('une réponse d’activation tardive ne termine pas une nouvelle opération après déconnexion', async () => {
  const resolves = [];
  const mock = bulkProducts(() => new Promise(resolve => resolves.push(resolve)));
  mock.click();
  mock.context.productBulkRevision++;
  mock.context.productBulkBusy = false;
  mock.context.productSelection = { two: true };
  mock.click();
  resolves[0]({ activated_ids: ['one', 'two'] });
  await settleBulk();
  assert.equal(mock.context.productBulkBusy, true);
  assert.deepEqual(Object.keys(mock.context.productSelection), ['two']);
  assert.equal(mock.state.loads, 0);
  resolves[1]({ activated_ids: ['two'] });
  await settleBulk();
  assert.equal(mock.context.productBulkBusy, false);
  assert.equal(mock.state.loads, 1);
});
