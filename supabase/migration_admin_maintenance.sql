begin;
do $$ begin
  if public.physical_sales_schema_version()<>1 or public.return_lists_schema_version()<>1 or public.inventory_journal_schema_version()<>1 then raise exception 'Maintenance prerequisites missing'; end if;
end $$;
create table if not exists public.admin_maintenance_operations (
  id uuid primary key,
  kind text not null,
  reason text not null check(length(reason) between 3 and 300),
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.admin_maintenance_operations enable row level security;
revoke all on public.admin_maintenance_operations from public,anon,authenticated;
grant select,insert on public.admin_maintenance_operations to service_role;
-- Only never-paid, externally verified expired drafts may lose their draft cost snapshots.
grant delete on public.order_item_costs to service_role;

create or replace function public.admin_maintenance_targets(p_kind text,p_ids uuid[] default null,p_cutoff timestamptz default now())
returns table(id uuid,label text,quantity integer,state jsonb) language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if p_kind='zero_stock' then
    return query select v.id,coalesce(nullif(p.name_fr,''),p.name_en)||' · '||v.color||' · '||v.size,v.stock,to_jsonb(v)
      from product_variants v join products p on p.id=v.product_id where p.catalog_deleted_at is null and v.stock>0;
  elsif p_kind='archive_orders' then
    return query select o.id,o.order_number,0,to_jsonb(o) from orders o
      where not o.admin_archived and not o.inventory_reserved and not o.stock_issue and o.created_at<=p_cutoff
      and (o.shipping_status='delivered' and o.status in ('paid','refunded') or o.status in ('refunded','cancelled'))
      and not exists(select 1 from order_refund_operations r where r.order_id=o.id and r.status in ('prepared','pending'))
      and not exists(select 1 from return_requests r where r.order_id=o.id and r.status in ('requested','approved'));
  elsif p_kind='archive_returns' then
    return query select r.id,o.order_number||' · '||i.product_name,r.quantity,to_jsonb(r) from return_requests r join orders o on o.id=r.order_id join order_items i on i.id=r.order_item_id
      where r.admin_hidden_at is null and r.status in ('received','rejected') and r.created_at<=p_cutoff;
  elsif p_kind='archive_journal' then
    return query select i.id,i.product_name||' · '||i.reason,0,to_jsonb(i) from inventory_adjustments i
      where i.created_at<=p_cutoff and not exists(select 1 from inventory_journal_archives a where a.adjustment_id=i.id);
  elsif p_kind='purge_products' then
    return query select p.id,coalesce(nullif(p.name_fr,''),p.name_en),0,to_jsonb(p) from products p
      where not p.active and (p_ids is null or p.id=any(p_ids))
      and not exists(select 1 from product_variants v where v.product_id=p.id and v.stock<>0)
      and not exists(select 1 from order_items i where i.product_id=p.id or i.product_slug=p.slug or i.variant_id in(select v.id from product_variants v where v.product_id=p.id))
      and not exists(select 1 from reviews r where r.product_id=p.id)
      and not exists(select 1 from inventory_adjustments i join product_variants v on v.id=i.variant_id where v.product_id=p.id)
      and not exists(select 1 from variant_costs c join product_variants v on v.id=c.variant_id where v.product_id=p.id)
      and not exists(select 1 from variant_cost_history c join product_variants v on v.id=c.variant_id where v.product_id=p.id);
  elsif p_kind='purge_visits' then
    return query select e.id,e.event_type,0,jsonb_build_object('created_at',e.created_at,'event_type',e.event_type) from analytics_events e where e.created_at<=p_cutoff;
  elsif p_kind='purge_messages' then
    return query select m.id,m.name||' · '||coalesce(m.subject,'Sans sujet'),0,to_jsonb(m) from contact_messages m where p_ids is null or m.id=any(p_ids);
  elsif p_kind='purge_drafts' then
    return query select o.id,o.order_number,0,to_jsonb(o) from orders o where (p_ids is null or o.id=any(p_ids))
      and o.sale_channel='online' and o.status in ('pending','abandoned','payment_failed') and o.created_at<=p_cutoff-interval '72 hours'
      and o.paid_at is null and o.payment_intent_id is null and o.refunded_cents=0 and not o.inventory_reserved and not o.stock_issue
      and (o.stripe_session_id is not null or not o.stripe_creation_started)
      and not exists(select 1 from order_items i where i.order_id=o.id and i.stock_debited)
      and not exists(select 1 from promo_codes c where c.reserved_order_id=o.id)
      and not exists(select 1 from reviews r where r.order_id=o.id)
      and not exists(select 1 from order_returns r where r.order_id=o.id)
      and not exists(select 1 from return_requests r where r.order_id=o.id)
      and not exists(select 1 from order_refund_operations r where r.order_id=o.id)
      and not exists(select 1 from physical_sale_operations r where r.order_id=o.id);
  else raise exception 'maintenance_invalid'; end if;
end $$;

create or replace function public.list_admin_maintenance_targets(p_kind text,p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if p_kind not in ('purge_products','purge_messages','purge_drafts') or p_offset<0 or p_offset>100000 or p_limit not between 1 and 20 then raise exception 'maintenance_invalid'; end if;
  with targets as(select id,label from admin_maintenance_targets(p_kind)),paged as(select * from targets order by id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from targets),'targets',coalesce((select jsonb_agg(to_jsonb(paged) order by id) from paged),'[]'::jsonb)) into result;
  return result;
end $$;

create or replace function public.quote_admin_maintenance(p_kind text,p_ids uuid[] default null,p_cutoff timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb; count integer;
begin
  if p_cutoff is null or p_cutoff>now()+interval '1 minute' or (p_kind in ('purge_products','purge_messages','purge_drafts') and (p_ids is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null)) then raise exception 'maintenance_invalid'; end if;
  with targets as(select * from admin_maintenance_targets(p_kind,p_ids,p_cutoff)), samples as(select id,label,quantity from targets order by id limit 20)
  select jsonb_build_object('kind',p_kind,'cutoff',p_cutoff,'count',(select count(*) from targets),'units',coalesce((select sum(quantity) from targets),0),
    'fingerprint',coalesce((select md5(string_agg(id::text||state::text,',' order by id)) from targets),md5('')),
    'samples',coalesce((select jsonb_agg(to_jsonb(samples) order by id) from samples),'[]'::jsonb)) into result;
  count:=(result->>'count')::integer;
  if p_kind in ('purge_products','purge_messages','purge_drafts') and count<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'maintenance_target_unavailable'; end if;
  return result;
end $$;

create or replace function public.run_admin_maintenance(p_id uuid,p_kind text,p_ids uuid[],p_quote jsonb,p_reason text,p_confirmation text,p_verified_drafts uuid[] default '{}')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous admin_maintenance_operations%rowtype; request jsonb; fresh jsonb; result jsonb; target record; targets uuid[];
begin
  if p_id is null or p_reason is null or length(btrim(p_reason)) not between 3 and 300 or p_quote is null or p_confirmation is distinct from (case when p_kind='zero_stock' then 'ZERO' when p_kind like 'archive_%' then 'ARCHIVER' else 'SUPPRIMER' end) then raise exception 'maintenance_invalid'; end if;
  request:=jsonb_build_object('kind',p_kind,'ids',p_ids,'quote',p_quote,'reason',btrim(p_reason),'confirmation',p_confirmation);
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(hashtextextended('admin-maintenance',0));
  select * into previous from admin_maintenance_operations where id=p_id;
  if found then
    if previous.request is distinct from request then raise exception 'maintenance_operation_mismatch'; end if;
    return previous.result||jsonb_build_object('already',true);
  end if;
  if p_kind in ('zero_stock','purge_products') then
    if p_kind='purge_products' then lock table order_items in share row exclusive mode; end if;
    lock table products in share row exclusive mode;
    lock table product_variants in share row exclusive mode;
  elsif p_kind in ('archive_orders','purge_drafts') then
    lock table orders in share row exclusive mode;
    lock table order_items in share row exclusive mode;
    lock table return_requests in share row exclusive mode;
    lock table order_refund_operations in share row exclusive mode;
  elsif p_kind='archive_returns' then lock table return_requests in share row exclusive mode;
  elsif p_kind='archive_journal' then
    perform pg_advisory_xact_lock(hashtextextended('inventory_journal_reset',0));
    lock table inventory_adjustments in share row exclusive mode;
    lock table inventory_journal_archives in share row exclusive mode;
  elsif p_kind='purge_visits' then lock table analytics_events in share row exclusive mode;
  elsif p_kind='purge_messages' then lock table contact_messages in share row exclusive mode;
  else raise exception 'maintenance_invalid'; end if;
  fresh:=quote_admin_maintenance(p_kind,p_ids,(p_quote->>'cutoff')::timestamptz);
  if fresh is distinct from p_quote then raise exception 'maintenance_preview_changed'; end if;
  if (fresh->>'count')::integer=0 then raise exception 'maintenance_empty'; end if;
  select array_agg(id order by id) into targets from admin_maintenance_targets(p_kind,p_ids,(p_quote->>'cutoff')::timestamptz);
  if p_kind='zero_stock' then
    for target in select id,quantity from admin_maintenance_targets(p_kind,p_ids,(p_quote->>'cutoff')::timestamptz) order by id loop
      perform adjust_inventory(md5(p_id::text||target.id::text)::uuid,target.id,'count',0,target.quantity,btrim(p_reason));
    end loop;
  elsif p_kind='archive_orders' then update orders set admin_archived=true where id=any(targets);
  elsif p_kind='archive_returns' then update return_requests set admin_hidden_at=now() where id=any(targets);
  elsif p_kind='archive_journal' then
    insert into inventory_journal_resets(id,archived_count) values(p_id,cardinality(targets));
    insert into inventory_journal_archives(adjustment_id,reset_id) select unnest(targets),p_id;
  elsif p_kind='purge_products' then perform purge_unused_products(targets,'SUPPRIMER');
  elsif p_kind='purge_visits' then delete from analytics_events where id=any(targets);
  elsif p_kind='purge_messages' then delete from contact_messages where id=any(targets);
  elsif p_kind='purge_drafts' then
    if exists(select 1 from orders o where o.id=any(targets) and o.stripe_session_id is not null and not(o.id=any(p_verified_drafts))) then raise exception 'maintenance_draft_unverified'; end if;
    delete from order_item_costs where order_item_id in(select id from order_items where order_id=any(targets));
    delete from orders where id=any(targets);
  end if;
  result:=jsonb_build_object('operation_id',p_id,'kind',p_kind,'count',(fresh->>'count')::integer,'units',(fresh->>'units')::bigint,'already',false);
  insert into admin_maintenance_operations(id,kind,reason,request,result) values(p_id,p_kind,btrim(p_reason),request,result);
  return result;
end $$;

create or replace function public.admin_archived_return_list(p_query text,p_offset integer,p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb; pattern text;
begin
  if p_query is null or length(p_query)>100 or p_offset<0 or p_offset>500000 or p_limit not between 1 and 25 then raise exception 'return_list_invalid'; end if;
  pattern:='%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%';
  with matched as(select r.* from return_requests r join orders o on o.id=r.order_id join order_items i on i.id=r.order_item_id
    where r.admin_hidden_at is not null and (btrim(p_query)='' or o.order_number ilike pattern or i.product_name ilike pattern or r.reason ilike pattern)),
    paged as(select * from matched order by created_at desc,id offset p_offset limit p_limit)
  select jsonb_build_object('total',(select count(*) from matched),'requests',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'orders',jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'shipping_status',o.shipping_status,'refunded_cents',o.refunded_cents,'total_cents',o.total_cents,'currency',o.currency,'return_policy',o.return_policy),
    'order_items',jsonb_build_object('id',i.id,'product_name',i.product_name,'variant',i.variant),
    'inspection',(select jsonb_build_object('quantity',x.quantity,'sellable_quantity',x.sellable_quantity,'inspection_note',x.inspection_note) from order_returns x where x.return_ref=r.id::text)) order by r.created_at desc,r.id)
    from paged r join orders o on o.id=r.order_id join order_items i on i.id=r.order_item_id),'[]'::jsonb)) into result;
  return result;
end $$;
create or replace function public.admin_maintenance_schema_version()
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$select 1$$;
do $$ declare signature text; begin
  foreach signature in array array['admin_maintenance_targets(text,uuid[],timestamp with time zone)','list_admin_maintenance_targets(text,integer,integer)','quote_admin_maintenance(text,uuid[],timestamp with time zone)','run_admin_maintenance(uuid,text,uuid[],jsonb,text,text,uuid[])','admin_archived_return_list(text,integer,integer)','admin_maintenance_schema_version()'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
    execute 'grant execute on function public.'||signature||' to service_role';
  end loop;
end $$;
commit;
