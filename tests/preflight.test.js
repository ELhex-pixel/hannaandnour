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
  assert.deepEqual(tables, ['promo_codes', 'orders', 'order_payment_captures', 'order_items', 'return_requests', 'order_returns', 'variant_costs', 'variant_cost_history', 'order_item_costs', 'products', 'inventory_adjustments', 'inventory_journal_resets', 'inventory_journal_archives', 'order_refund_operations','physical_sale_operations','admin_maintenance_operations','admin_activity_periods','order_shipping_operations','blog_posts','blog_submissions','blog_submission_decisions','blog_editorial_backups']);
});
test('les remboursements exigent leur journal privé avant publication, sans migration automatique', async () => {
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='admin_refunds_schema_version'?{error:{}}:{data:1};}}),/migration_partial_refunds/);
  assert.equal(calls.at(-1),'admin_refunds_schema_version');
});
test('les catégories étendues exigent leur migration avant publication sans modifier la base',async()=>{
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='catalog_categories_schema_version'?{error:{}}:{data:1};}}),/migration_catalog_categories/);
  assert.equal(calls.at(-1),'catalog_categories_schema_version');
});
test('la suppression du catalogue exige sa migration privée avant publication, sans supprimer de fiche', async () => {
  const calls = [];
  await assert.rejects(preflight(env, { rpc: async name => { calls.push(name); return name === 'product_catalog_deletion_schema_version' ? { error: {} } : { data: 1 }; } }), /migration_catalog_return_cleanup/);
  assert.equal(calls.at(-1), 'product_catalog_deletion_schema_version');
});
test('les listes de retours exigent leur migration avant publication sans modifier un retour',async()=>{
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='return_lists_schema_version'?{error:{}}:{data:1};}}),/migration_catalog_return_cleanup/);
  assert.equal(calls.at(-1),'return_lists_schema_version');
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
test('les ventes physiques exigent leur transaction privée avant publication sans exécuter de vente',async()=>{
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='physical_sales_schema_version'?{error:{}}:{data:1};}}),/migration_physical_sales/);
  assert.equal(calls.at(-1),'physical_sales_schema_version');
});
test('les commandes de maintenance exigent leur migration sans déclencher de remise à zéro',async()=>{
  const calls=[];await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='admin_maintenance_schema_version'?{error:{}}:{data:1};}}),/migration_admin_maintenance/);assert.equal(calls.at(-1),'admin_maintenance_schema_version');
});
test('les prix personnalisés exigent leurs snapshots avant publication, sans modifier une vente',async()=>{
  const calls=[];await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='physical_prices_schema_version'?{error:{}}:{data:1};}}),/migration_physical_prices/);assert.equal(calls.at(-1),'physical_prices_schema_version');
});
test('les relais du checkout exigent leur snapshot avant publication, sans changer de commande',async()=>{
  const calls=[];await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='checkout_pickup_schema_version'?{error:{}}:{data:1};}}),/migration_checkout_pickup/);assert.equal(calls.at(-1),'checkout_pickup_schema_version');
});
test('les périodes communes exigent leur journal privé avant publication sans lancer de remise à zéro',async()=>{
  const calls=[];await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='activity_periods_schema_version'?{error:{}}:{data:1};}}),/migration_activity_periods/);assert.equal(calls.at(-1),'activity_periods_schema_version');
});
test('les étiquettes exigent leur journal avant publication sans affranchissement réel',async()=>{
  const calls=[];await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='order_shipping_schema_version'?{error:{}}:{data:1};}}),/migration_order_shipping/);assert.equal(calls.at(-1),'order_shipping_schema_version');
});
test('les propositions du journal exigent la migration privée avant publication sans publier de texte client',async()=>{
  const calls=[];await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='blog_community_schema_version'?{error:{}}:{data:1};}}),/migration_blog_community/);assert.equal(calls.at(-1),'blog_community_schema_version');
});
test('le stock après autorisation exige son journal privé avant publication sans capturer de paiement',async()=>{
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='authorized_checkout_schema_version'?{error:{}}:{data:1};}}),/migration_authorized_checkout/);
  assert.equal(calls.at(-1),'authorized_checkout_schema_version');
});
test('la limite promo par client exige sa migration et sa colonne avant publication, sans écriture',async()=>{
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='promo_customer_limits_schema_version'?{error:{}}:{data:1};}}),/migration_promo_customer_limits/);
  assert.equal(calls.at(-1),'promo_customer_limits_schema_version');
  await assert.rejects(preflight(env,{rpc:async()=>({data:1}),from:table=>({select:columns=>({limit:async()=>({error:table==='promo_codes'&&columns==='max_uses_per_customer'?{code:'42703'}:null})})})}),/migration_promo_customer_limits/);
});
test('les nouveaux pays relais exigent la migration des snapshots avant publication, sans changer de commande',async()=>{
  const calls=[];
  await assert.rejects(preflight(env,{rpc:async name=>{calls.push(name);return name==='shipping_country_rules_schema_version'?{error:{}}:{data:1};}}),/migration_shipping_country_rules/);
  assert.equal(calls.at(-1),'shipping_country_rules_schema_version');
});
