const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { salesReport } = require('../netlify/functions/lib/admin-sales');
const { adminReturns } = require('../netlify/functions/lib/returns');
const { adminOperations } = require('../netlify/functions/lib/admin-operations');

test('les coûts et décisions de retour incomplets sont refusés avant tout RPC',async () => {
  const sb = { rpc() { throw new Error('Unexpected write'); } };
  for (const cents of [undefined,-1,1.5,'100']) assert.equal((await adminOperations(sb,'saveVariantCost',{ variant_id:randomUUID(),unit_cost_cents:cents,currency:'eur',reason:'Test' })).statusCode,400);
  assert.equal((await adminOperations(sb,'saveReturnPolicy',{ days:14,withdrawal_payer:'customer',expected_version:'initial' })).statusCode,400);
  assert.equal((await adminReturns(sb,'recordReturn',{ quantity:1,return_ref:randomUUID() })).statusCode,400);
  assert.equal((await adminReturns(sb,'updateReturnRequest',{ id:randomUUID(),status:'received',note:'Test' })).statusCode,400);
});

const now = new Date('2026-10-07T12:00:00Z');
const eur = { code:'eur',symbol:'€' };
const order = changes => ({ id:'order',paid_at:'2026-10-06T10:00:00Z',status:'paid',currency:'eur',total_cents:2800,subtotal_cents:2000,discount_cents:1,refunded_cents:0,order_items:[{ id:'item',product_slug:'veste',product_name:'Veste',unit_price_cents:1000,net_total_cents:1999,quantity:2,order_item_costs:{ unit_cost_cents:400,currency:'eur' } }],order_returns:[],...changes });
test('les retours physiques ne sont pas soustraits des remboursements monétaires',() => {
  const report = salesReport([order({ order_returns:[{ order_item_id:'item',quantity:1,total_refund_cents:1000,sellable_quantity:1 }] })],[],'d30',0,eur,now);
  assert.equal(report.totals.netRevenueCents,2800);
  assert.equal(report.totals.returnedCents,1000);
  assert.equal(report.totals.marginCents,599);
});
test('un retour défectueux conserve le coût perdu et un remboursement rend la marge inconnue',() => {
  const defect = order({ order_returns:[{ order_item_id:'item',quantity:1,total_refund_cents:1000,sellable_quantity:0 }] });
  assert.equal(salesReport([defect],[],'d30',0,eur,now).totals.marginCents,199);
  const refunded = salesReport([order({ status:'refunded',refunded_cents:2800 })],[],'d30',0,eur,now);
  assert.equal(refunded.totals.netRevenueCents,0);
  assert.equal(refunded.totals.marginCents,null);
  assert.equal(refunded.totals.marginMissingUnits,2);
});
test('coût absent ≠ zéro ; coût historique et devises ne sont pas inventés',() => {
  const missing = order(); missing.order_items[0].order_item_costs = null;
  assert.equal(salesReport([missing],[],'all',5,eur,now).totals.marginCents,null);
  const zero = order(); zero.order_items[0].order_item_costs.unit_cost_cents = 0;
  assert.equal(salesReport([zero],[],'all',5,eur,now).totals.marginCents,1999);
  const mixed = salesReport([order(),order({ currency:'usd',total_cents:999999 })],[],'all',5,eur,now);
  assert.equal(mixed.totals.revenueCents,2800);
  assert.deepEqual(mixed.excluded_currencies,['usd']);
});
test('le rapport rattache les retours tardifs à la commande sans soustraire d’autres cohortes',() => {
  const report = salesReport([order(),order({ paid_at:'2026-01-01T10:00:00Z',order_returns:[{ order_item_id:'item',quantity:1,total_refund_cents:1000,sellable_quantity:1 }] })],[],'d30',5,eur,now);
  assert.equal(report.totals.returnedUnits,0);
  assert.equal(report.totals.orders,1);
  assert.equal(report.monthly.find(m => m.key === '2026-01').returnedUnits,1);
});

test('migration locale rejouable : retours atomiques, coûts privés figés et politique par commande',async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$;");
    const migrations = ['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql'];
    for (const file of migrations) await db.exec(fs.readFileSync('supabase/'+file,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    await db.exec(fs.readFileSync('supabase/migration_admin_operations.sql','utf8'));
    const product = randomUUID(), variant = randomUUID(), user = randomUUID();
    await db.query('insert into auth.users(id) values($1)',[user]);
    await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image) values($1,'operations-test','TEST','Jacket','Veste','سترة','','','',1000,'jacket','images/hero.jpg')",[product]);
    await db.query("insert into product_variants(id,product_id,color,size,stock) values($1,$2,'Noir','M',10)",[variant,product]);
    const saveCost = async (cents,expected=null) => (await db.query("select save_variant_cost($1,$2,'eur',$3,'Facture test') as result",[variant,cents,expected])).rows[0].result;
    const cost = await saveCost(400);
    assert.equal((await saveCost(400)).unit_cost_cents,400);
    await assert.rejects(saveCost(500),/cost_changed/);
    const makeOrder = async (suffix,expectedPolicy=null) => {
      const id = randomUUID(), item = randomUUID();
      await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,subtotal_cents,discount_cents,total_cents,currency,user_id,return_policy) values($1,$2,'fixture@example.test','Local','Local','Paris','','75000','FR','standard',3000,1,2999,'eur',$3,$4)",[id,'HN-LOCAL-'+suffix,user,expectedPolicy]);
      await db.query("insert into order_items(id,order_id,product_id,product_slug,product_name,image,quantity,unit_price_cents,net_total_cents,variant_id) values($1,$2,$3,'operations-test','Veste','images/hero.jpg',3,1000,2999,$4)",[item,id,product,variant]);
      await db.query('select reserve_order($1)',[id]);
      await db.query("select finalize_order_payment($1,$2,2999,'eur',$3)",[id,'cs_'+suffix,'pi_'+suffix]);
      await db.query("update orders set shipping_status='delivered',delivered_at=now() where id=$1",[id]);
      return { id,item };
    };
    const first = await makeOrder('first');
    await saveCost(900,cost.updated_at);
    assert.equal((await db.query('select unit_cost_cents from order_item_costs where order_item_id=$1',[first.item])).rows[0].unit_cost_cents,400);
    const policy = (await db.query("select save_return_policy(60,'store','initial') as result")).rows[0].result;
    assert.equal((await db.query('select return_policy from orders where id=$1',[first.id])).rows[0].return_policy.days,30);
    const second = await makeOrder('second');
    assert.equal((await db.query('select return_policy from orders where id=$1',[second.id])).rows[0].return_policy.days,60);
    await assert.rejects(makeOrder('stale',{ version:'initial' }),/policy_changed/);
    await assert.rejects(db.query("update orders set return_policy='{}' where id=$1",[first.id]),/policy_immutable/);
    await assert.rejects(db.query("select save_return_policy(14,'customer',$1)",[policy.version]),/policy_invalid/);
    await assert.rejects(db.query("select save_return_policy(30,'customer','initial')"),/policy_changed/);
    const inspect = async (ref,qty,sellable,note='Contrôle local') => (await db.query("select inspect_order_return($1,$2,$3,$4,'Retour local',$5,$6) as result",[first.id,first.item,qty,ref,sellable,note])).rows[0].result;
    const stock = async () => (await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock;
    const before = await stock();
    const ref = randomUUID();
    const duplicate = await Promise.all([inspect(ref,1,0),inspect(ref,1,0)]);
    assert.equal(duplicate.filter(r => r.already).length,1);
    assert.equal(await stock(),before);
    await assert.rejects(inspect(ref,1,1),/return_operation_mismatch/);
    assert.equal((await inspect(randomUUID(),1,1)).refundCents,999);
    assert.equal(await stock(),before+1);
    await assert.rejects(inspect(randomUUID(),2,2),/return_quantity_unavailable/);
    assert.equal(await stock(),before+1);
    await db.query("select reconcile_order_refund($1,'pi_first',2999,'eur',2999)",[first.id]);
    assert.equal(await stock(),before+1);
    await db.query("update orders set shipping_status='new' where id=$1",[first.id]);
    assert.equal((await db.query('select restock_order($1) as result',[first.id])).rows[0].result,false);
    assert.equal(await stock(),before+1);
    await db.query("update orders set shipping_status='delivered' where id=$1",[first.id]);
    await inspect(randomUUID(),1,1);
    assert.equal(await stock(),before+2);
    assert.equal((await db.query('select sum(total_refund_cents)::integer as cents from order_returns where order_id=$1',[first.id])).rows[0].cents,2999);
    await assert.rejects(db.query("select record_order_return($1,$2,1,'unsafe','defective')",[first.id,first.item]),/return_inspection_required/);
    await db.query("update orders set delivered_at=now()-interval '45 days' where id=$1",[second.id]);
    const req = (await db.query("select request_return($1,$2,$3,2,'Défaut local',1,'nonconforming') as id",[user,second.id,second.item])).rows[0].id;
    await assert.rejects(db.query("select decide_return_request($1,'approved','customer','Décision locale')",[req]),/return_store_payer_required/);
    await db.query("select decide_return_request($1,'approved','store','Décision locale')",[req]);
    await assert.rejects(db.query("select decide_return_request($1,'rejected','store','Autre décision')",[req]),/return_transition_unavailable/);
    const beforeReceive = await stock();
    await db.query("select inspect_return_request($1,1,'Une unité défectueuse')",[req]);
    await db.query("select inspect_return_request($1,1,'Une unité défectueuse')",[req]);
    assert.equal(await stock(),beforeReceive+1);
    assert.equal((await db.query('select refunded_cents from orders where id=$1',[second.id])).rows[0].refunded_cents,0);
    const withdrawal = (await db.query("select request_return($1,$2,$3,1,'Changement avis',1,'withdrawal') as id",[user,second.id,second.item])).rows[0].id;
    await assert.rejects(db.query("select decide_return_request($1,'approved','customer','Retour local')",[withdrawal]),/return_store_payer_required/);
    for (const role of ['anon','authenticated']) {
      for (const table of ['variant_costs','variant_cost_history','order_item_costs']) {
        assert.equal((await db.query('select relrowsecurity as enabled from pg_class where oid=$1::regclass',[table])).rows[0].enabled,true);
        await db.exec('grant select,insert,update on '+table+' to '+role);
        await db.exec('set role '+role);
        try {
          assert.equal((await db.query('select * from '+table)).rows.length,0);
          assert.equal((await db.query('update '+table+' set currency=\'usd\' returning *')).rows.length,0);
          if (table === 'variant_costs') await assert.rejects(db.query("insert into variant_costs(variant_id,unit_cost_cents,currency) values($1,1,'eur')",[randomUUID()]));
          if (table === 'variant_cost_history') await assert.rejects(db.query("insert into variant_cost_history(variant_id,unit_cost_cents,currency,reason) values($1,1,'eur','Unauthorized')",[variant]));
          if (table === 'order_item_costs') await assert.rejects(db.query("insert into order_item_costs(order_item_id,unit_cost_cents,currency) values($1,1,'eur')",[randomUUID()]));
        }
        finally { await db.exec('reset role'); }
      }
      for (const fn of ['save_return_policy(integer,text,text)','inspect_order_return(uuid,uuid,integer,text,text,integer,text)','inspect_return_request(uuid,integer,text)','save_variant_cost(uuid,integer,text,timestamp with time zone,text)','request_return(uuid,uuid,uuid,integer,text,integer,text)']) assert.equal((await db.query("select has_function_privilege($1,$2,'execute') as allowed",[role,fn])).rows[0].allowed,false);
    }
  } finally { await db.close(); }
});
