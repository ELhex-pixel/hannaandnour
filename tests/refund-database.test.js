const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

test('remboursements locaux : montants exacts, concurrence, réessais, droits privés et stock séparé',async()=>{
  const db=new PGlite();
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;');
    const migrations=['schema.sql','migration_variants_admin.sql','rls_accounts.sql','migration_promos_refunds.sql','migration_relance_analytics.sql','migration_blog_story.sql','migration_demo_reviews_home.sql','migration_order_cancel.sql','migration_promo_single_use.sql','migration_order_returns.sql','migration_guest_reviews.sql','migration_pending_order_lifecycle.sql','migration_barcode_scan.sql','migration_integrity_features.sql','migration_admin_inventory.sql','migration_admin_operations.sql','migration_return_policy_editor.sql','migration_catalog_cleanup.sql','migration_inventory_journal.sql'];
    for(const name of migrations)await db.exec(fs.readFileSync('supabase/'+name,'utf8').replace(/create extension if not exists pgcrypto;/gi,''));
    const migration=fs.readFileSync('supabase/migration_partial_refunds.sql','utf8');
    await assert.rejects(db.exec(migration.replace(/commit;\s*$/,'select 1/0;commit;')),/division by zero/);await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('order_refund_operations') as table_name")).rows[0].table_name,null);
    await db.exec(migration);await db.exec(migration);
    assert.equal((await db.query('select admin_refunds_schema_version() as version')).rows[0].version,1);
    const product=randomUUID(), variant=randomUUID();
    await db.query("insert into products(id,slug,sku,name_en,name_fr,name_ar,description_en,description_fr,description_ar,price_cents,category,image)values($1,'test-refund','REF','Test','Test','Test','','','',1000,'jacket','images/hero.jpg')",[product]);
    await db.query("insert into product_variants(id,product_id,color,size,stock)values($1,$2,'Noir','M',100)",[variant,product]);
    async function makeOrder(suffix, quantities=[3,1], nets=[2997,1999], subtotal=5000,discount=4,tax=349,shipping=699){
      const id=randomUUID(), items=quantities.map(()=>randomUUID()), total=subtotal-discount+tax+shipping;
      await db.query("insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,subtotal_cents,discount_cents,tax_cents,shipping_cents,total_cents,currency)values($1,$2,'local@example.test','Local','Local','Paris','','75000','FR','standard',$3,$4,$5,$6,$7,'eur')",[id,'HN-'+suffix,subtotal,discount,tax,shipping,total]);
      for(let i=0;i<items.length;i++)await db.query("insert into order_items(id,order_id,product_id,product_slug,product_name,image,quantity,unit_price_cents,net_total_cents,variant_id)values($1,$2,$3,'test-refund','Test','images/hero.jpg',$4,$5,$6,$7)",[items[i],id,product,quantities[i],i===0?1000:2000,nets[i],variant]);
      await db.query('select reserve_order($1)',[id]);await db.query('select finalize_order_payment($1,$2,$3,$4,$5)',[id,'cs_'+suffix,total,'eur','pi_'+suffix]);
      return {id,items,total,intent:'pi_'+suffix};
    }
    const order=await makeOrder('rounding'), stock=async()=>Number((await db.query('select stock from product_variants where id=$1',[variant])).rows[0].stock);
    const initial=await stock();
    const quote=async(items,shipping=false,kind='partial',target=order)=>(await db.query('select order_refund_quote($1,$2,$3,$4) as result',[target.id,kind,JSON.stringify(items),shipping])).rows[0].result;
    const claim=async(id,q,items,shipping=false,target=order)=>(await db.query("select claim_order_refund($1,$2,$3,$4,$5,'Motif local',$6,$7,$8) as result",[id,target.id,q.kind,JSON.stringify(items),shipping,q.amount_cents,q.currency,q.refunded_cents])).rows[0].result;
    const finish=async(id,q,cumulative,refund,status='succeeded',target=order)=>(await db.query('select finish_order_refund($1,$2,$3,$4,$5,$6,$7) as result',[id,refund,status,q.amount_cents,q.currency,target.intent,cumulative])).rows[0].result;
    const item={id:order.items[0],quantity:1};
    const before=(await db.query('select refunded_cents from orders where id=$1',[order.id])).rows[0].refunded_cents;
    const q1=await quote([item],true);assert(q1.amount_cents>699);assert.equal(before,0);assert.equal(await stock(),initial);
    await assert.rejects(quote([{id:randomUUID(),quantity:1}]),/refund_item_unavailable/);
    await assert.rejects(quote([item,item]),/refund_duplicate_item/);
    await assert.rejects(quote([{id:item.id,quantity:1.5}]),/refund_invalid/);
    await assert.rejects(claim(randomUUID(),{...q1,amount_cents:q1.amount_cents+1},[item],true),/refund_quote_changed/);
    const first=randomUUID(), claims=await Promise.all([claim(first,q1,[item],true),claim(first,q1,[item],true)]);
    assert.equal(claims[0].id,claims[1].id);assert.equal((await db.query('select count(*)::int as n from order_refund_operations')).rows[0].n,1);
    await assert.rejects(quote([],false,'full'),/refund_order_busy/);
    await assert.rejects(claim(first,q1,[{...item,quantity:2}],true),/refund_operation_mismatch/);
    const starts=await Promise.all([db.query('select start_order_refund($1) as first',[first]),db.query('select start_order_refund($1) as first',[first])]);assert.equal(starts.filter(r=>r.rows[0].first).length,1);
    await finish(first,q1,null,'re_first','pending');await assert.rejects(quote([item]),/refund_order_busy/);
    await assert.rejects(db.query("select finish_order_refund($1,'re_first','succeeded',$2,'usd',$3,$2)",[first,q1.amount_cents,order.intent]),/refund_result_mismatch/);
    // Webhook arrives first; finishing the journal remains monotonic/idempotent.
    await db.query('select reconcile_order_refund($1,$2,$3,$4,$5)',[order.id,order.intent,order.total,'eur',q1.amount_cents]);
    await finish(first,q1,q1.amount_cents,'re_first');await finish(first,q1,q1.amount_cents,'re_first');
    assert.equal(await stock(),initial);assert.equal((await db.query('select status from orders where id=$1',[order.id])).rows[0].status,'paid');
    assert.equal((await db.query('select claim_order_refund_email($1) as ok',[first])).rows[0].ok,true);assert.equal((await db.query('select claim_order_refund_email($1) as ok',[first])).rows[0].ok,false);
    await assert.rejects(quote([item],true),/refund_shipping_unavailable/);
    let cumulative=q1.amount_cents;
    for(let i=0;i<2;i++){const q=await quote([item]),id=randomUUID();await claim(id,q,[item]);cumulative+=q.amount_cents;await finish(id,q,cumulative,'re_unit_'+i);}
    await assert.rejects(quote([item]),/refund_quantity_unavailable/);
    const lastItem={id:order.items[1],quantity:1}, qLast=await quote([lastItem]),last=randomUUID();await claim(last,qLast,[lastItem]);cumulative+=qLast.amount_cents;await finish(last,qLast,cumulative,'re_last');
    assert.equal(cumulative,order.total);assert.equal(await stock(),initial);
    const state=(await db.query('select status,refunded_cents,refund_restock from orders where id=$1',[order.id])).rows[0];assert.equal(state.status,'refunded');assert.equal(state.refunded_cents,order.total);assert.equal(state.refund_restock,false);
    await db.query('select reconcile_order_refund($1,$2,$3,$4,$3)',[order.id,order.intent,order.total,'eur']);assert.equal(await stock(),initial);
    await db.query("update orders set shipping_status='delivered',shipped_at=now(),delivered_at=now()where id=$1",[order.id]);
    await db.query("select inspect_order_return($1,$2,1,$3,'Retour local',1,'Contrôle physique local')",[order.id,item.id,randomUUID()]);assert.equal(await stock(),initial+1);
    const full=await makeOrder('full',[1],[1000],1000,0,70,0), fullBefore=await stock(),fullQuote=await quote([],false,'full',full),fullId=randomUUID();
    await claim(fullId,fullQuote,[],false,full);await finish(fullId,fullQuote,full.total,'re_full','succeeded',full);assert.equal(await stock(),fullBefore+1);
    await finish(fullId,fullQuote,full.total,'re_full','succeeded',full);assert.equal(await stock(),fullBefore+1);
    const external=await makeOrder('external',[1],[1000],1000,0,0,0);await db.query('select reconcile_order_refund($1,$2,1000,$3,100)',[external.id,external.intent,'eur']);await assert.rejects(quote([{id:external.items[0],quantity:1}],false,'partial',external),/refund_external_reconciliation/);
    assert.equal((await quote([],false,'full',external)).amount_cents,900);
    const legacy=await makeOrder('legacy',[1],[1000],1000,0,0,0);await db.query('update order_items set net_total_cents=null where order_id=$1',[legacy.id]);await assert.rejects(quote([{id:legacy.items[0],quantity:1}],false,'partial',legacy),/refund_allocation_unavailable/);
    const info=(await db.query('select order_refund_info($1) as result',[order.id])).rows[0].result;assert.equal(info.items.find(i=>i.id===item.id).refunded_quantity,3);assert.equal(info.pending_operation,null);assert.equal(info.remaining_cents,0);
    for(const role of ['anon','authenticated'])for(const fn of ['order_refund_quote(uuid,text,jsonb,boolean)','claim_order_refund(uuid,uuid,text,jsonb,boolean,text,integer,text,integer)','start_order_refund(uuid)','finish_order_refund(uuid,text,text,integer,text,text,integer)','order_refund_info(uuid)','admin_refunds_schema_version()'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed',[role,fn])).rows[0].allowed,false);
    assert.equal((await db.query("select has_table_privilege('service_role','order_refund_operations','delete') as allowed")).rows[0].allowed,false);
    await db.exec('grant select on order_refund_operations to anon;set role anon');assert.equal((await db.query('select * from order_refund_operations')).rows.length,0);await db.exec('reset role');
  } finally {await db.close();}
});
