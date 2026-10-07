begin;

do $$
begin
  if public.admin_inventory_schema_version() <> 1 then raise exception 'Inventory prerequisites missing'; end if;
end;
$$;

alter table public.orders add column if not exists return_policy jsonb;
update public.orders set return_policy = jsonb_build_object('version','legacy','days',greatest(30,coalesce((select (value->>'returns_days')::integer from settings where key='shipping'),30)),'withdrawal_payer','customer','fault_payer','store') where return_policy is null;
alter table public.orders alter column return_policy set not null;

create or replace function public.snapshot_return_policy()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare policy jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.return_policy is distinct from old.return_policy then raise exception 'policy_immutable'; end if;
    return new;
  end if;
  select value into policy from settings where key='return_policy';
  if new.return_policy is not null and new.return_policy->>'version' is distinct from coalesce(policy->>'version','initial') then raise exception 'policy_changed'; end if;
  new.return_policy := coalesce(policy,jsonb_build_object('version','initial','days',greatest(30,coalesce((select (value->>'returns_days')::integer from settings where key='shipping'),30)),'withdrawal_payer','customer','fault_payer','store'));
  return new;
end;
$$;
drop trigger if exists orders_return_policy_snapshot on public.orders;
create trigger orders_return_policy_snapshot before insert or update on public.orders for each row execute function public.snapshot_return_policy();

create or replace function public.save_return_policy(p_days integer, p_payer text, p_expected_version text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare policy jsonb; result jsonb;
begin
  if p_days is null or p_days < 30 or p_days > 365 or p_payer is null or p_payer not in ('customer','store') then raise exception 'policy_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hn-return-policy',0));
  select value into policy from settings where key='return_policy' for update;
  if coalesce(policy->>'version','initial') is distinct from p_expected_version then raise exception 'policy_changed'; end if;
  result := jsonb_build_object('version',gen_random_uuid()::text,'days',p_days,'withdrawal_payer',p_payer,'fault_payer','store');
  insert into settings(key,value) values('return_policy',result) on conflict(key) do update set value=excluded.value,updated_at=now();
  return result;
end;
$$;

alter table public.return_requests add column if not exists category text not null default 'withdrawal' check (category in ('withdrawal','seller_error','nonconforming'));
alter table public.return_requests add column if not exists shipping_payer text check (shipping_payer in ('customer','store'));
alter table public.return_requests add column if not exists decision_note text;
alter table public.order_returns add column if not exists sellable_quantity integer;
alter table public.order_returns add column if not exists inspection_note text;
alter table public.order_returns drop constraint if exists order_returns_sellable_quantity_check;
alter table public.order_returns add constraint order_returns_sellable_quantity_check check (sellable_quantity >= 0 and sellable_quantity <= quantity);

create or replace function public.inspect_order_return(p_order_id uuid, p_item_id uuid, p_quantity integer, p_ref text, p_reason text, p_sellable integer, p_note text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; i order_items%rowtype; existing order_returns%rowtype; returned integer; cents integer; net integer;
begin
  if p_ref is null or length(p_ref) < 1 or length(p_ref) > 100 or p_quantity is null or p_quantity < 1 or p_sellable is null or p_sellable < 0 or p_sellable > p_quantity or p_note is null or length(btrim(p_note)) < 3 or length(btrim(p_note)) > 500 then raise exception 'return_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_ref,0));
  select * into o from orders where id=p_order_id for update;
  if not found then raise exception 'return_order_unavailable'; end if;
  select * into i from order_items where id=p_item_id and order_id=o.id for update;
  if not found then raise exception 'return_item_missing'; end if;
  select * into existing from order_returns where return_ref=p_ref;
  if found then
    if existing.order_id <> o.id or existing.order_item_id <> i.id or existing.quantity <> p_quantity or existing.sellable_quantity is distinct from p_sellable or existing.inspection_note is distinct from btrim(p_note) or existing.reason is distinct from left(p_reason,500) then raise exception 'return_operation_mismatch'; end if;
    return jsonb_build_object('ok',true,'already',true,'refundCents',existing.total_refund_cents,'sellable_quantity',existing.sellable_quantity);
  end if;
  if o.status not in ('paid','refunded','cancelled') or o.shipping_status not in ('shipped','delivered') or not i.stock_debited then raise exception 'return_order_unavailable'; end if;
  select coalesce(sum(quantity),0) into returned from order_returns where order_item_id=i.id;
  if p_quantity > i.quantity-returned then raise exception 'return_quantity_unavailable'; end if;
  if exists(select 1 from return_requests where order_item_id=i.id and status in ('requested','approved') and id::text <> p_ref) then raise exception 'return_request_open'; end if;
  net := coalesce(i.net_total_cents,round(i.unit_price_cents::numeric*i.quantity*greatest(0,o.subtotal_cents-o.discount_cents)/greatest(1,o.subtotal_cents)));
  cents := round(net::numeric*(returned+p_quantity)/i.quantity)-round(net::numeric*returned/i.quantity);
  insert into order_returns(return_ref,order_id,order_item_id,product_slug,quantity,unit_price_cents,total_refund_cents,reason,sellable_quantity,inspection_note)
    values(p_ref,o.id,i.id,i.product_slug,p_quantity,i.unit_price_cents,cents,left(p_reason,500),p_sellable,btrim(p_note));
  if p_sellable > 0 and i.variant_id is not null then
    update product_variants set stock=stock+p_sellable where id=i.variant_id and stock+p_sellable <= 1000000;
    if not found then raise exception 'return_variant_unavailable'; end if;
  end if;
  return jsonb_build_object('ok',true,'already',false,'refundCents',cents,'sellable_quantity',p_sellable);
end;
$$;

create or replace function public.inspect_return_request(p_id uuid, p_sellable integer, p_note text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r return_requests%rowtype; result jsonb;
begin
  select * into r from return_requests where id=p_id;
  if not found then raise exception 'return_request_missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  perform id from orders where id=r.order_id for update;
  select * into r from return_requests where id=p_id for update;
  if r.status not in ('approved','received') then raise exception 'return_not_approved'; end if;
  result := inspect_order_return(r.order_id,r.order_item_id,r.quantity,r.id::text,r.reason,p_sellable,p_note);
  update return_requests set status='received',updated_at=now() where id=r.id and status='approved';
  return result;
end;
$$;

create or replace function public.decide_return_request(p_id uuid, p_status text, p_payer text, p_note text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r return_requests%rowtype; o orders%rowtype;
begin
  if p_status is null or p_status not in ('approved','rejected') or p_payer is null or p_payer not in ('customer','store') or p_note is null or length(btrim(p_note)) < 3 or length(btrim(p_note)) > 500 then raise exception 'return_invalid'; end if;
  select * into r from return_requests where id=p_id;
  if not found then raise exception 'return_request_missing'; end if;
  select * into o from orders where id=r.order_id for update;
  select * into r from return_requests where id=p_id for update;
  if (r.category <> 'withdrawal' or o.return_policy->>'withdrawal_payer' = 'store') and p_payer <> 'store' then raise exception 'return_store_payer_required'; end if;
  if r.status=p_status then
    if r.shipping_payer is distinct from p_payer or r.decision_note is distinct from btrim(p_note) then raise exception 'return_operation_mismatch'; end if;
    return jsonb_build_object('ok',true,'already',true);
  end if;
  if r.status <> 'requested' then raise exception 'return_transition_unavailable'; end if;
  update return_requests set status=p_status,shipping_payer=p_payer,decision_note=btrim(p_note),updated_at=now() where id=r.id;
  return jsonb_build_object('ok',true,'already',false);
end;
$$;

create or replace function public.record_order_return(p_order_id uuid, p_item_id uuid, p_quantity integer, p_ref text, p_reason text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'return_inspection_required'; end;
$$;

create or replace function public.restock_order(p_order_id uuid)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; r record;
begin
  select * into o from orders where id=p_order_id for update;
  if not found or o.status not in ('refunded','cancelled') or not o.refund_restock or o.shipping_status <> 'new' or o.shipped_at is not null or o.delivered_at is not null then return false; end if;
  for r in select i.variant_id,sum(greatest(0,i.quantity-coalesce((select sum(quantity) from order_returns where order_item_id=i.id),0)))::integer as qty
    from order_items i where i.order_id=o.id and i.stock_debited and i.variant_id is not null group by i.variant_id order by i.variant_id loop
    update product_variants set stock=stock+r.qty where id=r.variant_id;
  end loop;
  update order_items set stock_debited=false where order_id=o.id;
  return true;
end;
$$;
create or replace function public.receive_return_request(p_id uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'return_inspection_required'; end;
$$;

create or replace function public.request_return(p_user_id uuid, p_order_id uuid, p_item_id uuid, p_quantity integer, p_reason text, p_days integer, p_category text default 'withdrawal')
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; i order_items%rowtype; returned integer; request_id uuid;
begin
  if p_category is null or p_category not in ('withdrawal','seller_error','nonconforming') then raise exception 'Invalid category'; end if;
  select * into o from orders where id=p_order_id and user_id=p_user_id for update;
  if not found or o.status not in ('paid','refunded') or o.shipping_status <> 'delivered' or o.delivered_at is null then raise exception 'Order ineligible'; end if;
  if p_category='withdrawal' and o.delivered_at < now()-make_interval(days => greatest(14,(o.return_policy->>'days')::integer)) then raise exception 'Return window expired'; end if;
  select * into i from order_items where id=p_item_id and order_id=o.id for update;
  if not found or not i.stock_debited then raise exception 'Item unavailable'; end if;
  select coalesce(sum(quantity),0) into returned from order_returns where order_item_id=i.id;
  if p_quantity is null or p_quantity < 1 or p_quantity > i.quantity-returned or p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'Invalid return'; end if;
  insert into return_requests(user_id,order_id,order_item_id,quantity,reason,category) values(p_user_id,o.id,i.id,p_quantity,left(p_reason,1000),p_category) returning id into request_id;
  return request_id;
end;
$$;
drop function if exists public.request_return(uuid,uuid,uuid,integer,text,integer);

create table if not exists public.variant_costs (
  variant_id uuid primary key references public.product_variants(id),
  unit_cost_cents integer check (unit_cost_cents between 0 and 100000000),
  currency text not null check (currency in ('eur','usd')),
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.variant_cost_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id),
  unit_cost_cents integer,
  currency text not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.order_item_costs (
  order_item_id uuid primary key references public.order_items(id),
  unit_cost_cents integer,
  currency text not null,
  created_at timestamptz not null default now()
);
alter table public.variant_costs enable row level security;
alter table public.variant_cost_history enable row level security;
alter table public.order_item_costs enable row level security;
revoke all on public.variant_costs,public.variant_cost_history,public.order_item_costs from public,anon,authenticated;
grant select,insert,update on public.variant_costs to service_role;
grant select,insert on public.variant_cost_history,public.order_item_costs to service_role;

create or replace function public.save_variant_cost(p_variant_id uuid, p_cents integer, p_currency text, p_expected timestamptz, p_reason text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare previous variant_costs%rowtype; result variant_costs%rowtype;
begin
  if p_variant_id is null or p_currency is null or p_currency not in ('eur','usd') or p_cents < 0 or p_cents > 100000000 or p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 300 then raise exception 'cost_invalid'; end if;
  perform id from product_variants where id=p_variant_id for update;
  if not found then raise exception 'cost_variant_missing'; end if;
  select * into previous from variant_costs where variant_id=p_variant_id;
  if found and previous.unit_cost_cents is not distinct from p_cents and previous.currency=p_currency then return to_jsonb(previous); end if;
  if previous.updated_at is distinct from p_expected then raise exception 'cost_changed'; end if;
  insert into variant_costs(variant_id,unit_cost_cents,currency) values(p_variant_id,p_cents,p_currency) on conflict(variant_id) do update set unit_cost_cents=excluded.unit_cost_cents,currency=excluded.currency,updated_at=clock_timestamp() returning * into result;
  insert into variant_cost_history(variant_id,unit_cost_cents,currency,reason) values(p_variant_id,p_cents,p_currency,btrim(p_reason));
  return to_jsonb(result);
end;
$$;

create or replace function public.snapshot_item_cost()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare cost variant_costs%rowtype; cur text;
begin
  select currency into cur from orders where id=new.order_id;
  select * into cost from variant_costs where variant_id=new.variant_id;
  insert into order_item_costs(order_item_id,unit_cost_cents,currency) values(new.id,case when cost.currency=cur then cost.unit_cost_cents else null end,cur);
  return new;
end;
$$;
drop trigger if exists order_items_cost_snapshot on public.order_items;
create trigger order_items_cost_snapshot after insert on public.order_items for each row execute function public.snapshot_item_cost();

create or replace function public.admin_operations_schema_version()
returns integer language sql immutable set search_path = public, pg_temp as $$ select 1; $$;
do $$
declare signature text;
begin
  foreach signature in array array['snapshot_return_policy()','save_return_policy(integer,text,text)','inspect_order_return(uuid,uuid,integer,text,text,integer,text)','inspect_return_request(uuid,integer,text)','decide_return_request(uuid,text,text,text)','record_order_return(uuid,uuid,integer,text,text)','restock_order(uuid)','receive_return_request(uuid)','request_return(uuid,uuid,uuid,integer,text,integer,text)','save_variant_cost(uuid,integer,text,timestamp with time zone,text)','snapshot_item_cost()','admin_operations_schema_version()'] loop
    execute 'revoke all on function public.' || signature || ' from public,anon,authenticated';
    execute 'grant execute on function public.' || signature || ' to service_role';
    execute 'alter function public.' || signature || ' security invoker';
  end loop;
end;
$$;

commit;
