const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const credentials = { SENDCLOUD_PUBLIC_KEY: 'test-public-NOT-REAL', SENDCLOUD_SECRET_KEY: 'test-secret-NOT-REAL' };
const integration = {
  id: 123, service_point_enabled: true, service_point_carriers: ['mondial_relay'], webhook_active: false,
  feedback_type: 'none', webhook_url: 'https://private.example.test/?secret=private-url', secret_key: 'private-field', shop_name: 'private-shop'
};
const fixtures = {
  '/user/auth/metadata': { user_id: 321, integration_id: 123 },
  '/integrations/123': integration,
  '/contracts': [
    { id: 1, carrier: { code: 'mondial_relay' }, state: 'active', client_id: 'private-client', name: 'private-contract' },
    { id: 2, carrier: { code: 'mondial_relay' }, state: 'validating' },
    { id: 3, carrier: { code: 'colissimo' }, state: 'active' }
  ],
  '/addresses/sender-addresses': [
    { id: 1, country_code: 'FR', postal_code: '75001', address_line_1: 'private-street', name: 'private-name', email: 'private-email', tax_numbers: [{ value: 'private-tax' }] },
    { id: 2, country_code: 'FR', postal_code: '97100' },
    { id: 3, country_code: 'BE', postal_code: '1000' }
  ]
};
const point = {
  id: 1000001, name: 'Relais test', carrier: { code: 'mondial_relay' }, carrier_service_point_id: 'FR-001', general_shop_type: 'locker',
  address: { street: 'Rue Test', house_number: '1', postal_code: '75001', city: 'Paris', country_code: 'FR' },
  is_expired: false, distance: 919, contact: { email: 'private-email', phone: 'private-phone' }
};

function load(env = credentials) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('netlify/functions/lib/sendcloud.js', 'utf8'), {
    module, process: { env }, Buffer, URL, AbortSignal, globalThis: { fetch: () => { throw new Error('Unexpected network access'); } },
    require: name => {
      assert.equal(name, '../shared');
      return { json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }) };
    }
  });
  return module.exports;
}

function response(data, options = {}) {
  return new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' }, ...options });
}

function mock(overrides = {}, env = credentials) {
  const calls = [];
  const client = load(env).createClient({ env, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    const path = new URL(url).pathname.replace('/api/v3', '');
    if (overrides[path]) return overrides[path](url, options);
    assert(Object.hasOwn(fixtures, path), 'Unexpected Sendcloud path');
    return response(fixtures[path]);
  } });
  return { calls, client };
}

test('Sendcloud : clés uniquement en en-tête et contrôles exclusivement GET sur les URL v3 officielles', async () => {
  const { client, calls } = mock();
  const result = await client.diagnostics();
  assert.equal(calls.length, 4);
  assert.equal(result.authenticated, true);
  assert.equal(result.purchases_enabled, false);
  assert.equal(result.automation_enabled, false);
  assert.equal(result.integration.mondial_relay_enabled, true);
  assert.equal(result.contracts.active, 1);
  assert.equal(result.contracts.pending, 1);
  assert.equal(result.sender_addresses.france, 1);
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://panel.sendcloud.sc');
    assert(url.pathname.startsWith('/api/v3/'));
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(credentials.SENDCLOUD_PUBLIC_KEY + ':' + credentials.SENDCLOUD_SECRET_KEY).toString('base64'));
    assert.equal(options.body, undefined);
    assert(!url.href.includes('test-public') && !url.href.includes('test-secret'));
  }
  assert.equal(calls.find(call => call.url.pathname.endsWith('/contracts')).url.searchParams.get('carrier_code'), 'mondial_relay');
  const output = JSON.stringify(result);
  for (const forbidden of ['test-public', 'test-secret', 'private-', 'user_id', 'client_id', 'tax_numbers', 'webhook_url', 'secret_key']) assert(!output.includes(forbidden));
});

test('Sendcloud : aucune requête si une clé manque ou si les identifiants sont mal formés', async () => {
  for (const env of [{}, { SENDCLOUD_PUBLIC_KEY: credentials.SENDCLOUD_PUBLIC_KEY }, { ...credentials, SENDCLOUD_PUBLIC_KEY: 'user:other' }, { ...credentials, SENDCLOUD_SECRET_KEY: 'x'.repeat(513) }]) {
    const { client, calls } = mock({}, env);
    assert.equal((await client.diagnostics()).configured, false);
    await assert.rejects(client.servicePoints({ postal_code: '75001' }), error => error.code === 'sendcloud_not_configured');
    assert.equal(calls.length, 0);
  }
});

test('Sendcloud : erreurs fournisseur et réseau prédéfinies, sans corps, clé ni reprise', async () => {
  const codes = { 400: 'sendcloud_request_rejected', 401: 'sendcloud_auth_failed', 403: 'sendcloud_forbidden', 404: 'sendcloud_not_found', 429: 'sendcloud_rate_limited', 503: 'sendcloud_unavailable' };
  for (const [status, code] of Object.entries(codes)) {
    const { client, calls } = mock({ '/user/auth/metadata': () => new Response('test-secret-NOT-REAL private-error-body', { status: Number(status) }) });
    await assert.rejects(client.diagnostics(), error => {
      assert.equal(error.code, code);
      assert(!error.message.includes('test-secret') && !error.message.includes('private-error'));
      return true;
    });
    assert.equal(calls.length, 1);
  }
  for (const name of ['TypeError', 'AbortError', 'TimeoutError']) {
    const { client } = mock({ '/user/auth/metadata': () => { const error = new Error('test-secret-NOT-REAL'); error.name = name; throw error; } });
    await assert.rejects(client.diagnostics(), error => error.code === (name === 'TypeError' ? 'sendcloud_unavailable' : 'sendcloud_timeout') && !error.message.includes('test-secret'));
  }
});

test('Sendcloud : métadonnées invalides bloquées avant les contrôles secondaires', async () => {
  for (const metadata of [null, {}, { integration_id: '123' }, { integration_id: '../shipments' }, { integration_id: -1 }]) {
    const { client, calls } = mock({ '/user/auth/metadata': () => response(metadata) });
    await assert.rejects(client.diagnostics(), error => error.code === 'sendcloud_invalid_response');
    assert.equal(calls.length, 1);
  }
});

test('Sendcloud : erreurs secondaires isolées et pagination signalée sans suivre les liens distants', async () => {
  const { client, calls } = mock({
    '/contracts': () => new Response('private-denied', { status: 403 }),
    '/addresses/sender-addresses': () => response([], { headers: { Link: '<https://attacker.example.test/next>; rel="next"' } })
  });
  const result = await client.diagnostics();
  assert.equal(result.authenticated, true);
  assert.equal(result.integration.ok, true);
  assert.equal(result.contracts.ok, false);
  assert.equal(result.contracts.code, 'sendcloud_forbidden');
  assert.equal(result.sender_addresses.incomplete, true);
  assert.equal(calls.length, 4);
  assert(!JSON.stringify(result).includes('private-denied'));
});

test('Sendcloud : une intégration incohérente ne confirme pas les relais et les modes risqués sont signalés', async () => {
  const broken = mock({ '/integrations/123': () => response({ ...integration, id: 456 }) });
  assert.equal((await broken.client.diagnostics()).integration.code, 'sendcloud_invalid_response');
  const risky = mock({ '/integrations/123': () => response({ ...integration, service_point_carriers: ['mondial_relay', 'colissimo'], webhook_active: true, feedback_type: 'eager' }) });
  const result = await risky.client.diagnostics();
  assert.equal(result.integration.other_carriers_enabled, true);
  assert.equal(result.integration.webhook_active, true);
  assert.equal(result.integration.feedback_type, 'eager');
});

test('Sendcloud : réponses invalides et trop volumineuses refusées, même sans Content-Length', async () => {
  const responses = [
    () => new Response('not-json private-content'),
    () => new Response('{}'),
    () => new Response(null, { status: 204 }),
    () => new Response('{}', { headers: { 'Content-Length': '524289' } }),
    () => response({ padding: 'x'.repeat(524289) })
  ];
  for (const reply of responses) {
    const { client } = mock({ '/user/auth/metadata': reply });
    await assert.rejects(client.diagnostics(), error => error.code === 'sendcloud_invalid_response');
  }
});

test('Sendcloud : recherche limitée à la métropole et paramètres transporteur imposés par le serveur', async () => {
  const { client, calls } = mock({ '/service-points': () => response({ results: [point], geocoding: { status: 'matched' } }) });
  for (const postal_code of ['', '7500', '750001', '97100', '98000', '99000', '00000', '96000', '../x', '75001&carrier_code=colissimo']) {
    await assert.rejects(client.servicePoints({ postal_code }), error => error.code === 'invalid_postal_code');
  }
  await assert.rejects(client.servicePoints({ postal_code: '75001', country_code: 'BE' }), error => error.code === 'invalid_postal_code');
  assert.equal(calls.length, 0);
  for (const postal_code of ['01000', '20000', '75001', '95000']) {
    const result = await client.servicePoints({ postal_code, carrier_code: 'colissimo', limit: 2000, url: 'https://attacker.example.test', action: 'createLabel' });
    assert.equal(result.points.length, 1);
    const { url, options } = calls.at(-1);
    assert.equal(url.searchParams.get('carrier_code'), 'mondial_relay');
    assert.equal(url.searchParams.get('country_code'), 'FR');
    assert.equal(url.searchParams.get('address_postal_code'), postal_code);
    assert.equal(url.searchParams.get('radius'), '15000');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(options.method, 'GET');
    assert.equal(result.geocoding_status, 'matched');
    assert(!JSON.stringify(result).includes('private-'));
  }
});

test('Sendcloud : relais périmés, étrangers, mal formés et autres transporteurs exclus, résultats plafonnés', async () => {
  const rejected = [
    { ...point, is_expired: true }, { ...point, is_expired: undefined }, { ...point, carrier: { code: 'colissimo' } },
    { ...point, address: { ...point.address, country_code: 'BE' } }, { ...point, address: { ...point.address, postal_code: '97100' } },
    { ...point, id: '../other' }, { ...point, id: -1 }, { ...point, carrier_service_point_id: '' },
    { ...point, address: null }, null
  ];
  const accepted = Array.from({ length: 25 }, (_, index) => ({ ...point, id: 1000001 + index, name: index === 0 ? '<img src=x onerror=alert(1)>' : 'Relais ' + index }));
  const { client } = mock({ '/service-points': () => response({ results: [...rejected, ...accepted], geocoding: null }) });
  const result = await client.servicePoints({ postal_code: '75001' });
  assert.equal(result.points.length, 20);
  assert.equal(result.points[0].id, 1000001);
  assert.equal(result.points[0].name, '<img src=x onerror=alert(1)>');
  assert.equal(result.points[0].type, 'locker');
  assert.equal(result.points[0].distance, 919);
  const broken = mock({ '/service-points': () => response({ results: null }) });
  await assert.rejects(broken.client.servicePoints({ postal_code: '75001' }), error => error.code === 'sendcloud_invalid_response');
});

test('les actions Sendcloud exigent une session admin et le débit persistant avant tout appel externe', async () => {
  for (const action of ['sendcloudDiagnostics', 'searchSendcloudServicePoints']) {
    for (const scenario of ['unauthorized', 'limited', 'allowed', 'get']) {
      const exports = {}, state = { accesses: 0, limited: 0 };
      const shared = {
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }), getSupabase: () => ({}), isConfigured: () => true,
        readBody: event => JSON.parse(event.body), requireAdmin: async () => ({ ok: scenario !== 'unauthorized' }),
        rateLimit: async (sb, event, scope, limit, seconds, identifier) => {
          state.limited++;
          assert.equal(scope, 'admin-sendcloud'); assert.equal(limit, 30); assert.equal(seconds, 600); assert.equal(identifier, 'admin');
          return scenario === 'limited' ? { statusCode: 429 } : null;
        }
      };
      vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js', 'utf8'), { exports, console, process: { env: {} }, require: name => {
        if (name === './shared') return shared;
        if (name === 'crypto') return crypto;
        if (name === 'stripe') return class Stripe {};
        if (name === './lib/sendcloud') return { adminSendcloud: async received => { state.accesses++; assert.equal(received, action); return { statusCode: 200 }; } };
        throw new Error('Unexpected dependency');
      } });
      const result = await exports.handler({ httpMethod: scenario === 'get' ? 'GET' : 'POST', body: JSON.stringify({ action, postal_code: '75001' }), headers: {} });
      assert.equal(result.statusCode, { unauthorized: 401, limited: 429, allowed: 200, get: 405 }[scenario]);
      assert.equal(state.accesses, scenario === 'allowed' ? 1 : 0);
      assert.equal(state.limited, ['allowed', 'limited'].includes(scenario) ? 1 : 0);
    }
  }
});

test('l’admin Sendcloud refuse les actions inconnues sans requête, et ne journalise aucune erreur', async () => {
  const api = load();
  const unknown = await api.adminSendcloud('createLabel', {});
  assert.equal(unknown.statusCode, 400);
  const result = await api.adminSendcloud('sendcloudDiagnostics', {});
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body).code, 'sendcloud_unavailable');
  assert(!result.body.includes('Unexpected network'));
  assert(!result.body.includes('test-secret'));
});

function adminUi(call) {
  const nodes = new Map();
  function element() {
    const node = { children: [], listeners: {}, value: '', disabled: false, hidden: false,
      addEventListener(name, callback) { this.listeners[name] = callback; }, appendChild(child) { this.children.push(child); } };
    let content = '';
    Object.defineProperty(node, 'textContent', {
      get() { return content + this.children.map(child => child.textContent).join('\n'); },
      set(value) { content = value; this.children = []; }
    });
    Object.defineProperty(node, 'innerHTML', { set() { throw new Error('HTML rendering forbidden'); } });
    return node;
  }
  function get(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }
  vm.runInNewContext(fs.readFileSync('public/js/admin-features.js', 'utf8'), {
    window: { HN_ADMIN: { call } }, document: { getElementById: get, querySelector: get, createElement: element, addEventListener() {} }
  });
  return { get, flush: () => new Promise(resolve => setImmediate(resolve)) };
}

test('admin Sendcloud : résultats rendus en texte, aucun appel automatique et boutons réactivés', async () => {
  const calls = [];
  const ui = adminUi(async (action, body) => {
    calls.push({ action, body });
    if (action === 'sendcloudDiagnostics') return { sendcloud: {
      configured: true, authenticated: true,
      integration: { ok: true, id: 123, service_points_enabled: true, mondial_relay_enabled: true, feedback_type: 'eager', webhook_active: true },
      contracts: { ok: true, active: 1, incomplete: true }, sender_addresses: { ok: true, france: 1 }
    } };
    return { points: [{ ...point, name: '<img src=x onerror=alert(1)>', type: 'locker' }] };
  });
  assert.equal(calls.length, 0);
  ui.get('testSendcloudBtn').listeners.click();
  assert.equal(ui.get('testSendcloudBtn').disabled, true);
  await ui.flush();
  assert.equal(ui.get('testSendcloudBtn').disabled, false);
  const output = ui.get('sendcloudDiagnostics').textContent;
  assert(output.includes('API v3 réussie'));
  assert(output.includes('pas une prise en charge réelle'));
  assert(output.includes('premier lot'));
  assert(output.includes('Aucun achat effectué'));
  ui.get('sendcloudPostalCode').value = '75001';
  ui.get('sendcloudPointsForm').listeners.submit({ preventDefault() {} });
  assert.equal(ui.get('searchSendcloudPointsBtn').disabled, true);
  await ui.flush();
  assert.equal(ui.get('searchSendcloudPointsBtn').disabled, false);
  assert(ui.get('sendcloudPoints').textContent.includes('<img src=x onerror=alert(1)>'));
  assert(ui.get('sendcloudPoints').textContent.includes('Locker'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.postal_code, '75001');
});

test('admin Sendcloud : une erreur ou un résultat vide ne bloque pas une nouvelle tentative', async () => {
  const ui = adminUi(async () => { throw new Error('Erreur simulée'); });
  ui.get('testSendcloudBtn').listeners.click();
  await ui.flush();
  assert.equal(ui.get('sendcloudDiagnostics').textContent, 'Erreur simulée');
  assert.equal(ui.get('testSendcloudBtn').disabled, false);
  ui.get('sendcloudPointsForm').listeners.submit({ preventDefault() {} });
  await ui.flush();
  assert.equal(ui.get('sendcloudPoints').textContent, 'Erreur simulée');
  assert.equal(ui.get('searchSendcloudPointsBtn').disabled, false);
  const empty = adminUi(async action => action === 'sendcloudDiagnostics' ? { sendcloud: { configured: false } } : { points: [], geocoding_status: 'not_found' });
  empty.get('testSendcloudBtn').listeners.click();
  empty.get('sendcloudPointsForm').listeners.submit({ preventDefault() {} });
  await empty.flush();
  assert(empty.get('sendcloudDiagnostics').textContent.includes('Clés serveur absentes'));
  assert(empty.get('sendcloudPoints').textContent.includes('non localisé'));
});
