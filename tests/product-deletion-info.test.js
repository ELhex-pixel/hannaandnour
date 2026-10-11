const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { productDeletionInfo, adminProductDeletionInfo } = require('../netlify/functions/lib/product-deletion-info');

// Translate the read-only PostgREST predicates to local SQL so the diagnostic
// can be compared to the actual purge RPC, including legacy null product IDs.
function split(value) {
  const result = []; let start = 0, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '(') depth++; else if (c === ')') depth--;
    if (c === ',' && depth === 0) { result.push(value.slice(start, i)); start = i + 1; }
  }
  result.push(value.slice(start)); return result;
}
function logic(value, args) {
  const group = value.match(/^(and|or)\((.*)\)$/);
  if (group) return '(' + split(group[2]).map(part => logic(part, args)).join(group[1] === 'and' ? ' and ' : ' or ') + ')';
  const leaf = value.match(/^(product_id|product_slug)\.(neq|eq|is)\.(.*)$/);
  assert(leaf, value);
  if (leaf[2] === 'is') { assert.equal(leaf[3], 'null'); return 't.' + leaf[1] + ' is null'; }
  args.push(leaf[3].startsWith('"') ? JSON.parse(leaf[3]) : leaf[3]);
  return 't.' + leaf[1] + (leaf[2] === 'neq' ? '<>' : '=') + '$' + args.length;
}
function reads(db, calls) {
  return { from(table) {
    const state = { table, fields: '', eq: [], neq: [], or: [], limit: null, single: false };
    calls.push(state);
    const query = {
      select(fields, options) { state.fields = fields; state.count = options?.count; return this; },
      eq(field, value) { state.eq.push([field, value]); return this; },
      neq(field, value) { state.neq.push([field, value]); return this; },
      or(value) { state.or.push(value); return this; }, order() { return this; },
      limit(value) { state.limit = value; return this; }, maybeSingle() { state.single = true; return this; },
      abortSignal(signal) { assert(signal instanceof AbortSignal); return this; },
      async then(resolve, reject) {
        try {
          const args = [], where = [], joined = state.fields.includes('!inner');
          const from = table + ' t' + (joined ? ' join product_variants v on v.id=t.variant_id' : '');
          for (const [field, value] of state.eq) { args.push(value); where.push((field.includes('.') ? 'v.product_id' : 't.' + field) + '=$' + args.length); }
          for (const [field, value] of state.neq) { args.push(value); where.push('t.' + field + '<>$' + args.length); }
          for (const value of state.or) where.push(logic('or(' + value + ')', args));
          const filter = where.length ? ' where ' + where.join(' and ') : '';
          let rows = (await db.query('select t.*' + (joined ? ",jsonb_build_object('product_id',v.product_id,'color',v.color,'size',v.size) as product_variants" : '') + ' from ' + from + filter + ' order by t.' + (table === 'variant_costs' ? 'variant_id' : 'id'), args)).rows;
          const count = rows.length;
          if (table === 'order_items') for (const row of rows) row.orders = (await db.query('select id,order_number,status,created_at from orders where id=$1', [row.order_id])).rows[0];
          if (state.single) rows = rows[0] || null; else rows = rows.slice(0, state.limit);
          resolve({ data: rows, count, error: null });
        } catch (error) { if (reject) reject(error); else throw error; }
      }
    }; return query;
  } };
}

test('le diagnostic correspond aux protections SQL et identifie chaque historique, sans aucune écriture', async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const migrations = ['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql','migration_catalog_cleanup.sql','migration_inventory_journal.sql'];
    for (const file of migrations) await db.exec(fs.readFileSync('supabase/' + file, 'utf8').replace(/create extension if not exists pgcrypto;/gi, ''));
    async function make(kind) {
      const id = randomUUID(), variant = randomUUID(), slug = 'test-' + id;
      await db.query("insert into products(id,sku,slug,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image,active) values($1,$2,$2,'Test','Cape test','Test','','','',2000,'jacket','images/test.jpg',$3)", [id, slug, kind === 'visibility']);
      return { id, variant, slug };
    }
    const order = randomUUID();
    await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,status) values($1,'HN-DIAGNOSTIC','private@example.test','Client privé','Adresse privée','Paris','','75000','FR','standard','paid')", [order]);
    const counts = new Map();
    for (const kind of ['none','visibility','stock','orders','reviews','adjustments','costs','cost_history']) {
      const p = await make(kind);
      await db.query("insert into product_variants(id,product_id,color,size,stock,active) values($1,$2,'Vin','Unique',$3,false)", [p.variant, p.id, kind === 'stock' ? 5 : 0]);
      if (kind === 'orders') {
        for (const link of ['all','product','slug','variant']) await db.query("insert into order_items(order_id,product_id,variant_id,product_slug,product_name,unit_price_cents,quantity) values($1,$2,$3,$4,'Cape',2000,1)", [order, ['all','product'].includes(link) ? p.id : null, ['all','variant'].includes(link) ? p.variant : null, link === 'variant' ? 'autre-slug' : p.slug]);
      }
      if (kind === 'reviews') for (let i = 0; i < 12; i++) await db.query("insert into reviews(product_id,author_name,rating,body,status) values($1,'Privé',5,'Texte privé','pending')", [p.id]);
      if (kind === 'adjustments') {
        await db.query("select adjust_inventory($1,$2,'count',0,0,'Correction test')", [randomUUID(), p.variant]);
        await db.query("select reset_inventory_journal($1,'REINITIALISER')", [randomUUID()]);
      }
      if (kind === 'costs') await db.query("insert into variant_costs(variant_id,unit_cost_cents,currency) values($1,0,'eur')", [p.variant]);
      if (kind === 'cost_history') await db.query("insert into variant_cost_history(variant_id,unit_cost_cents,currency,reason) values($1,1500,'eur','Ancien coût')", [p.variant]);
      const calls = [], diagnostic = await productDeletionInfo(reads(db, calls), p.id);
      assert.equal(diagnostic.eligible, kind === 'none');
      assert.deepEqual(diagnostic.reasons.map(reason => reason.kind), kind === 'none' ? [] : [kind]);
      assert(calls.every(call => call.table === 'products' ? call.single : call.count === 'exact' && call.limit === 3));
      if (kind !== 'none') {
        const reason = diagnostic.reasons[0];
        const count = kind === 'orders' ? 4 : kind === 'reviews' ? 12 : 1;
        assert.equal(reason.count, count); assert(reason.samples.length <= 3);
        if (kind === 'orders') assert(reason.samples.every(sample => sample.order_number === 'HN-DIAGNOSTIC'));
        if (kind === 'adjustments') assert.equal(reason.samples[0].reason, 'Correction test');
        await assert.rejects(db.query("select purge_unused_products($1::uuid[],'SUPPRIMER')", [[p.id]]), new RegExp(kind === 'visibility' ? 'product_delete_active' : kind === 'stock' ? 'product_delete_stock' : 'product_delete_history'));
      }
      assert(!JSON.stringify(diagnostic).includes('private@example.test'));
      assert(!JSON.stringify(diagnostic).includes('Adresse privée'));
      assert(!JSON.stringify(diagnostic).includes('Texte privé'));
      counts.set(p.id, (await db.query('select stock from product_variants where id=$1', [p.variant])).rows[0].stock);
    }
    for (const [id, stock] of counts) assert.equal((await db.query('select stock from product_variants where product_id=$1', [id])).rows[0].stock, stock);
    const unusual = await make('none'), slug = 'legacy,"or(product_id.is.null)\\test';
    await db.query('update products set slug=$1 where id=$2', [slug, unusual.id]);
    await db.query("insert into order_items(order_id,product_slug,product_name,unit_price_cents,quantity) values($1,$2,'Legacy',2000,1)", [order, slug]);
    assert.equal((await productDeletionInfo(reads(db, []), unusual.id)).reasons[0].count, 1);
    const missing = await productDeletionInfo(reads(db, []), randomUUID()); assert.equal(missing.missing, true); assert.equal(missing.eligible, false);
  } finally { await db.close(); }
});

test('les identifiants invalides et les compteurs absents ne deviennent pas un faux produit supprimable', async () => {
  for (const id of [null, '', 'invalid', 123]) assert.equal((await adminProductDeletionInfo({ from() { throw new Error('No read expected'); } }, { id })).statusCode, 400);
  const id = randomUUID();
  for (const count of [undefined, -1, '0']) {
    const query = { select() { return this; }, eq() { return this; }, neq() { return this; }, or() { return this; }, order() { return this; }, limit() { return this; }, maybeSingle() { this.product = true; return this; }, abortSignal() { return this; }, then(resolve) { resolve(this.product ? { data: { id, slug: 'fixture', active: false } } : { data: [], count }); } };
    const response = await adminProductDeletionInfo({ from() { return Object.create(query); } }, { id }); assert.equal(response.statusCode, 503);
    assert(!response.body.includes('eligible'));
  }
  const response = await adminProductDeletionInfo({ from() { throw new Error('private-provider-error'); } }, { id });
  assert.equal(response.statusCode, 503); assert(!response.body.includes('private-provider-error'));
});
