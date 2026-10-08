const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function uploader(response, browser = {}) {
  const calls = [];
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/admin-api.js', 'utf8'), {
    window, setTimeout, clearTimeout, ...browser, sessionStorage: { getItem: () => 'fixture-not-a-real-token' },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ url, headers: options.headers, payload });
      return { ok: payload.name !== 'fail.png', json: async () => response ? response(payload) : payload.name === 'fail.png' ? { error: 'Upload refusé' } : { url: 'images/' + payload.name } };
    }
  });
  return { upload: window.HN_ADMIN.uploadImages, prepare: window.HN_ADMIN.prepareImage, calls };
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
  for (const files of [[], Array(21).fill(photo('photo.png')), [photo('ok.png'), { ...photo('large.png'), size: 40 * 1024 * 1024 + 1 }], [{ ...photo('invalid.svg'), type: 'image/svg+xml' }], [{ ...photo('empty.png'), size: 0 }]]) {
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

function compressionBrowser({ width = 4000, height = 2000, blobs = [{ size: 1024, type: 'image/webp' }], broken = false, unavailable = false } = {}) {
  const state = { sources: [], revoked: [], encodings: [], canvas: null };
  const context = { drawImage() {}, imageSmoothingEnabled: false, imageSmoothingQuality: '' };
  const browser = {
    Image: class {
      constructor() { this.naturalWidth = width; this.naturalHeight = height; }
      set src(value) { if (value) Promise.resolve().then(() => { if (broken) this.onerror(); else this.onload(); }); }
    },
    URL: { createObjectURL(file) { state.sources.push(file); return 'blob:local'; }, revokeObjectURL(url) { state.revoked.push(url); } },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      return state.canvas = { width: 0, height: 0, getContext: () => unavailable ? null : context, toBlob(callback, mime, quality) {
        state.encodings.push({ width: this.width, height: this.height, mime, quality });
        callback(blobs[Math.min(state.encodings.length - 1, blobs.length - 1)]);
      } };
    } },
    File: class {
      constructor(parts, name, options) { this.size = parts.reduce((sum, blob) => sum + blob.size, 0); this.name = name; this.type = options.type; this.lastModified = options.lastModified; }
    }
  };
  return { browser, state };
}
const largePhoto = name => ({ ...photo(name || 'grande.png'), size: 8 * 1024 * 1024, lastModified: 123 });

test('une photo de 4 Mo ou moins est envoyée sans conversion ni modification', async () => {
  const mock = uploader();
  const source = Object.freeze({ ...photo('petite.png'), size: 4 * 1024 * 1024 });
  const prepared = await mock.prepare(source);
  assert.equal(prepared.file, source);
  assert.equal(prepared.compressed, false);
  const result = await mock.upload([source], { read: async file => { assert.equal(file, source); return 'ZmFrZQ=='; } });
  assert.equal(result.compressed, 0);
  assert.equal(mock.calls[0].payload.mime, 'image/png');
});
test('une grande photo devient une copie WebP proportionnelle, sans modifier son original', async () => {
  const { browser, state } = compressionBrowser();
  const mock = uploader(null, browser);
  const source = Object.freeze(largePhoto('photo.PNG'));
  const result = await mock.prepare(source);
  assert.equal(result.compressed, true);
  assert.equal(result.file.name, 'photo-optimisee.webp');
  assert.equal(result.file.type, 'image/webp');
  assert.equal(result.file.lastModified, 123);
  assert.equal(result.width, 2560);
  assert.equal(result.height, 1280);
  assert.equal(source.size, 8 * 1024 * 1024);
  assert.equal(source.name, 'photo.PNG');
  assert.deepEqual(state.sources, [source]);
  assert.deepEqual(state.revoked, ['blob:local']);
  assert.equal(state.canvas.width, 0);
  assert.equal(state.canvas.height, 0);
});
test('compression et envoi restent séquentiels avec le bon nom, MIME et fichier lu', async () => {
  const { browser } = compressionBrowser();
  const mock = uploader(null, browser);
  const originals = [largePhoto('une.png'), largePhoto('deux.png')];
  const phases = [], notifications = [];
  const result = await mock.upload(originals, {
    read: async file => { assert.equal(file.type, 'image/webp'); assert(file.size <= 4 * 1024 * 1024); return 'ZmFrZQ=='; },
    progress: (file, index, res, phase) => phases.push(phase),
    compressed: (original, copy) => notifications.push([original.name, copy.name]),
    success: (url, original, prepared) => { assert.equal(original, originals[mock.calls.length - 1]); assert.equal(prepared.compressed, true); }
  });
  assert.equal(result.uploaded, 2);
  assert.equal(result.compressed, 2);
  assert.deepEqual(phases, ['compression', 'compression']);
  assert.deepEqual(notifications, [['une.png', 'une-optimisee.webp'], ['deux.png', 'deux-optimisee.webp']]);
  assert.deepEqual(mock.calls.map(call => call.payload.name), ['une-optimisee.webp', 'deux-optimisee.webp']);
  assert(mock.calls.every(call => call.payload.mime === 'image/webp' && call.headers.Authorization === 'Bearer fixture-not-a-real-token'));
});
test('une copie encore trop lourde est réduite progressivement avec un nombre borné de tentatives', async () => {
  const { browser, state } = compressionBrowser({ blobs: Array(3).fill({ size: 5 * 1024 * 1024, type: 'image/webp' }).concat({ size: 1024, type: 'image/webp' }) });
  const prepared = await uploader(null, browser).prepare(largePhoto());
  assert.equal(state.encodings.length, 4);
  assert.equal(prepared.width, 1920);
  assert.equal(prepared.height, 960);
  assert.deepEqual(state.encodings.slice(0,3).map(call => call.quality), [0.9, 0.82, 0.74]);
  const failed = compressionBrowser({ blobs: [{ size: 5 * 1024 * 1024, type: 'image/webp' }] });
  await assert.rejects(uploader(null, failed.browser).prepare(largePhoto()), /reste trop lourde/);
  assert(failed.state.encodings.length <= 9);
  assert.equal(failed.state.canvas.width, 0);
  assert.deepEqual(failed.state.revoked, ['blob:local']);
});
test('le repli PNG conserve un nom et un MIME cohérents sans conversion JPEG imposée', async () => {
  const { browser } = compressionBrowser({ blobs: [{ size: 1024, type: 'image/png' }] });
  const prepared = await uploader(null, browser).prepare(largePhoto('transparente.png'));
  assert.equal(prepared.file.name, 'transparente-optimisee.png');
  assert.equal(prepared.file.type, 'image/png');
});
test('photo illisible, dimensions excessives et échec de canvas restent des erreurs identifiées, sans envoi', async () => {
  for (const config of [{ broken: true }, { width: 10000, height: 10000 }, { unavailable: true }, { blobs: [null] }]) {
    const { browser, state } = compressionBrowser(config);
    const mock = uploader(null, browser);
    const result = await mock.upload([largePhoto()], { read: () => assert.fail('No read expected') });
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].name, 'grande.png');
    assert.equal(mock.calls.length, 0);
    assert.deepEqual(state.revoked, ['blob:local']);
  }
});
test('un échec de compression ne perd pas les réussites suivantes et ne compte pas une copie comme ajoutée', async () => {
  const mock = uploader();
  const result = await mock.upload([largePhoto(), photo('petite.png')], {
    prepare: async file => { if (file.size > 4 * 1024 * 1024) throw new Error('Compression refusée'); return { file, compressed: false }; },
    read: async () => 'ZmFrZQ=='
  });
  assert.equal(result.uploaded, 1);
  assert.equal(result.compressed, 0);
  assert.equal(result.failed[0].name, 'grande.png');
  assert.equal(mock.calls[0].payload.name, 'petite.png');
});
test('une préparation invalide ou dépassant 4 Mo ne peut pas être transmise au serveur', async () => {
  for (const prepared of [null, { file: largePhoto(), compressed: true }, { file: { ...photo('x.svg'), type: 'image/svg+xml' }, compressed: true }]) {
    const mock = uploader();
    const result = await mock.upload([largePhoto()], { prepare: async () => prepared, read: () => assert.fail('No read') });
    assert.equal(result.failed.length, 1);
    assert.equal(mock.calls.length, 0);
  }
});
test('déconnexion, fermeture ou arrêt pendant la compression empêchent lecture et envoi tardifs', async () => {
  for (const reason of ['inactive', 'stop']) {
    const mock = uploader();
    let active = true, stopped = false;
    const result = await mock.upload([largePhoto()], {
      active: () => active, stop: () => stopped,
      prepare: async () => { if (reason === 'inactive') active = false; else stopped = true; return { file: photo('copie.webp'), compressed: true }; },
      read: () => assert.fail('No late reading')
    });
    assert.equal(result.stopped, true);
    assert.equal(result.failed.length, 0);
    assert.equal(mock.calls.length, 0);
  }
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

function colorPicker(response) {
  const nodes = {}, events = {};
  const state = { calls: [], toasts: [], confirmed: true, token: 'fixture-token' };
  const node = id => nodes[id] || (nodes[id] = { value: '', disabled: false, hidden: false, checked: false, innerHTML: '', handlers: {}, classList: { toggle() {}, remove() {} }, addEventListener(name, handler) { this.handlers[name] = handler; } });
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/colors.js', 'utf8'), { window });
  const context = {
    COLORS: window.HN_COLORS, editorRevision: 1,
    document: { getElementById: node, querySelectorAll: () => [], addEventListener(name, handler) { events[name] = handler; } },
    esc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    getVal: id => node(id).value,
    setVal: (id, value) => { node(id).value = value; },
    strToList: s => s.split(',').map(v => v.trim()).filter(Boolean),
    token: () => state.token,
    confirm: () => state.confirmed,
    toast: (...args) => state.toasts.push(args),
    call: (action, body) => { state.calls.push({ action, ...body }); return response ? response(body) : Promise.resolve({ swatch: { name: context.COLORS.norm(body.name), hex: body.hex } }); }
  };
  const source = fs.readFileSync('public/js/admin.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function normalizeColorName('), source.indexOf('  function collectProduct(')) + '\nwireColorsPicker();', context);
  node('f-colors');
  node('colorsAddHex').value = '#D3D3D3';
  return { nodes, state, context, events, add: name => { node('colorsAddInput').value = name; node('colorsAddBtn').handlers.click(); } };
}
test('le sélecteur ajoute gris clair automatiquement et refuse une teinte inconnue sans choix explicite', () => {
  const mock = colorPicker();
  mock.add('gris clair');
  assert.equal(mock.nodes['f-colors'].value, 'gris clair');
  assert.match(mock.nodes.colorsTags.innerHTML, /#D3D3D3/);
  assert.equal(mock.state.calls.length, 0);
  mock.add('Bleu maison');
  assert.equal(mock.nodes['f-colors'].value, 'gris clair');
  assert.equal(mock.nodes.colorsAddInput.value, 'Bleu maison');
  assert.match(mock.state.toasts[0][0], /Nom non reconnu/);
});
test('la teinte personnalisée reste liée au nom et nécessite confirmation avant sa sauvegarde', async () => {
  const mock = colorPicker();
  mock.nodes.colorsCustomToggle.checked = true;
  mock.nodes.colorsAddHex.value = '#123456';
  mock.state.confirmed = false;
  mock.add('Bleu maison');
  assert.equal(mock.state.calls.length, 0);
  mock.state.confirmed = true;
  mock.add('Bleu maison');
  await settleBulk();
  assert.deepEqual(mock.state.calls, [{ action: 'saveColorSwatch', name: 'Bleu maison', hex: '#123456' }]);
  assert.equal(mock.nodes['f-colors'].value, 'Bleu maison');
  assert.match(mock.nodes.colorsTags.innerHTML, /#123456/);
  assert.equal(mock.context.COLORS.hex('Bleu maison'), '#123456');
});
test('modifier la teinte d’un nom existant ne duplique ni ne renomme sa couleur', async () => {
  const mock = colorPicker();
  mock.nodes['f-colors'].value = 'gris clair';
  mock.nodes.colorsCustomToggle.checked = true;
  mock.nodes.colorsAddHex.value = '#C7C7C7';
  mock.add('GRIS CLAIR');
  await settleBulk();
  assert.equal(mock.nodes['f-colors'].value, 'gris clair');
  assert.equal(mock.context.COLORS.hex('gris clair'), '#C7C7C7');
});
test('une erreur de sauvegarde de teinte ne produit pas de faux succès ni de changement local', async () => {
  for (const response of [() => Promise.reject(new Error('Refus simulé')), () => Promise.resolve({}), () => Promise.resolve({ swatch: { name: 'autre', hex: '#D3D3D3' } })]) {
    const mock = colorPicker(response);
    mock.nodes.colorsCustomToggle.checked = true;
    mock.add('Gris maison');
    await settleBulk();
    assert.equal(mock.nodes['f-colors'].value, '');
    assert.equal(mock.context.COLORS.has('Gris maison'), false);
    assert.equal(mock.nodes.colorsAddBtn.disabled, false);
    assert.equal(mock.state.toasts[0][1], 'err');
  }
});
test('le choix de teinte verrouille le double clic et ignore les réponses d’une fiche fermée ou déconnectée', async () => {
  for (const disconnect of [false, true]) {
    let resolve;
    const mock = colorPicker(() => new Promise(done => { resolve = done; }));
    mock.nodes.colorsCustomToggle.checked = true;
    mock.add('Gris maison');
    mock.add('Gris maison');
    assert.equal(mock.state.calls.length, 1);
    assert.equal(mock.nodes.colorsAddBtn.disabled, true);
    if (disconnect) mock.state.token = '';
    else { mock.context.editorRevision++; mock.events['hn:product-editor'](); }
    resolve({ swatch: { name: 'gris maison', hex: '#D3D3D3' } });
    await settleBulk();
    assert.equal(mock.nodes['f-colors'].value, '');
    assert.equal(mock.context.COLORS.has('Gris maison'), false);
    assert.equal(mock.state.toasts.length, 0);
  }
});

function policyEditor(response) {
  const nodes = {}, state = { calls: [], notifications: [], token: 'fixture-token' };
  const node = id => nodes[id] || (nodes[id] = { value: '', disabled: false, textContent: '', handlers: {}, reset() {}, addEventListener(name, handler) { this.handlers[name] = handler; } });
  const context = {
    document: { getElementById: node, querySelector: node, addEventListener() {} },
    window: { HN_ADMIN: { token: () => state.token } },
    localStorage: { setItem: (...args) => state.notifications.push(args) },
    confirm: () => true,
    call: (action, body) => { state.calls.push({ action, body }); return response ? response(action, body) : Promise.resolve({ policy: { version: 'next', days: body ? body.days : 37, withdrawal_payer: 'customer', fault_payer: 'store' } }); }
  };
  const source = fs.readFileSync('public/js/admin-features.js', 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  var operationsRevision'), source.indexOf('  var sendcloudBtn')), context);
  context.policy = { version: 'current', days: 37, withdrawal_payer: 'customer', fault_payer: 'store' };
  node('returnPolicyDays').value = '37';
  node('returnPolicyPayer').value = 'customer';
  return { context, state, nodes, submit: () => node('returnPolicyForm').handlers.submit({ preventDefault() {} }) };
}
test('la saisie 0 à 13 est expliquée et ne modifie pas la politique active', async () => {
  for (const days of [0,13,14.5,366]) {
    const mock = policyEditor();
    mock.nodes.returnPolicyDays.value = String(days);
    mock.submit();
    await settleBulk();
    assert.equal(mock.state.calls.length, 0);
    assert.equal(mock.context.policy.days, 37);
    assert.match(mock.nodes.returnPolicyStatus.textContent, /14 à 365/);
  }
});
test('le chargement et les sauvegardes 14 ou 30 synchronisent les deux champs admin', async () => {
  const mock = policyEditor();
  mock.context.loadPolicy();
  await settleBulk();
  assert.equal(mock.nodes.setReturns.value, 37);
  for (const days of [14,30]) {
    mock.nodes.returnPolicyDays.value = String(days);
    mock.submit();
    await settleBulk();
    assert.equal(mock.nodes.setReturns.value, days);
    assert.equal(mock.nodes.returnPolicyDays.value, days);
    assert.equal(mock.context.policy.days, days);
  }
  assert.equal(mock.state.notifications.length, 2);
  assert(mock.state.notifications.every(([key]) => key === 'hn-return-policy-version'));
});
test('une erreur ou déconnexion pendant une sauvegarde de politique ne publie pas de faux délai local', async () => {
  const failed = policyEditor(() => Promise.reject(new Error('Refus simulé')));
  failed.nodes.returnPolicyDays.value = '14';
  failed.submit();
  await settleBulk();
  assert.equal(failed.context.policy.days, 37);
  assert.equal(failed.state.notifications.length, 0);
  assert.equal(failed.nodes.saveReturnPolicy.disabled, false);
  let resolve;
  const late = policyEditor(() => new Promise(done => { resolve = done; }));
  late.nodes.returnPolicyDays.value = '14';
  late.submit();
  late.state.token = '';
  resolve({ policy: { version: 'late', days: 14 } });
  await settleBulk();
  assert.equal(late.context.policy.days, 37);
  assert.equal(late.state.notifications.length, 0);
});
