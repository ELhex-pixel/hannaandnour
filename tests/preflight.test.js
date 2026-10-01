const test = require('node:test');
const assert = require('node:assert/strict');
const { preflight } = require('../scripts/preflight');
const env = { NETLIFY: 'true', CONTEXT: 'production', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only' };

test('le build local sans environnement Netlify ne contacte aucune base', async () => {
  await preflight({}, { rpc() { throw new Error('Unexpected request'); } });
});
test('un build Netlify sans configuration serveur ne publie pas', async () => {
  await assert.rejects(preflight({ NETLIFY: 'true', CONTEXT: 'production' }), /Publication bloquée/);
});
test('une migration manquante bloque la publication sans écriture', async () => {
  let called = '';
  await assert.rejects(preflight(env, { rpc: async name => { called = name; return { error: { code: 'PGRST202' } }; } }), /migration_integrity_features/);
  assert.equal(called, 'commerce_schema_version');
});
test('un schéma incomplet bloque la publication même si le marqueur existe', async () => {
  await assert.rejects(preflight(env, { rpc: async () => ({ data: 1 }), from: () => ({ select: () => ({ limit: async () => ({ error: { code: '42703' } }) }) }) }), /Publication bloquée/);
});
test('un schéma à jour autorise la publication après des lectures seules', async () => {
  const tables = [];
  await preflight(env, { rpc: async () => ({ data: 1 }), from: table => { tables.push(table); return { select: () => ({ limit: async count => { assert.equal(count, 0); return { error: null }; } }) }; } });
  assert.deepEqual(tables, ['orders', 'order_items', 'return_requests', 'products']);
});
