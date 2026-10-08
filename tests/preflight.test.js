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
  assert.deepEqual(tables, ['orders', 'order_items', 'return_requests', 'order_returns', 'variant_costs', 'variant_cost_history', 'order_item_costs', 'products', 'inventory_adjustments', 'inventory_journal_resets', 'inventory_journal_archives']);
});
test('le marqueur du lot stock/préparation est obligatoire avant publication', async () => {
  const calls = [];
  await assert.rejects(preflight(env, { rpc: async name => { calls.push(name); return name === 'commerce_schema_version' ? { data: 1 } : { error: { code: 'PGRST202' } }; } }), /migration_admin_inventory/);
  assert.deepEqual(calls, ['commerce_schema_version', 'admin_inventory_schema_version']);
});
test('le marqueur retours/coûts est obligatoire et n’exécute aucune migration',async () => {
  const calls = [];
  await assert.rejects(preflight(env,{ rpc:async name => { calls.push(name); return name === 'admin_operations_schema_version' ? { error:{} } : { data:1 }; } }),/migration_admin_operations/);
  assert.deepEqual(calls,['commerce_schema_version','admin_inventory_schema_version','admin_operations_schema_version']);
});
test('la nouvelle saisie de retours exige sa migration avant toute publication', async () => {
  const calls = [];
  await assert.rejects(preflight(env, { rpc: async name => { calls.push(name); return name === 'return_policy_editor_schema_version' ? { error: {} } : { data: 1 }; } }), /migration_return_policy_editor/);
  assert.deepEqual(calls, ['commerce_schema_version', 'admin_inventory_schema_version', 'admin_operations_schema_version', 'return_policy_editor_schema_version']);
});
test('la suppression de catalogue exige sa migration sans exécuter de suppression', async () => {
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{ calls.push(name); return name==='admin_catalog_schema_version'?{error:{}}:{data:1}; }}),/migration_catalog_cleanup/);
  assert.deepEqual(calls,['commerce_schema_version','admin_inventory_schema_version','admin_operations_schema_version','return_policy_editor_schema_version','admin_catalog_schema_version']);
});
test('réinitialiser le journal exige sa migration privée sans archiver pendant le build', async () => {
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{ calls.push(name); return name==='inventory_journal_schema_version'?{error:{}}:{data:1}; }}),/migration_inventory_journal/);
  assert.deepEqual(calls,['commerce_schema_version','admin_inventory_schema_version','admin_operations_schema_version','return_policy_editor_schema_version','admin_catalog_schema_version','inventory_journal_schema_version']);
});
