const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('la suppression locale protège stock et historique, est atomique et ne supprime aucun fichier photo', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const migrations = ['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql'];
    for (const name of migrations) await db.exec(fs.readFileSync('supabase/' + name, 'utf8').replace(/create extension if not exists pgcrypto;/gi, ''));
    const make = async (active = false, stock = 0) => {
      const id = randomUUID(), variant = randomUUID(), slug = 'local-' + id;
      await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image,active) values($1,$2,$2,'Local','Local','Local','','','',1000,'abaya','images/local.jpg',$3)", [id,slug,active]);
      await db.query("insert into product_variants(id,product_id,color,size,stock) values($1,$2,'Beige','M',$3)", [variant,id,stock]);
      return { id,variant,slug };
    };
    const order = randomUUID();
    await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method) values($1,'HN-LOCAL','fixture@example.test','Local','Local','Paris','','75000','FR','standard')",[order]);
    const orphan = randomUUID();
    await db.query("insert into order_items(order_id,product_id,product_slug,product_name,unit_price_cents,quantity) values($1,$2,'legacy-missing','Local',1000,1)",[order,orphan]);
    const migration = fs.readFileSync('supabase/migration_catalog_cleanup.sql','utf8');
    await assert.rejects(db.exec(migration.replace(/commit;\s*$/, 'select 1/0; commit;')), /division by zero/);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regprocedure('admin_catalog_schema_version()') as marker")).rows[0].marker,null);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec('grant usage on schema public to service_role; grant select,insert,update,delete on products,product_variants,order_items,reviews to service_role;');
    assert.equal((await db.query('select admin_catalog_schema_version() as version')).rows[0].version,1);
    assert.equal((await db.query('select count(*)::integer as n from order_items where product_id=$1',[orphan])).rows[0].n,1);
    const purge = async (ids, confirmation = 'SUPPRIMER') => (await db.query('select purge_unused_products($1::uuid[],$2) as result',[ids,confirmation])).rows[0].result;
    const exists = async id => (await db.query('select count(*)::integer as n from products where id=$1',[id])).rows[0].n;
    const unused = await make(), active = await make(true), stocked = await make(false,18);
    for (const ids of [[],null,[null],Array(101).fill(unused.id)]) await assert.rejects(purge(ids),/product_delete_invalid/);
    await assert.rejects(purge([unused.id],'oui'),/product_delete_invalid/);
    await assert.rejects(purge([unused.id,active.id]),/product_delete_active/);
    await assert.rejects(purge([unused.id,stocked.id]),/product_delete_stock/);
    assert.equal(await exists(unused.id),1);
    assert.equal((await db.query('select stock from product_variants where id=$1',[stocked.variant])).rows[0].stock,18);
    for (const kind of ['product','variant','slug','review','inventory','cost','cost_history']) {
      const p = await make();
      if (['product','variant','slug'].includes(kind)) await db.query("insert into order_items(order_id,product_id,variant_id,product_slug,product_name,unit_price_cents,quantity) values($1,$2,$3,$4,'Local',1000,1)",[order,kind==='product'?p.id:null,kind==='variant'?p.variant:null,kind==='slug'?p.slug:'other-local']);
      if (kind==='review') await db.query("insert into reviews(product_id,author_name,rating,body) values($1,'Local',5,'Local')",[p.id]);
      if (kind==='inventory') await db.query("select adjust_inventory($1,$2,'count',0,0,'Test local')",[randomUUID(),p.variant]);
      if (kind==='cost') await db.query("insert into variant_costs(variant_id,unit_cost_cents,currency) values($1,0,'eur')",[p.variant]);
      if (kind==='cost_history') await db.query("insert into variant_cost_history(variant_id,unit_cost_cents,currency,reason) values($1,0,'eur','Test local')",[p.variant]);
      await assert.rejects(purge([unused.id,p.id]),/product_delete_history/);
      assert.equal(await exists(unused.id),1);
      assert.equal(await exists(p.id),1);
      if (kind==='product' || kind==='variant') await assert.rejects(db.query('delete from products where id=$1',[p.id]),/foreign key constraint/);
    }
    for (const role of ['anon','authenticated']) {
      for (const signature of ['purge_unused_products(uuid[],text)','admin_catalog_schema_version()']) assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed',[role,signature])).rows[0].allowed,false);
      await db.exec('set role '+role);
      try { await assert.rejects(purge([unused.id]),/permission denied/); } finally { await db.exec('reset role'); }
    }
    assert.equal((await db.query("select prosecdef from pg_proc where oid='purge_unused_products(uuid[],text)'::regprocedure")).rows[0].prosecdef,false);
    await db.exec('set role service_role');
    let results;
    try { results = await Promise.all([purge([unused.id,unused.id]),purge([unused.id])]); } finally { await db.exec('reset role'); }
    assert.equal(results.reduce((sum,r)=>sum+r.deleted_ids.length,0),1);
    assert.equal(results.reduce((sum,r)=>sum+r.missing_ids.length,0),1);
    assert.equal(await exists(unused.id),0);
    await assert.rejects(db.query("insert into order_items(order_id,product_id,product_slug,product_name,unit_price_cents,quantity) values($1,$2,'missing-local','Local',1000,1)",[order,unused.id]),/foreign key constraint/);
    assert(!migration.includes('storage.objects'));
  } finally { await db.close(); }
});
