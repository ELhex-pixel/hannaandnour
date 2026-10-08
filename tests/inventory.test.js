const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

function apiMock(result = { data: { stock_after: 5 } }) {
  const module = { exports: {} }, calls = [];
  vm.runInNewContext(fs.readFileSync('netlify/functions/lib/admin-inventory.js', 'utf8'), { module, require: () => ({ json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }) }) });
  const sb = { rpc: async (name, args) => { calls.push({ name, args }); if (result instanceof Error) throw result; return result; } };
  return { run: (action, body) => module.exports.adminInventory(sb, action, body), calls };
}
const variantId = randomUUID(), operationId = randomUUID(), orderId = randomUUID(), itemId = randomUUID();
const adjustment = { operation_id: operationId, variant_id: variantId, mode: 'restock', quantity: 3, expected_stock: 2, reason: 'Arrivage réel' };

test('les ajustements envoient une seule RPC atomique et ne font aucun calcul de stock hors base', async () => {
  const mock = apiMock();
  assert.equal((await mock.run('adjustInventory', adjustment)).statusCode, 200);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].name, 'adjust_inventory');
  assert.deepEqual(JSON.parse(JSON.stringify(mock.calls[0].args)), { p_operation_id: operationId, p_variant_id: variantId, p_mode: 'restock', p_quantity: 3, p_expected_stock: 2, p_reason: 'Arrivage réel' });
});
test('les valeurs invalides et fractions sont refusées avant la RPC, y compris via le vieux scanner', async () => {
  for (const changes of [{ quantity: 1.5 }, { quantity: '3' }, { quantity: -1 }, { quantity: 0 }, { quantity: 1000001 }, { operation_id: 'invalid' }, { variant_id: null }, { expected_stock: null }, { expected_stock: -1 }, { mode: 'unknown' }, { reason: 'x' }, { reason: 'a'.repeat(301) }]) {
    const mock = apiMock();
    assert.equal((await mock.run('adjustInventory', { ...adjustment, ...changes })).statusCode, 400);
    assert.equal(mock.calls.length, 0);
  }
  const mock = apiMock();
  assert.equal((await mock.run('scanSetStock', { variant_id: variantId, qty: 20 })).statusCode, 400);
  assert.equal(mock.calls.length, 0);
  assert.equal((await mock.run('scanSetStock', { ...adjustment, qty: 0 })).statusCode, 200);
  assert.equal(mock.calls[0].args.p_mode, 'count');
});
test('les conflits sont explicites et les erreurs fournisseur ne sont pas exposées', async () => {
  const stale = apiMock({ error: { message: 'inventory_stock_changed' } });
  const response = await stale.run('adjustInventory', adjustment);
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.parse(response.body).code, 'inventory_stock_changed');
  for (const result of [{ error: { message: 'private-test-value' } }, new Error('private-test-value'), { data: null }]) {
    const mock = apiMock(result);
    const error = await mock.run('adjustInventory', adjustment);
    assert.equal(error.statusCode, 503);
    assert(!error.body.includes('private-test-value'));
  }
});
test('la préparation ne fait que les RPC de contrôle, sans paiement, email ou stock', async () => {
  const mock = apiMock({ data: { quantity: 2 } });
  assert.equal((await mock.run('setPreparationQuantity', { order_id: orderId, item_id: itemId, quantity: 2, expected_quantity: 1 })).statusCode, 200);
  assert.equal(mock.calls[0].name, 'set_preparation_quantity');
  assert.equal((await mock.run('completePreparation', { order_id: orderId })).statusCode, 200);
  assert.equal(mock.calls[1].name, 'complete_preparation');
  assert.equal((await mock.run('setPreparationQuantity', { order_id: orderId, item_id: itemId, quantity: 2.1, expected_quantity: 1 })).statusCode, 400);
  assert.equal(mock.calls.length, 2);
});

function inventoryEditor(adjust) {
  const nodes = {}, listeners = {}, storage = new Map();
  const state = { token:'fixture-token',calls:[],stock:18,present:true,confirms:[] };
  const node = id => nodes[id] || (nodes[id] = { value:'',textContent:'',hidden:false,disabled:false,handlers:{},addEventListener(name,handler) { this.handlers[name]=handler; },querySelectorAll:()=>[],reset() {},focus() {},scrollIntoView() {} });
  node('inventoryFilter').value='active';
  const api = { token:()=>state.token,call:async (action,body) => {
    if (action==='listProducts') return { products:state.present?[{ name_fr:'Fixture locale',variants:[{ id:variantId,stock:state.stock,color:'Vin',size:'M' }] }]:[] };
    if (action==='listInventoryAdjustments') return { adjustments:[] };
    assert.equal(action,'adjustInventory');
    state.calls.push({ ...body });
    if (adjust) return adjust(body,state);
    const before=state.stock;
    state.stock=body.mode==='restock'?before+body.quantity:body.mode==='remove'?before-body.quantity:body.quantity;
    return { result:{ operation_id:body.operation_id,stock_before:before,stock_after:state.stock } };
  } };
  const context = { window:{ HN_ADMIN:api,crypto:{ randomUUID } },document:{ getElementById:node,querySelector:node,addEventListener(name,handler) { listeners[name]=handler; } },sessionStorage:{ getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key) },confirm:message=>{ state.confirms.push(message); return true; } };
  const source=fs.readFileSync('public/js/admin-features.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf("(function () {\n  'use strict';\n  var api = window.HN_ADMIN;")),context);
  return { nodes,state,storage,listeners,load:()=>node('refreshInventory').handlers.click(),pick:()=>node('inventoryVariant').handlers.change.call({ value:variantId }),submit:()=>node('inventoryForm').handlers.submit({ preventDefault() {} }),input(mode,value) { node('inventoryMode').value=mode; node('inventoryMode').handlers.change(); node('inventoryQuantity').value=String(value); node('inventoryQuantity').handlers.input(); node('inventoryReason').value='Déstockage local'; } };
}
const settleInventory = () => new Promise(resolve=>setImmediate(resolve));
test('le stock exige un choix explicite et prévisualise ajout, retrait et correction sans écriture', async () => {
  const mock=inventoryEditor(); mock.load(); await settleInventory(); mock.pick();
  mock.input('',9); mock.submit();
  assert.equal(mock.state.calls.length,0);
  assert.equal(mock.nodes.saveInventory.disabled,true);
  for (const [mode,qty,after] of [['restock',9,27],['remove',9,9],['count',9,9],['count',0,0]]) {
    mock.input(mode,qty);
    assert.match(mock.nodes.inventoryPreview.textContent,new RegExp('→ '+after+' unité'));
    assert.equal(mock.state.calls.length,0);
  }
  mock.input('remove',19); mock.submit();
  assert.match(mock.nodes.inventoryPreview.textContent,/Retrait impossible/);
  assert.equal(mock.nodes.saveInventory.disabled,true);
  assert.equal(mock.state.calls.length,0);
});
test('une correction envoie le nouveau disponible, pas un arrivage, puis recharge la valeur confirmée', async () => {
  const mock=inventoryEditor(); mock.load(); await settleInventory(); mock.pick(); mock.input('count',9); mock.submit();
  await settleInventory();
  assert.equal(mock.state.calls[0].mode,'count');
  assert.equal(mock.state.calls[0].quantity,9);
  assert.equal(mock.state.calls[0].expected_stock,18);
  assert.match(mock.nodes.inventoryStatus.textContent,/18 → 9/);
  assert.match(mock.nodes.inventoryCurrent.textContent,/9 unité/);
  assert.equal(mock.storage.size,0);
});
test('une réponse perdue conserve la même opération et une réponse incorrecte ne confirme pas un faux stock', async () => {
  let first=true;
  const mock=inventoryEditor(async body=>{ if (first) { first=false; throw new Error('Réponse perdue locale'); } return { result:{ already:true,operation_id:body.operation_id,stock_before:18,stock_after:9 } }; });
  mock.load(); await settleInventory(); mock.pick(); mock.input('remove',9); mock.submit(); await settleInventory();
  assert.equal(mock.storage.size,1);
  mock.submit(); await settleInventory();
  assert.equal(mock.state.calls[0].operation_id,mock.state.calls[1].operation_id);
  assert.match(mock.nodes.inventoryStatus.textContent,/aucun double ajustement/);
  assert.equal(mock.storage.size,0);
  const bad=inventoryEditor(async()=>({ result:{ operation_id:'incorrect',stock_before:18,stock_after:9 } }));
  bad.load(); await settleInventory(); bad.pick(); bad.input('count',9); bad.submit(); await settleInventory();
  assert.equal(bad.storage.size,1);
  assert.match(bad.nodes.inventoryStatus.textContent,/Réponse incomplète/);
});
test('une variante disparue après actualisation ne laisse pas une ancienne quantité modifiable', async () => {
  const mock=inventoryEditor(); mock.load(); await settleInventory(); mock.pick(); mock.input('count',9);
  mock.state.present=false; mock.load(); await settleInventory(); mock.submit();
  assert.equal(mock.state.calls.length,0);
  assert.equal(mock.nodes.inventoryVariant.value,'');
  assert.equal(mock.nodes.saveInventory.disabled,true);
});
test('ouvrir le gestionnaire sans variante précise efface un ancien choix sans écrire', async () => {
  const mock=inventoryEditor();mock.load();await settleInventory();mock.pick();mock.input('count',9);
  mock.listeners['hn:inventory-variant']({detail:''});await settleInventory();mock.submit();
  assert.equal(mock.nodes.inventoryVariant.value,'');
  assert.equal(mock.state.calls.length,0);
  assert.equal(mock.nodes.saveInventory.disabled,true);
});

test('base locale : ajustements idempotents, comptages protégés et préparation persistante sans double stock', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const migrations = ['schema.sql', 'migration_variants_admin.sql', 'rls_accounts.sql', 'migration_promos_refunds.sql', 'migration_relance_analytics.sql', 'migration_blog_story.sql', 'migration_demo_reviews_home.sql', 'migration_order_cancel.sql', 'migration_promo_single_use.sql', 'migration_order_returns.sql', 'migration_guest_reviews.sql', 'migration_pending_order_lifecycle.sql', 'migration_barcode_scan.sql', 'migration_integrity_features.sql', 'migration_admin_inventory.sql'];
    for (const file of migrations) await db.exec(fs.readFileSync('supabase/' + file, 'utf8').replace(/create extension if not exists pgcrypto;/gi, ''));
    await db.exec(fs.readFileSync('supabase/migration_admin_inventory.sql', 'utf8'));
    assert.equal((await db.query('select admin_inventory_schema_version() as version')).rows[0].version, 1);
    const product = randomUUID(), variant = randomUUID();
    await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image) values($1,'inventory-test','TEST','Jacket','Veste','سترة','','','',1000,'jacket','images/hero.jpg')", [product]);
    await db.query("insert into product_variants(id,product_id,color,size,stock) values($1,$2,'Noir','M',2)", [variant, product]);
    const stock = async () => (await db.query('select stock from product_variants where id=$1', [variant])).rows[0].stock;
    const adjust = async (id, mode, qty, expected, reason = 'Test local') => (await db.query('select adjust_inventory($1,$2,$3,$4,$5,$6) as result', [id, variant, mode, qty, expected, reason])).rows[0].result;
    const first = randomUUID();
    assert.equal((await adjust(first, 'restock', 3, 2)).stock_after, 5);
    assert.equal((await adjust(first, 'restock', 3, 2)).already, true);
    assert.equal(await stock(), 5);
    await assert.rejects(adjust(first, 'restock', 4, 2), /inventory_operation_mismatch/);
    await assert.rejects(adjust(randomUUID(), 'remove', 6, 5), /inventory_stock_bounds/);
    await assert.rejects(adjust(randomUUID(), 'count', 100, 4), /inventory_stock_changed/);
    assert.equal(await stock(), 5);
    const second = randomUUID();
    assert.equal((await adjust(second, 'remove', 2, 5)).stock_after, 3);
    assert.equal((await adjust(first, 'restock', 3, 2)).stock_after, 5);
    assert.equal(await stock(), 3);
    await adjust(randomUUID(), 'restock', 2, 5);
    assert.equal(await stock(), 5);
    assert.equal((await db.query('select count(*)::integer as n from inventory_adjustments')).rows[0].n, 3);
    await db.query("update products set name_fr='Autre nom' where id=$1", [product]);
    assert.equal((await db.query('select product_name from inventory_adjustments where id=$1', [first])).rows[0].product_name, 'Veste');

    const order = randomUUID(), item = randomUUID();
    await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,total_cents,currency) values($1,'HN-LOCAL','fixture@example.test','Local','Local','Paris','','75000','FR','standard',5000,'eur')", [order]);
    await db.query("insert into order_items(id,order_id,product_id,product_slug,product_name,image,quantity,unit_price_cents,variant_id) values($1,$2,$3,'inventory-test','Veste','images/hero.jpg',5,1000,$4)", [item, order, product, variant]);
    const set = async (qty, expected) => (await db.query('select set_preparation_quantity($1,$2,$3,$4) as result', [order, item, qty, expected])).rows[0].result;
    await assert.rejects(set(1, 0), /preparation_order_unavailable/);
    await db.query('select reserve_order($1)', [order]);
    await assert.rejects(adjust(randomUUID(), 'count', 50, 5), /inventory_stock_changed/);
    await db.query("select finalize_order_payment($1,'cs_local',5000,'eur','pi_local')", [order]);
    assert.equal(await stock(), 0);
    assert.equal((await set(2, 0)).quantity, 2);
    assert.equal((await set(2, 0)).already, true);
    await assert.rejects(set(3, 0), /preparation_changed/);
    await assert.rejects(set(6, 2), /preparation_quantity_invalid/);
    await assert.rejects(db.query('select complete_preparation($1)', [order]), /preparation_incomplete/);
    await set(5, 2);
    const completed = (await db.query('select complete_preparation($1) as result', [order])).rows[0].result;
    const repeated = (await db.query('select complete_preparation($1) as result', [order])).rows[0].result;
    assert.equal(repeated.already, true);
    assert.equal(repeated.prepared_at, completed.prepared_at);
    assert.equal(await stock(), 0);
    const stored = (await db.query('select shipping_status,shipped_at,prepared_at from orders where id=$1', [order])).rows[0];
    assert.equal(stored.shipping_status, 'new');
    assert.equal(stored.shipped_at, null);
    assert(stored.prepared_at);
    await set(0, 5);
    assert.equal((await db.query('select prepared_at from orders where id=$1', [order])).rows[0].prepared_at, null);
    for (const change of ["stock_issue=true", "refunded_cents=1", "shipping_status='shipped'", "admin_archived=true", "status='cancelled'"]) {
      await db.query('update orders set ' + change + ' where id=$1', [order]);
      await assert.rejects(set(1, 0), /preparation_order_unavailable/);
      await assert.rejects(db.query('select complete_preparation($1)', [order]), /preparation_order_unavailable/);
      await db.query("update orders set stock_issue=false,refunded_cents=0,shipping_status='new',admin_archived=false,status='paid' where id=$1", [order]);
    }
    assert.equal(await stock(), 0);
    const concurrentId = randomUUID();
    const duplicates = await Promise.all([adjust(concurrentId, 'restock', 1, 0), adjust(concurrentId, 'restock', 1, 0)]);
    assert.equal(duplicates.filter(result => result.already).length, 1);
    assert.equal(await stock(), 1);
    for (const role of ['anon', 'authenticated']) {
      for (const fn of ['adjust_inventory(uuid,uuid,text,integer,integer,text)', 'set_preparation_quantity(uuid,uuid,integer,integer)', 'complete_preparation(uuid)', 'admin_inventory_schema_version()']) assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed', [role, fn])).rows[0].allowed, false);
      await db.exec('grant select,insert,update on inventory_adjustments to ' + role);
      await db.exec('set role ' + role);
      try {
        assert.equal((await db.query('select * from inventory_adjustments')).rows.length, 0);
        assert.equal((await db.query("update inventory_adjustments set reason='Unauthorized' where id=$1 returning id", [first])).rows.length, 0);
        await assert.rejects(db.query("insert into inventory_adjustments(id,variant_id,mode,quantity,expected_stock,stock_before,stock_after,reason,product_name,color,size) values($1,$2,'count',0,0,0,0,'Unauthorized','Test','','')", [randomUUID(), variant]));
      } finally { await db.exec('reset role'); }
    }
    assert.equal((await db.query("select relrowsecurity as enabled from pg_class where oid='inventory_adjustments'::regclass")).rows[0].enabled, true);
  } finally { await db.close(); }
});
