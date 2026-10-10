const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function blog(response) {
  const exports = {}, state = { calls: 0, active: false, selected: '' };
  const query = {
    select(fields) { state.selected = fields; return this; },
    eq(key, value) { if (key === 'active') state.active = value; return this; },
    order() { return this; }, maybeSingle() { return this; }, abortSignal() { return this; },
    then(resolve, reject) { state.calls++; return Promise.resolve(response).then(resolve, reject); }
  };
  const shared = { json: require('../netlify/functions/shared').json, isConfigured: () => true, getSupabase: () => ({ from: table => { assert.equal(table, 'blog_posts'); return query; } }) };
  vm.runInNewContext(fs.readFileSync('netlify/functions/blog.js', 'utf8'), {
    exports, console: { warn() {} }, require: name => name === './shared' ? shared : name === './lib/public-read' ? require('../netlify/functions/lib/public-read') : name === './lib/brand-copy' ? require('../netlify/functions/lib/brand-copy') : require('../public/js/content')
  });
  return { handler: exports.handler, state };
}
test('un article absent est distingué d’une panne du service sans exposer les erreurs privées', async () => {
  const missing = blog({ data: null, error: null });
  const result = await missing.handler({ httpMethod: 'GET', queryStringParameters: { slug: 'absent' } });
  assert.equal(result.statusCode, 200); assert.deepEqual(JSON.parse(result.body), { post: null });
  assert.equal(missing.state.active, true);
  const failure = blog({ status: 503, error: { code: 'PGRST002', message: 'private credentials' } });
  const response = await failure.handler({ httpMethod: 'GET' });
  assert.equal(response.statusCode, 503); assert.equal(failure.state.calls, 2);
  assert.doesNotMatch(response.body, /private|credentials/);
});
test('la liste du blog ne lit que les champs publics et refuse un slug invalide avant la base', async () => {
  const mock = blog({ data: [{ slug: 'article', title: 'Article' }], error: null });
  assert.equal((await mock.handler({ httpMethod: 'GET' })).statusCode, 200);
  assert.equal(mock.state.active, true); assert.doesNotMatch(mock.state.selected, /\*|email|user_id/);
  const invalid = blog({ data: [], error: null });
  assert.equal((await invalid.handler({ httpMethod: 'GET', queryStringParameters: { slug: '../private' } })).statusCode, 400);
  assert.equal(invalid.state.calls, 0);
});
