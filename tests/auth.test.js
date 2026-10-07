const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const email = 'customer@example.test';
const redirectTo = 'https://example.test/reset.html';
const actionLink = 'https://project.supabase.co/auth/v1/verify?token=test-only-token&type=recovery&redirect_to=' + encodeURIComponent(redirectTo);
const event = body => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });

function auth(options = {}) {
  const state = { links: [], emails: [], smtp: [], logs: [], limits: [], updates: 0 };
  const sb = { auth: {
    admin: {
      generateLink: async payload => {
        state.links.push(payload);
        if (options.linkThrow) throw options.linkThrow;
        return options.linkResult || { data: { properties: { action_link: actionLink }, user: { email } }, error: null };
      },
      updateUserById: async () => { state.updates++; return { error: null }; }
    },
    resetPasswordForEmail: async (address, payload) => { state.smtp.push({ address, payload }); return { error: options.smtpError || null }; }
  } };
  const shared = {
    json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
    getSupabase: () => sb,
    isConfigured: () => true,
    readBody: request => JSON.parse(request.body),
    requireUser: async () => ({ ok: false, error: 'Invalid session' }),
    getBearer: request => (request.headers.authorization || '').replace(/^Bearer /, ''),
    CORS_HEADERS: {}, siteUrl: 'https://example.test',
    rateLimit: async (...args) => { state.limits.push(args.slice(2)); return options.limited || null; },
    sendEmail: async payload => {
      state.emails.push(payload);
      if (options.emailError) throw options.emailError;
      return options.skipped ? { skipped: true } : { ok: true };
    }
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync('netlify/functions/auth.js', 'utf8'), {
    exports, URL, process: { env: { SUPABASE_URL: 'https://project.supabase.co', ...(options.smtpOnly ? {} : { RESEND_API_KEY: 'test-only' }) } },
    console: { error: (...args) => state.logs.push(args) },
    require: name => name === 'crypto' ? crypto : shared
  });
  return { handler: exports.handler, state };
}

test('la récupération envoie une seule fois le lien Supabase via Resend sans exposer le lien', async () => {
  const mock = auth();
  const response = await mock.handler(event({ action: 'forgotPassword', email: ' CUSTOMER@example.test ' }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
  assert.equal(mock.state.links.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.state.links[0])), { type: 'recovery', email, options: { redirectTo } });
  assert.equal(mock.state.emails.length, 1);
  assert.equal(mock.state.emails[0].to, email);
  assert(mock.state.emails[0].html.includes('&amp;type=recovery'));
  assert.equal(mock.state.smtp.length, 0);
  assert.equal(mock.state.updates, 0);
  assert.equal(mock.state.logs.length, 0);
  assert.deepEqual(mock.state.limits[0], ['auth:forgotPassword', 10, 600, ' CUSTOMER@example.test ']);
});

test('un compte absent reçoit la même réponse publique sans créer de compte ni envoyer', async () => {
  const mock = auth({ linkResult: { data: null, error: { code: 'user_not_found', message: 'private@example.test' } } });
  assert.deepEqual(JSON.parse((await mock.handler(event({ action: 'forgotPassword', email }))).body), { ok: true });
  assert.equal(mock.state.emails.length, 0);
  assert.equal(mock.state.smtp.length, 0);
  assert.equal(mock.state.updates, 0);
  assert.equal(mock.state.logs.length, 0);
});

test('un échec Resend ne déclenche aucun second envoi SMTP ni succès trompeur', async () => {
  for (const options of [{ emailError: new Error('secret token=test-only-token customer@example.test') }, { skipped: true }]) {
    const mock = auth(options);
    const response = await mock.handler(event({ action: 'forgotPassword', email }));
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: 'reset_send_failed' });
    assert.equal(mock.state.emails.length, 1);
    assert.equal(mock.state.smtp.length, 0);
    assert.doesNotMatch(JSON.stringify(mock.state.logs), /secret|test-only-token|customer@example/);
  }
});

test('seuls les liens de récupération du projet vers la page autorisée sont envoyés', async () => {
  const badLinks = [
    actionLink.replace('project.supabase.co', 'attacker.example'),
    actionLink.replace('type=recovery', 'type=signup'),
    actionLink.replace(encodeURIComponent(redirectTo), encodeURIComponent('https://attacker.example/reset.html')),
    actionLink.replace('/auth/v1/verify', '/unexpected'),
    actionLink.replace('https://project', 'https://user:pass@project'),
    actionLink.replace('token=test-only-token', 'token=')
  ];
  for (const link of badLinks) {
    const mock = auth({ linkResult: { data: { properties: { action_link: link }, user: { email } }, error: null } });
    assert.equal((await mock.handler(event({ action: 'forgotPassword', email }))).statusCode, 503);
    assert.equal(mock.state.emails.length, 0);
  }
  for (const data of [null, {}, { properties: { action_link: actionLink }, user: { email: 'other@example.test' } }]) {
    const mock = auth({ linkResult: { data, error: null } });
    assert.equal((await mock.handler(event({ action: 'forgotPassword', email }))).statusCode, 503);
    assert.equal(mock.state.emails.length, 0);
  }
});

test('une limite persistante arrête la récupération avant toute génération ou tout envoi', async () => {
  const mock = auth({ limited: { statusCode: 429, body: '{"error":"rate_limited"}' } });
  assert.equal((await mock.handler(event({ action: 'forgotPassword', email }))).statusCode, 429);
  assert.equal(mock.state.links.length, 0);
  assert.equal(mock.state.emails.length, 0);
  assert.equal(mock.state.smtp.length, 0);
});

test('les erreurs fournisseur sont filtrées et les quotas restent des erreurs de débit', async () => {
  for (const error of [{ status: 429 }, { code: 'over_email_send_rate_limit' }, { code: 'over_request_rate_limit' }]) {
    const mock = auth({ linkResult: { data: null, error } });
    assert.equal((await mock.handler(event({ action: 'forgotPassword', email }))).statusCode, 429);
    assert.equal(mock.state.emails.length, 0);
  }
  const mock = auth({ linkThrow: new Error('Unable to generate link with private token') });
  assert.equal((await mock.handler(event({ action: 'forgotPassword', email }))).statusCode, 503);
  assert.doesNotMatch(JSON.stringify(mock.state.logs), /private|token/);
});

test('le SMTP reste utilisé une seule fois sans clé Resend et ses échecs ne sont pas masqués', async () => {
  const mock = auth({ smtpOnly: true });
  assert.equal((await mock.handler(event({ action: 'forgotPassword', email }))).statusCode, 200);
  assert.equal(mock.state.smtp.length, 1);
  assert.equal(mock.state.smtp[0].payload.redirectTo, redirectTo);
  assert.equal(mock.state.links.length, 0);
  assert.equal(mock.state.emails.length, 0);
  const failed = auth({ smtpOnly: true, smtpError: { message: 'SMTP credentials rejected' } });
  assert.equal((await failed.handler(event({ action: 'forgotPassword', email }))).statusCode, 503);
});

test('un email invalide ou trop long ne génère aucun lien', async () => {
  for (const invalid of ['', 'invalid', 'x'.repeat(255) + '@example.test']) {
    const mock = auth();
    assert.equal((await mock.handler(event({ action: 'forgotPassword', email: invalid }))).statusCode, 400);
    assert.equal(mock.state.links.length, 0);
    assert.equal(mock.state.emails.length, 0);
  }
});

test('un token invalide ne peut pas modifier un mot de passe', async () => {
  const mock = auth();
  assert.equal((await mock.handler(event({ action: 'updatePassword', password: 'test-only-password' }))).statusCode, 401);
  assert.equal(mock.state.updates, 0);
});

function browser(hash, options = {}) {
  const state = { requests: [], storage: options.stored ? { 'hn-auth': JSON.stringify(options.stored) } : {}, replacements: [] };
  const nodes = {};
  for (const id of ['resetForm', 'resetDone', 'resetInvalid', 'resetError', 'resetPassword', 'resetSubmit']) {
    nodes[id] = { style: { display: 'none' }, classList: { add() {} }, value: 'test-only-new-password', addEventListener(name, fn) { this[name] = fn; } };
  }
  const location = { hash, pathname: options.account ? '/account.html' : '/reset.html', search: '' };
  const document = { getElementById: id => options.account ? null : nodes[id], addEventListener() {}, dispatchEvent() {} };
  const window = {
    location, HN: { api: () => '/api/auth' },
    history: { replaceState(_, __, url) { state.replacements.push(url); location.hash = ''; } },
    localStorage: { getItem: key => state.storage[key] || null, setItem: (key, value) => { state.storage[key] = value; }, removeItem: key => { delete state.storage[key]; } }
  };
  const context = vm.createContext({
    window, document, URLSearchParams, Promise, CustomEvent: function () {},
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, request) => { state.requests.push({ url, request }); return { json: async () => ({ ok: true, user: { id: 'test-user' } }) }; }
  });
  vm.runInContext(fs.readFileSync('public/js/auth.js', 'utf8'), context);
  return { state, nodes, window, context };
}

test('le vrai ordre des scripts conserve le lien recovery pour reset.js sans session persistée', async () => {
  const mock = browser('#access_token=recovery-test-token&refresh_token=refresh-test-token&type=recovery', { stored: { access_token: 'old-test-session' } });
  await mock.window.HN_AUTH.ready;
  assert.equal(mock.state.requests.length, 0);
  assert.equal(mock.window.HN_AUTH.token(), '');
  vm.runInContext(fs.readFileSync('public/js/reset.js', 'utf8'), mock.context);
  assert.equal(mock.nodes.resetForm.style.display, 'flex');
  assert.equal(mock.window.location.hash, '');
  assert.deepEqual(mock.state.replacements, ['/reset.html']);
  assert.doesNotMatch(JSON.stringify(mock.state.storage), /recovery-test-token|refresh-test-token/);
  mock.nodes.resetForm.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mock.state.requests.length, 1);
  const { url, request } = mock.state.requests[0];
  assert.equal(url, '/api/auth');
  assert.equal(request.headers.Authorization, 'Bearer recovery-test-token');
  assert.deepEqual(JSON.parse(request.body), { action: 'updatePassword', password: 'test-only-new-password' });
  assert.equal(mock.nodes.resetDone.style.display, 'block');
});

test('un lien absent, expiré ou de mauvais type affiche le panneau invalide sans requête', async () => {
  for (const hash of ['', '#error=access_denied&type=recovery', '#access_token=test-only-token&type=signup']) {
    const mock = browser(hash);
    await mock.window.HN_AUTH.ready;
    vm.runInContext(fs.readFileSync('public/js/reset.js', 'utf8'), mock.context);
    assert.equal(mock.nodes.resetInvalid.style.display, 'block');
    assert.equal(mock.state.requests.length, 0);
    assert.equal(mock.window.location.hash, '');
  }
});

test('un mot de passe trop court est rejeté avant la requête', async () => {
  const mock = browser('#access_token=recovery-test-token&type=recovery');
  await mock.window.HN_AUTH.ready;
  vm.runInContext(fs.readFileSync('public/js/reset.js', 'utf8'), mock.context);
  mock.nodes.resetPassword.value = 'short';
  mock.nodes.resetForm.submit({ preventDefault() {} });
  assert.equal(mock.state.requests.length, 0);
  assert.equal(mock.nodes.resetError.style.display, 'block');
});

test('la confirmation normale continue à restaurer la session et nettoyer le fragment', async () => {
  const mock = browser('#access_token=confirmed-test-token&refresh_token=test-refresh&type=signup', { account: true });
  await mock.window.HN_AUTH.ready;
  assert.equal(mock.window.location.hash, '');
  assert.equal(mock.window.HN_AUTH.token(), 'confirmed-test-token');
  assert.equal(mock.state.requests.length, 1);
  assert.equal(mock.state.requests[0].request.headers.Authorization, 'Bearer confirmed-test-token');
});
