begin;

do $$
begin
  if public.commerce_schema_version() <> 1 then raise exception 'Commerce prerequisites missing'; end if;
end;
$$;

create table if not exists public.inventory_adjustments (
  id uuid primary key,
  variant_id uuid not null references public.product_variants(id),
  mode text not null check (mode in ('restock','remove','count')),
  quantity integer not null check (quantity between 0 and 1000000),
  expected_stock integer not null check (expected_stock between 0 and 1000000),
  stock_before integer not null,
  stock_after integer not null check (stock_after between 0 and 1000000),
  reason text not null check (length(reason) between 3 and 300),
  product_name text not null,
  color text not null,
  size text not null,
  barcode text,
  created_at timestamptz not null default now()
);
create index if not exists inventory_adjustments_variant_date_idx on public.inventory_adjustments(variant_id, created_at desc);
alter table public.inventory_adjustments enable row level security;
revoke all on public.inventory_adjustments from public, anon, authenticated;
grant select, insert on public.inventory_adjustments to service_role;

alter table public.order_items add column if not exists prepared_quantity integer not null default 0;
alter table public.order_items drop constraint if exists order_items_prepared_quantity_check;
alter table public.order_items add constraint order_items_prepared_quantity_check check (prepared_quantity >= 0 and prepared_quantity <= quantity);
alter table public.orders add column if not exists prepared_at timestamptz;

create or replace function public.adjust_inventory(p_operation_id uuid, p_variant_id uuid, p_mode text, p_quantity integer, p_expected_stock integer, p_reason text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare v product_variants%rowtype; previous inventory_adjustments%rowtype; after_stock integer; label text;
begin
  if p_operation_id is null or p_variant_id is null or p_mode is null or p_mode not in ('restock','remove','count') or
     p_quantity is null or p_quantity < 0 or p_quantity > 1000000 or (p_mode <> 'count' and p_quantity = 0) or
     p_expected_stock is null or p_expected_stock < 0 or p_expected_stock > 1000000 or
     p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 300 then
    raise exception 'inventory_invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into previous from inventory_adjustments where id = p_operation_id;
  if found then
    if previous.variant_id <> p_variant_id or previous.mode <> p_mode or previous.quantity <> p_quantity or previous.expected_stock <> p_expected_stock or previous.reason <> btrim(p_reason) then
      raise exception 'inventory_operation_mismatch';
    end if;
    return jsonb_build_object('already', true, 'stock_before', previous.stock_before, 'stock_after', previous.stock_after, 'operation_id', previous.id);
  end if;
  select * into v from product_variants where id = p_variant_id for update;
  if not found then raise exception 'inventory_variant_missing'; end if;
  if p_mode = 'count' and v.stock <> p_expected_stock then raise exception 'inventory_stock_changed'; end if;
  after_stock := case p_mode when 'restock' then v.stock + p_quantity when 'remove' then v.stock - p_quantity else p_quantity end;
  if after_stock < 0 or after_stock > 1000000 then raise exception 'inventory_stock_bounds'; end if;
  select coalesce(nullif(name_fr,''),name_en,slug) into label from products where id = v.product_id;
  update product_variants set stock = after_stock where id = v.id;
  insert into inventory_adjustments(id,variant_id,mode,quantity,expected_stock,stock_before,stock_after,reason,product_name,color,size,barcode)
    values(p_operation_id,v.id,p_mode,p_quantity,p_expected_stock,v.stock,after_stock,btrim(p_reason),label,v.color,v.size,v.barcode);
  return jsonb_build_object('already', false, 'stock_before', v.stock, 'stock_after', after_stock, 'operation_id', p_operation_id);
end;
$$;

create or replace function public.set_preparation_quantity(p_order_id uuid, p_item_id uuid, p_quantity integer, p_expected_quantity integer)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; i order_items%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.status <> 'paid' or o.shipping_status is distinct from 'new' or o.stock_issue or o.refunded_cents <> 0 or o.admin_archived then raise exception 'preparation_order_unavailable'; end if;
  select * into i from order_items where id = p_item_id and order_id = o.id for update;
  if not found then raise exception 'preparation_item_missing'; end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > i.quantity or p_expected_quantity is null or p_expected_quantity < 0 or p_expected_quantity > i.quantity then raise exception 'preparation_quantity_invalid'; end if;
  if i.prepared_quantity = p_quantity then return jsonb_build_object('already',true,'quantity',i.prepared_quantity); end if;
  if i.prepared_quantity <> p_expected_quantity then raise exception 'preparation_changed'; end if;
  update order_items set prepared_quantity = p_quantity where id = i.id;
  update orders set prepared_at = null where id = o.id;
  return jsonb_build_object('already',false,'quantity',p_quantity);
end;
$$;

create or replace function public.complete_preparation(p_order_id uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; stamp timestamptz;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.status <> 'paid' or o.shipping_status is distinct from 'new' or o.stock_issue or o.refunded_cents <> 0 or o.admin_archived then raise exception 'preparation_order_unavailable'; end if;
  if not exists(select 1 from order_items where order_id=o.id) or exists(select 1 from order_items where order_id=o.id and prepared_quantity <> quantity) then raise exception 'preparation_incomplete'; end if;
  stamp := coalesce(o.prepared_at, now());
  update orders set prepared_at = stamp where id = o.id;
  return jsonb_build_object('already',o.prepared_at is not null,'prepared_at',stamp);
end;
$$;

create or replace function public.admin_inventory_schema_version()
returns integer language sql immutable set search_path = public, pg_temp as $$ select 1; $$;

do $$
declare signature text;
begin
  foreach signature in array array['adjust_inventory(uuid,uuid,text,integer,integer,text)', 'set_preparation_quantity(uuid,uuid,integer,integer)', 'complete_preparation(uuid)', 'admin_inventory_schema_version()'] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to service_role';
    execute 'alter function public.' || signature || ' security invoker';
  end loop;
end;
$$;

commit;
