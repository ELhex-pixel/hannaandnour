const test = require('node:test');
const assert = require('node:assert/strict');
const { describe } = require('../netlify/functions/lib/product-assistant');
const { siteUrl } = require('../netlify/functions/shared');
const image = siteUrl + '/images/product.jpg';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const entry = { name: 'Veste', description: 'Veste à boutons visibles.', features: ['Boutons visibles'] };
const draft = { category: 'jacket', en: entry, fr: entry, ar: entry, price_cents: 1 };

function imageResponse() { return new Response(jpeg); }
function geminiResponse(value = draft, finishReason = 'STOP') {
  return Response.json({ candidates: [{ finishReason, content: { parts: [{ thought: true, text: 'Ignorer ce raisonnement' }, { text: JSON.stringify(value) }] } }] });
}
function setup(t, env = {}) {
  const keys = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'PRODUCT_VISION_MODEL'];
  const saved = keys.map(key => process.env[key]);
  keys.forEach(key => delete process.env[key]);
  Object.assign(process.env, { GEMINI_API_KEY: 'test-only-gemini-key' }, env);
  const fetch = global.fetch;
  t.after(() => {
    global.fetch = fetch;
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  });
}

test('Gemini reçoit une photo bornée et une clé en en-tête, jamais dans une URL', async t => {
  setup(t, { OPENAI_API_KEY: 'test-only-openai-key', PRODUCT_VISION_MODEL: 'gpt-4o-mini' });
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? imageResponse() : geminiResponse();
  };
  const result = await describe(image);
  assert.equal(result.name_fr, entry.name);
  assert.equal(result.price_cents, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, image);
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(calls[1].options.headers['x-goog-api-key'], process.env.GEMINI_API_KEY);
  assert.equal(calls[1].options.redirect, 'error');
  assert(!calls.some(call => call.url.includes(process.env.GEMINI_API_KEY)));
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(payload.contents[0].parts[1].inlineData.data, jpeg.toString('base64'));
  assert.equal(payload.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(payload.generationConfig.responseSchema.required, ['category', 'en', 'fr', 'ar']);
  assert(!calls[1].options.body.includes(process.env.GEMINI_API_KEY));
  assert(!JSON.stringify(result).includes(process.env.GEMINI_API_KEY));
});

test('Gemini accepte un modèle configuré sans permettre de changer son endpoint', async t => {
  setup(t, { GEMINI_MODEL: 'gemini-3.8-flash' });
  global.fetch = async url => url === image ? imageResponse() : geminiResponse();
  assert.equal((await describe(image)).category, 'jacket');
  process.env.GEMINI_MODEL = '../private?key=bad';
  global.fetch = async () => { throw new Error('Unexpected request'); };
  await assert.rejects(describe(image), /identifiant de modèle/);
});

test('Gemini refuse une URL externe avant toute requête', async t => {
  setup(t);
  global.fetch = async () => { throw new Error('Unexpected request'); };
  await assert.rejects(describe('https://example.org/image.jpg'), /image uploadée/);
});

test('une redirection de la photo ne déclenche aucun appel Gemini', async t => {
  setup(t);
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(url, image);
    assert.equal(options.redirect, 'error');
    throw new Error('Redirect rejected');
  };
  await assert.rejects(describe(image), /télécharger la photo/);
  assert.equal(calls, 1);
});

test('Gemini refuse une photo trop lourde même sans Content-Length', async t => {
  setup(t);
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(Buffer.alloc(4 * 1024 * 1024 + 1)); };
  await assert.rejects(describe(image), /4 Mo/);
  assert.equal(calls, 1);
});

test('Gemini refuse une taille annoncée excessive et les fichiers non image', async t => {
  setup(t);
  global.fetch = async () => new Response(jpeg, { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } });
  await assert.rejects(describe(image), /4 Mo/);
  global.fetch = async () => new Response('<html>Not an image</html>');
  await assert.rejects(describe(image), /Image JPG, PNG ou WebP/);
});

test('les erreurs Gemini ne révèlent ni clé ni corps de réponse du fournisseur', async t => {
  setup(t);
  for (const [status, message] of [[401, /invalide/], [403, /autorisations/], [429, /Quota/], [404, /Modèle/], [500, /indisponible/]]) {
    global.fetch = async url => url === image ? imageResponse() : new Response(process.env.GEMINI_API_KEY, { status });
    await assert.rejects(describe(image), error => message.test(error.message) && !error.message.includes(process.env.GEMINI_API_KEY));
  }
  global.fetch = async url => { if (url === image) return imageResponse(); throw new Error(process.env.GEMINI_API_KEY); };
  await assert.rejects(describe(image), error => /indisponible/.test(error.message) && !error.message.includes(process.env.GEMINI_API_KEY));
});

test('une clé Gemini invalide en HTTP 400 est identifiée sans révéler le secret', async t => {
  setup(t);
  global.fetch = async url => url === image ? imageResponse() : Response.json({ error: {
    status: 'INVALID_ARGUMENT', message: process.env.GEMINI_API_KEY,
    details: [{ reason: 'API_KEY_INVALID', metadata: { key: process.env.GEMINI_API_KEY } }]
  } }, { status: 400 });
  await assert.rejects(describe(image), error => /Clé Gemini invalide/.test(error.message) && /HTTP 400 \/ API_KEY_INVALID/.test(error.message) && !error.message.includes(process.env.GEMINI_API_KEY));
});

test('les diagnostics Gemini distinguent clé bloquée, API désactivée et facturation', async t => {
  setup(t);
  for (const [reason, message] of [['API_KEY_HTTP_REFERRER_BLOCKED', /appels serveur Netlify/], ['SERVICE_DISABLED', /Activez la Generative Language API/], ['BILLING_DISABLED', /facturation/]]) {
    global.fetch = async url => url === image ? imageResponse() : Response.json({ error: { details: [{ reason }], message: process.env.GEMINI_API_KEY } }, { status: 403 });
    await assert.rejects(describe(image), error => message.test(error.message) && !error.message.includes(process.env.GEMINI_API_KEY));
  }
  global.fetch = async url => url === image ? imageResponse() : Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 400 });
  await assert.rejects(describe(image), /facturation/);
});

test('seuls les codes Google autorisés figurent dans les diagnostics', async t => {
  setup(t);
  global.fetch = async url => url === image ? imageResponse() : Response.json({ error: {
    status: process.env.GEMINI_API_KEY, details: [{ reason: process.env.GEMINI_API_KEY }], message: process.env.GEMINI_API_KEY
  } }, { status: 400 });
  await assert.rejects(describe(image), error => /HTTP 400/.test(error.message) && !error.message.includes(process.env.GEMINI_API_KEY));
  global.fetch = async url => url === image ? imageResponse() : Response.json({ error: { message: 'API key not valid. ' + process.env.GEMINI_API_KEY } }, { status: 400 });
  await assert.rejects(describe(image), error => /Clé Gemini invalide/.test(error.message) && !error.message.includes(process.env.GEMINI_API_KEY));
});

test('Gemini refuse une sortie bloquée, tronquée, invalide ou sans les trois langues', async t => {
  setup(t);
  for (const response of [
    geminiResponse(draft, 'MAX_TOKENS'), Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    geminiResponse({ category: 'jacket', fr: entry }),
    Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not JSON' }] } }] }),
    new Response('not JSON')
  ]) {
    global.fetch = async url => url === image ? imageResponse() : response;
    await assert.rejects(describe(image), /complète|inexploitable/);
  }
});

test('OpenAI et OpenRouter restent disponibles quand Gemini n’est pas configuré', async t => {
  setup(t);
  delete process.env.GEMINI_API_KEY;
  for (const [key, endpoint] of [['OPENAI_API_KEY', 'https://api.openai.com/v1/chat/completions'], ['OPENROUTER_API_KEY', 'https://openrouter.ai/api/v1/chat/completions']]) {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env[key] = 'test-only-provider-key';
    global.fetch = async (url, options) => {
      assert.equal(url, endpoint);
      assert.equal(options.headers.Authorization, 'Bearer test-only-provider-key');
      return Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }] });
    };
    assert.equal((await describe(image)).name_fr, entry.name);
  }
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(describe(image), /GEMINI_API_KEY/);
});
