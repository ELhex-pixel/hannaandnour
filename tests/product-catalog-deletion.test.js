const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { deleteProductsFromCatalog } = require('../netlify/functions/lib/product-catalog-deletion');

test('base locale : retirer une fiche avec stock et archives conserve les commandes et tout son historique', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const migrations = ['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql','migration_catalog_cleanup.sql','migration_inventory_journal.sql','migration_partial_refunds.sql','migration_catalog_categories.sql'];
    for (const file of migrations) await db.exec(fs.readFileSync('supabase/' + file, 'utf8').replace(/create extension if not exists pgcrypto;/gi, ''));
    async function product(active = true, stock = 5, managed = true) {
      const id = crypto.randomUUID(), variant = crypto.randomUUID(), slug = 'test-' + id;
      await db.query("insert into products(id,sku,slug,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image,active) values($1,$2,$2,'Test','Cape test','Test','','','',2000,'cape','images/test.jpg',$3)", [id, slug, active]);
      if (managed) await db.query("insert into product_variants(id,product_id,color,size,stock,barcode) values($1,$2,'Vin','Unique',$3,$4)", [variant, id, stock, 'HN-' + id]);
      return { id, variant: managed ? variant : null, slug };
    }
    async function order(p, promo = null) {
      const id = crypto.randomUUID();
      await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,currency,total_cents,promo_code) values($1,$2,'client@example.test','Test','Rue test','Paris','','75000','FR','standard','eur',4000,$3)", [id, 'HN-' + id, promo]);
      await db.query("insert into order_items(order_id,product_id,variant_id,product_slug,product_name,unit_price_cents,quantity,net_total_cents) values($1,$2,$3,$4,'Cape test',2000,2,4000)", [id, p.id, p.variant, p.slug]);
      return id;
    }
    const p = await product(), archived = await product(false, 0);
    const historicalOrder = await order(p);
    await db.query("insert into reviews(product_id,author_name,rating,body) values($1,'Test',5,'Avis test')", [p.id]);
    await db.query("select adjust_inventory($1,$2,'count',5,5,'Comptage historique')", [crypto.randomUUID(), p.variant]);
    await db.query("select reset_inventory_journal($1,'REINITIALISER')", [crypto.randomUUID()]);
    await db.query("insert into variant_costs(variant_id,unit_cost_cents,currency) values($1,0,'eur')", [p.variant]);
    await db.query("insert into variant_cost_history(variant_id,unit_cost_cents,currency,reason) values($1,1000,'eur','Coût historique')", [p.variant]);
    const tables = ['orders','order_items','reviews','inventory_adjustments','inventory_journal_archives','variant_costs','variant_cost_history'];
    async function snapshots() {
      const values = {};
      for (const table of tables) values[table] = (await db.query('select * from ' + table + ' order by ' + (table === 'variant_costs' ? 'variant_id' : table === 'inventory_journal_archives' ? 'adjustment_id' : 'id'))).rows;
      return values;
    }
    const before = await snapshots();
    const sql = fs.readFileSync('supabase/migration_catalog_return_cleanup.sql', 'utf8');
    await assert.rejects(db.exec(sql.replace(/commit;\s*$/, 'select 1/0;commit;')), /division by zero/);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regprocedure('product_catalog_deletion_schema_version()') as marker")).rows[0].marker, null);
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query('select catalog_deleted_at from products where id=$1', [p.id])).rows[0].catalog_deleted_at, null);
    assert.deepEqual(await snapshots(), before);
    const remove = async (ids, confirmation = 'SUPPRIMER') => (await db.query('select delete_products_from_catalog($1::uuid[],$2) as result', [ids, confirmation])).rows[0].result;
    for (const ids of [[], null, [null], Array(101).fill(p.id)]) await assert.rejects(remove(ids), /product_catalog_delete_invalid/);
    await assert.rejects(remove([p.id], 'oui'), /product_catalog_delete_invalid/);
    const missing = crypto.randomUUID();
    await db.exec('grant usage on schema public to service_role;grant select,update on products,product_variants to service_role;set role service_role;');
    const result = await remove([p.id, p.id, archived.id, missing]);
    await db.exec('reset role');
    assert.deepEqual(result.deleted_ids.slice().sort(), [p.id, archived.id].sort()); assert.deepEqual(result.missing_ids, [missing]);
    assert.equal((await db.query('select count(*)::int as n from products where id=any($1::uuid[]) and catalog_deleted_at is null', [[p.id, archived.id]])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from products where active and id=any($1::uuid[])', [[p.id, archived.id]])).rows[0].n, 0);
    const first = (await db.query('select * from products where id=$1', [p.id])).rows[0];
    assert(first.catalog_deleted_at); assert.equal(first.active, false); assert.equal(first.image, 'images/test.jpg');
    assert.deepEqual(await snapshots(), before);
    const v = (await db.query('select stock,active from product_variants where id=$1', [p.variant])).rows[0];
    assert.deepEqual(v, { stock: 5, active: false });
    await remove([p.id]);
    assert.deepEqual((await db.query('select * from products where id=$1', [p.id])).rows[0], first);
    await assert.rejects(db.query('update products set active=true where id=$1', [p.id]), /products_catalog_deleted_visibility_check/);
    await assert.rejects(db.query('update product_variants set active=true where id=$1', [p.variant]), /product_catalog_deleted/);
    await assert.rejects(db.query("insert into product_variants(product_id,color,size,stock) values($1,'Noir','M',3)", [p.id]), /product_catalog_deleted/);
    await assert.rejects(db.query('select save_product_variants($1,$2)', [p.id, JSON.stringify([{ color: 'Vin', size: 'Unique', stock: 5, expected_stock: 5, active: true, barcode: 'NEW' }])]), /product_catalog_deleted/);
    assert.equal((await db.query('select stock from product_variants where id=$1', [p.variant])).rows[0].stock, 5);
    // A quote started before catalogue removal must not reserve stock or consume
    // a promo. Legacy cards without variants are protected as well.
    await db.query("insert into promo_codes(code,percent_off,active,single_use) values('LOCAL',10,true,true)");
    const legacy = await product(true, 0, false), legacyOrder = await order(legacy, 'LOCAL');
    await remove([legacy.id]);
    assert.equal((await db.query('select reserve_order($1) as reserved', [legacyOrder])).rows[0].reserved, false);
    assert.equal((await db.query('select reserve_order($1) as reserved', [historicalOrder])).rows[0].reserved, false);
    assert.equal((await db.query("select used_count from promo_codes where code='LOCAL'")).rows[0].used_count, 0);
    // Already accepted reservations still complete normally, without a second
    // debit; cancellation can restore their physical units on the old variant.
    const accepted = await product(true, 5), acceptedOrder = await order(accepted, 'LOCAL');
    assert.equal((await db.query('select reserve_order($1) as reserved', [acceptedOrder])).rows[0].reserved, true);
    await remove([accepted.id]);
    assert.equal((await db.query('select reserve_order($1) as reserved', [acceptedOrder])).rows[0].reserved, true);
    assert.equal((await db.query('select stock from product_variants where id=$1', [accepted.variant])).rows[0].stock, 3);
    await db.query("select finalize_order_payment($1,'cs_local',4000,'eur','pi_local')", [acceptedOrder]);
    assert.equal((await db.query('select status,stock_issue from orders where id=$1', [acceptedOrder])).rows[0].status, 'paid');
    assert.equal((await db.query('select stock from product_variants where id=$1', [accepted.variant])).rows[0].stock, 3);
    await db.query("select adjust_inventory($1,$2,'restock',1,3,'Arrivage sur référence historique')", [crypto.randomUUID(), accepted.variant]);
    assert.deepEqual((await db.query('select stock,active from product_variants where id=$1', [accepted.variant])).rows[0], { stock: 4, active: false });
    for (const role of ['anon','authenticated']) {
      for (const signature of ['delete_products_from_catalog(uuid[],text)','product_catalog_deletion_schema_version()']) assert.equal((await db.query("select has_function_privilege($1,$2,'execute') as allowed", [role, signature])).rows[0].allowed, false);
    }
    assert.equal((await db.query('select product_catalog_deletion_schema_version() as version')).rows[0].version, 1);
    assert.equal((await db.query("select prosecdef from pg_proc where oid='delete_products_from_catalog(uuid[],text)'::regprocedure")).rows[0].prosecdef, false);
    assert(!sql.includes('storage.objects'));
  } finally { await db.close(); }
});

test('l’API utilise uniquement la RPC transactionnelle et refuse les résultats incomplets', async () => {
  const id = crypto.randomUUID(), calls = [];
  const sb = { rpc: async (name, body) => { calls.push({ name, body }); return { data: { deleted_ids: body.p_ids, missing_ids: [] } }; } };
  const response = await deleteProductsFromCatalog(sb, { ids: [id, id], confirmation: 'SUPPRIMER', stock: 0 });
  assert.equal(response.statusCode, 200); assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'delete_products_from_catalog'); assert.deepEqual(calls[0].body, { p_ids: [id], p_confirmation: 'SUPPRIMER' });
  for (const body of [{}, { ids: [id] }, { ids: [], confirmation: 'SUPPRIMER' }, { ids: ['bad'], confirmation: 'SUPPRIMER' }, { ids: Array(101).fill(id), confirmation: 'SUPPRIMER' }]) assert.equal((await deleteProductsFromCatalog(sb, body)).statusCode, 400);
  assert.equal(calls.length, 1);
  for (const result of [{ error: { message: 'private-provider-error' } }, { data: {} }, { data: { deleted_ids: [], missing_ids: [] } }, { data: { deleted_ids: [id], missing_ids: [id] } }]) {
    const failed = await deleteProductsFromCatalog({ rpc: async () => result }, { ids: [id], confirmation: 'SUPPRIMER' });
    assert.equal(failed.statusCode, 503); assert(!failed.body.includes('private-provider-error'));
  }
});

function admin() {
  const exports = {}, currentId = crypto.randomUUID(), removedId = crypto.randomUUID();
  const state = { allowed: true, limited: false, writes: [], rpcs: [], filters: [], products: [{ id: currentId, active: false, catalog_deleted_at: null, product_variants: [] }, { id: removedId, active: false, catalog_deleted_at: '2026-10-11T12:00:00Z', product_variants: [] }] };
  const sb = { from(table) {
    assert.equal(table, 'products'); const filters = []; let update = null;
    const query = { select() { return this; }, order() { return this; }, update(value) { update = value; return this; }, eq(field, value) { filters.push(p => p[field] === value); return this; }, in(field, ids) { filters.push(p => ids.includes(p[field])); return this; }, is(field, value) { state.filters.push([field, value]); filters.push(p => p[field] === value); return this; }, maybeSingle() { this.single = true; return this; }, then(resolve) {
      const rows = state.products.filter(p => filters.every(filter => filter(p)));
      if (update) { rows.forEach(p => Object.assign(p, update)); state.writes.push(...rows.map(p => p.id)); }
      resolve({ data: this.single ? rows[0] || null : rows, error: null });
    } }; return query;
  }, rpc: async (name, body) => { state.rpcs.push(name); return { data: { deleted_ids: body.p_ids, missing_ids: [] } }; } };
  const shared = { json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }), isConfigured: () => true, getSupabase: () => sb, readBody: event => JSON.parse(event.body), requireAdmin: async () => ({ ok: state.allowed }), rateLimit: async () => state.limited ? { statusCode: 429 } : null };
  vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js', 'utf8'), { exports, Buffer, process: { env: {} }, console: { error() {} }, require: name => name === './shared' ? shared : name === 'crypto' ? crypto : name === './lib/product-catalog-deletion' ? require('../netlify/functions/lib/product-catalog-deletion') : name === './lib/product-assistant' ? { categories: require('../public/js/categories').codes } : name === '../../public/js/product-media' ? require('../public/js/product-media') : class Stripe {} });
  return { state, currentId, removedId, run: body => exports.handler({ httpMethod: 'POST', body: JSON.stringify(body) }) };
}
test('les fiches supprimées sont exclues de la liste et ne peuvent pas être réactivées par un ancien formulaire', async () => {
  const mock = admin();
  const listed = JSON.parse((await mock.run({ action: 'listProducts' })).body);
  assert.deepEqual(listed.products.map(p => p.id), [mock.currentId]);
  const activated = await mock.run({ action: 'activateProducts', ids: [mock.currentId, mock.removedId] });
  assert.deepEqual(JSON.parse(activated.body).activated_ids, [mock.currentId]);
  const stale = await mock.run({ action: 'saveProduct', id: mock.removedId, name_en: 'Stale edit', category: 'cape', price_cents: 2000, active: true });
  assert.equal(stale.statusCode, 409); assert(!mock.state.writes.includes(mock.removedId));
  assert(mock.state.filters.every(filter => filter[0] === 'catalog_deleted_at' && filter[1] === null));
});
test('la suppression du catalogue exige la session et le quota avant la RPC', async () => {
  const mock = admin(), body = { action: 'deleteProductsFromCatalog', ids: [mock.currentId], confirmation: 'SUPPRIMER' };
  mock.state.allowed = false; assert.equal((await mock.run(body)).statusCode, 401);
  mock.state.allowed = true; mock.state.limited = true; assert.equal((await mock.run(body)).statusCode, 429);
  assert.equal(mock.state.rpcs.length, 0);
  mock.state.limited = false; assert.equal((await mock.run(body)).statusCode, 200);
  assert.deepEqual(mock.state.rpcs, ['delete_products_from_catalog']);
});
