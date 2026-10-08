begin;

do $$
begin
  if public.admin_operations_schema_version() <> 1 then raise exception 'Catalog prerequisites missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.order_items'::regclass and conname='order_items_product_history_fk') then
    alter table public.order_items add constraint order_items_product_history_fk foreign key(product_id) references public.products(id) on delete restrict not valid;
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.order_items'::regclass and conname='order_items_variant_history_fk') then
    alter table public.order_items add constraint order_items_variant_history_fk foreign key(variant_id) references public.product_variants(id) on delete restrict not valid;
  end if;
end;
$$;

create index if not exists order_items_product_history_idx on public.order_items(product_id);
create index if not exists order_items_variant_history_idx on public.order_items(variant_id);

create or replace function public.purge_unused_products(p_ids uuid[], p_confirmation text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare ids uuid[]; deleted jsonb; missing jsonb;
begin
  if p_confirmation is distinct from 'SUPPRIMER' or p_ids is null or cardinality(p_ids) not between 1 and 100 or array_position(p_ids,null) is not null then raise exception 'product_delete_invalid'; end if;
  select array_agg(distinct id order by id) into ids from unnest(p_ids) as t(id);
  perform set_config('lock_timeout','5s',true);
  lock table public.order_items in share row exclusive mode;
  perform id from public.products where id=any(ids) order by id for update;
  perform id from public.product_variants where product_id=any(ids) order by id for update;
  if exists(select 1 from products where id=any(ids) and active) then raise exception 'product_delete_active'; end if;
  if exists(select 1 from product_variants where product_id=any(ids) and stock <> 0) then raise exception 'product_delete_stock'; end if;
  if exists(select 1 from order_items i where i.product_id=any(ids) or i.variant_id in (select id from product_variants where product_id=any(ids)) or i.product_slug in (select slug from products where id=any(ids)))
    or exists(select 1 from reviews where product_id=any(ids))
    or exists(select 1 from inventory_adjustments where variant_id in (select id from product_variants where product_id=any(ids)))
    or exists(select 1 from variant_costs where variant_id in (select id from product_variants where product_id=any(ids)))
    or exists(select 1 from variant_cost_history where variant_id in (select id from product_variants where product_id=any(ids))) then raise exception 'product_delete_history'; end if;
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into missing from unnest(ids) as t(id) where not exists(select 1 from products p where p.id=t.id);
  with removed as (delete from products where id=any(ids) returning id)
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into deleted from removed;
  return jsonb_build_object('deleted_ids',deleted,'missing_ids',missing);
end;
$$;

create or replace function public.admin_catalog_schema_version()
returns integer language sql stable set search_path = public, pg_temp as $$ select 1 $$;

revoke all on function public.purge_unused_products(uuid[],text),public.admin_catalog_schema_version() from public,anon,authenticated;
grant execute on function public.purge_unused_products(uuid[],text),public.admin_catalog_schema_version() to service_role;

commit;
