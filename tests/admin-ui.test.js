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
