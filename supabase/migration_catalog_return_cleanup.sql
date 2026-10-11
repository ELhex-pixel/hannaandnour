-- Catalogue removal and compact return lists (customer and admin).
-- Keep the original rows, order references, stock quantities and audit history.
-- Apply after the existing catalogue, inventory and category migrations.
begin;

do $$
begin
  if public.admin_catalog_schema_version() <> 1 or public.catalog_categories_schema_version() <> 1 then
    raise exception 'Catalogue prerequisites missing';
  end if;
end;
$$;

alter table public.products add column if not exists catalog_deleted_at timestamptz;
alter table public.products drop constraint if exists products_catalog_deleted_visibility_check;
alter table public.products add constraint products_catalog_deleted_visibility_check
  check(catalog_deleted_at is null or active = false);
create index if not exists products_current_catalog_idx on public.products(created_at)
  where catalog_deleted_at is null;

-- A stale product editor must not recreate variants or reactivate a deleted
-- product. Stock-only adjustments, payments and physical returns remain valid.
create or replace function public.guard_deleted_product_variants()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare deleted_at timestamptz;
begin
  select catalog_deleted_at into deleted_at from products where id=new.product_id for update;
  if deleted_at is not null then raise exception 'product_catalog_deleted'; end if;
  return new;
end;
$$;
drop trigger if exists product_variants_catalog_guard on public.product_variants;
create trigger product_variants_catalog_guard
  before insert or update of product_id,color,size,active,barcode on public.product_variants
  for each row execute function public.guard_deleted_product_variants();

create or replace function public.delete_products_from_catalog(p_ids uuid[],p_confirmation text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ids uuid[]; removed jsonb; missing jsonb;
begin
  if p_confirmation is distinct from 'SUPPRIMER' or p_ids is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null then
    raise exception 'product_catalog_delete_invalid';
  end if;
  select array_agg(distinct id order by id) into ids from unnest(p_ids) as t(id);
  perform set_config('lock_timeout','5s',true);
  perform id from products where id=any(ids) order by id for update;
  perform v.id from product_variants v join products p on p.id=v.product_id
    where p.id=any(ids) order by v.id for update of v;
  update product_variants v set active=false from products p
    where v.product_id=p.id and p.id=any(ids) and p.catalog_deleted_at is null and v.active;
  update products set active=false,catalog_deleted_at=now()
    where id=any(ids) and catalog_deleted_at is null;
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into removed from products where id=any(ids);
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into missing from unnest(ids) as t(id)
    where not exists(select 1 from products p where p.id=t.id);
  return jsonb_build_object('deleted_ids',removed,'missing_ids',missing);
end;
$$;

-- Recheck the catalogue after a quote. Existing reservations remain valid;
-- no new reservation can start for a deleted product (even a legacy card
-- without variants). The original promo/stock transaction remains intact.
create or replace function public.reserve_order(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; r record; v product_variants%rowtype; promo promo_codes%rowtype;
begin
  select * into o from orders where id=p_order_id for update;
  if not found or o.status <> 'pending' then return false; end if;
  if o.inventory_reserved then return true; end if;
  perform p.id from products p where exists(select 1 from order_items i
    where i.order_id=o.id and (i.product_id=p.id or i.product_slug=p.slug))
    order by p.id for update;
  if exists(select 1 from order_items i join products p on i.product_id=p.id or i.product_slug=p.slug
    where i.order_id=o.id and p.catalog_deleted_at is not null) then return false; end if;
  for r in select variant_id,sum(quantity)::integer as qty from order_items
    where order_id=o.id and variant_id is not null group by variant_id order by variant_id loop
    select * into v from product_variants where id=r.variant_id for update;
    if not found or not v.active or v.stock<r.qty then return false; end if;
  end loop;
  if o.promo_code is not null then
    select * into promo from promo_codes where code=o.promo_code for update;
    if not found or not promo.active or (promo.expires_at is not null and promo.expires_at<=now()) then return false; end if;
    if promo.single_use and promo.used_count>0 then return false; end if;
    if promo.single_use then update promo_codes set used_count=1,reserved_order_id=o.id where code=promo.code; end if;
  end if;
  for r in select variant_id,sum(quantity)::integer as qty from order_items
    where order_id=o.id and variant_id is not null group by variant_id order by variant_id loop
    update product_variants set stock=stock-r.qty where id=r.variant_id;
  end loop;
  update order_items set stock_debited=true where order_id=o.id and variant_id is not null;
  update orders set inventory_reserved=true where id=o.id;
  return true;
end;
$$;

alter table public.return_requests add column if not exists admin_hidden_at timestamptz;
create index if not exists return_requests_current_admin_idx on public.return_requests(status,created_at desc,id)
  where admin_hidden_at is null;
create index if not exists return_requests_order_list_idx on public.return_requests(order_id,created_at desc);
create index if not exists return_requests_item_status_idx on public.return_requests(order_item_id,status);
create index if not exists order_returns_item_quantity_idx on public.order_returns(order_item_id);
create index if not exists order_items_return_order_idx on public.order_items(order_id);

create or replace function public.hide_completed_return_request(p_id uuid,p_confirmation text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r return_requests%rowtype; oid uuid; previous timestamptz;
begin
  if p_id is null or p_confirmation is distinct from 'SUPPRIMER' then raise exception 'return_hide_invalid'; end if;
  select order_id into oid from return_requests where id=p_id;
  if not found then raise exception 'return_request_missing'; end if;
  perform id from orders where id=oid for update;
  select * into r from return_requests where id=p_id for update;
  if r.status not in ('received','rejected') then raise exception 'return_not_finished'; end if;
  previous := r.admin_hidden_at;
  update return_requests set admin_hidden_at=now() where id=r.id and admin_hidden_at is null;
  return jsonb_build_object('id',r.id,'already',previous is not null);
end;
$$;

-- Client retries keep one stable request ID, including after a lost response.
-- Pending/approved quantities are accounted for alongside physical returns.
create or replace function public.request_return_with_operation(p_user_id uuid,p_order_id uuid,p_item_id uuid,p_quantity integer,p_reason text,p_days integer,p_category text,p_operation_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; i order_items%rowtype; r return_requests%rowtype; physical integer; received integer; pending integer; note text;
begin
  if p_user_id is null or p_operation_id is null or p_category is null or p_category not in ('withdrawal','seller_error','nonconforming') or p_quantity is null or p_quantity<1 or p_reason is null or length(btrim(p_reason))<3 then raise exception 'return_invalid'; end if;
  note := left(btrim(p_reason),1000);
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into r from return_requests where id=p_operation_id;
  if found then
    if r.user_id is distinct from p_user_id or r.order_id is distinct from p_order_id or r.order_item_id is distinct from p_item_id or r.quantity is distinct from p_quantity or r.reason is distinct from note or r.category is distinct from p_category then raise exception 'return_operation_mismatch'; end if;
    return jsonb_build_object('id',r.id,'status',r.status,'already',true,'evidence_saved',jsonb_array_length(coalesce(r.evidence_paths,'[]'::jsonb))>0);
  end if;
  select * into o from orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.status not in ('paid','refunded') or o.shipping_status<>'delivered' or o.delivered_at is null then raise exception 'Order ineligible'; end if;
  if p_category='withdrawal' and o.delivered_at<now()-make_interval(days=>greatest(14,(o.return_policy->>'days')::integer)) then raise exception 'Return window expired'; end if;
  select * into i from order_items where id=p_item_id and order_id=o.id for update;
  if not found or not i.stock_debited then raise exception 'Item unavailable'; end if;
  select coalesce(sum(quantity),0) into physical from order_returns where order_item_id=i.id;
  select coalesce(sum(quantity) filter(where status='received'),0),coalesce(sum(quantity) filter(where status in ('requested','approved')),0)
    into received,pending from return_requests where order_item_id=i.id;
  if p_quantity>i.quantity-greatest(physical,received)-pending then raise exception 'return_quantity_unavailable'; end if;
  insert into return_requests(id,user_id,order_id,order_item_id,quantity,reason,category)
    values(p_operation_id,p_user_id,o.id,i.id,p_quantity,note,p_category);
  return jsonb_build_object('id',p_operation_id,'status','requested','already',false,'evidence_saved',false);
end;
$$;
create or replace function public.request_return(p_user_id uuid,p_order_id uuid,p_item_id uuid,p_quantity integer,p_reason text,p_days integer,p_category text default 'withdrawal')
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  result := request_return_with_operation(p_user_id,p_order_id,p_item_id,p_quantity,p_reason,p_days,p_category,gen_random_uuid());
  return (result->>'id')::uuid;
end;
$$;

create or replace function public.customer_return_orders(p_user_id uuid,p_query text,p_scope text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; pattern text;
begin
  if p_user_id is null or p_query is null or length(p_query)>100 or p_scope is null or p_scope not in ('all','available','open','closed') or p_offset is null or p_offset<0 or p_offset>250000 or p_limit is null or p_limit not between 1 and 25 then raise exception 'return_list_invalid'; end if;
  pattern := '%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%';
  with owned as (select * from orders where user_id=p_user_id and status in ('paid','refunded')),
  capacity as (
    select i.*,greatest(0,i.quantity-greatest(
      coalesce((select sum(quantity) from order_returns x where x.order_item_id=i.id),0),
      coalesce((select sum(quantity) from return_requests x where x.order_item_id=i.id and status='received'),0)
    )-coalesce((select sum(quantity) from return_requests x where x.order_item_id=i.id and status in ('requested','approved')),0))::integer as available
    from order_items i join owned o on o.id=i.order_id
  ), matched as (
    select o.* from owned o where
    (btrim(p_query)='' or o.order_number ilike pattern or exists(select 1 from capacity i where i.order_id=o.id and i.product_name ilike pattern)) and
    (p_scope='all' or
     (p_scope='available' and o.shipping_status='delivered' and o.delivered_at is not null and exists(select 1 from capacity i where i.order_id=o.id and i.stock_debited and i.available>0)) or
     (p_scope='open' and exists(select 1 from return_requests r where r.order_id=o.id and r.user_id=p_user_id and r.status in ('requested','approved'))) or
     (p_scope='closed' and exists(select 1 from return_requests r where r.order_id=o.id and r.user_id=p_user_id and r.status in ('received','rejected')) and not exists(select 1 from return_requests r where r.order_id=o.id and r.user_id=p_user_id and r.status in ('requested','approved'))))
  ), paged as (select * from matched order by created_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from matched),'orders',coalesce((
    select jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,'created_at',o.created_at,'status',o.status,'shipping_status',o.shipping_status,'delivered_at',o.delivered_at,'return_policy',o.return_policy,
      'order_items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'product_name',i.product_name,'product_slug',i.product_slug,'variant',i.variant,'quantity',i.quantity,'stock_debited',i.stock_debited,'return_available_quantity',i.available) order by i.id) from capacity i where i.order_id=o.id),'[]'::jsonb),
      'return_requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'order_id',r.order_id,'order_item_id',r.order_item_id,'quantity',r.quantity,'reason',r.reason,'category',r.category,'status',r.status,'created_at',r.created_at,'updated_at',r.updated_at,'evidence_saved',jsonb_array_length(r.evidence_paths)>0) order by r.created_at desc,r.id) from return_requests r where r.order_id=o.id and r.user_id=p_user_id),'[]'::jsonb)
    ) order by o.created_at desc,o.id) from paged o
  ),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.admin_return_request_list(p_query text,p_scope text,p_offset integer,p_limit integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; pattern text;
begin
  if p_query is null or length(p_query)>100 or p_scope is null or p_scope not in ('all','open','requested','approved','received','rejected') or p_offset is null or p_offset<0 or p_offset>500000 or p_limit is null or p_limit not between 1 and 25 then raise exception 'return_list_invalid'; end if;
  pattern := '%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%';
  with matched as (
    select r.* from return_requests r join orders o on o.id=r.order_id join order_items i on i.id=r.order_item_id
    where r.admin_hidden_at is null and (p_scope='all' or (p_scope='open' and r.status in ('requested','approved')) or r.status=p_scope)
      and (btrim(p_query)='' or o.order_number ilike pattern or i.product_name ilike pattern or r.reason ilike pattern)
  ), paged as (select * from matched order by created_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from matched),'requests',coalesce((
    select jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'orders',jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'shipping_status',o.shipping_status,'refunded_cents',o.refunded_cents,'total_cents',o.total_cents,'currency',o.currency,'return_policy',o.return_policy),
      'order_items',jsonb_build_object('id',i.id,'product_name',i.product_name,'variant',i.variant),
      'inspection',(select jsonb_build_object('quantity',x.quantity,'sellable_quantity',x.sellable_quantity,'inspection_note',x.inspection_note) from order_returns x where x.return_ref=r.id::text)
    ) order by r.created_at desc,r.id)
    from paged r join orders o on o.id=r.order_id join order_items i on i.id=r.order_item_id
  ),'[]'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.return_lists_schema_version()
returns integer language sql security invoker set search_path=public,pg_temp as $$ select 1 $$;
revoke all on function public.hide_completed_return_request(uuid,text),public.request_return_with_operation(uuid,uuid,uuid,integer,text,integer,text,uuid),public.request_return(uuid,uuid,uuid,integer,text,integer,text),public.customer_return_orders(uuid,text,text,integer,integer),public.admin_return_request_list(text,text,integer,integer),public.return_lists_schema_version() from public,anon,authenticated;
grant execute on function public.hide_completed_return_request(uuid,text),public.request_return_with_operation(uuid,uuid,uuid,integer,text,integer,text,uuid),public.request_return(uuid,uuid,uuid,integer,text,integer,text),public.customer_return_orders(uuid,text,text,integer,integer),public.admin_return_request_list(text,text,integer,integer),public.return_lists_schema_version() to service_role;

create or replace function public.product_catalog_deletion_schema_version()
returns integer language sql security invoker set search_path=public,pg_temp as $$ select 1 $$;
revoke all on function public.delete_products_from_catalog(uuid[],text),public.guard_deleted_product_variants(),public.product_catalog_deletion_schema_version(),public.reserve_order(uuid) from public,anon,authenticated;
grant execute on function public.delete_products_from_catalog(uuid[],text),public.guard_deleted_product_variants(),public.product_catalog_deletion_schema_version(),public.reserve_order(uuid) to service_role;
commit;
