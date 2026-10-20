begin;
do $$ begin
  if public.checkout_pickup_schema_version()<>1 or public.admin_refunds_schema_version()<>1 then raise exception 'Shipping prerequisites missing'; end if;
end $$;
create table if not exists public.order_shipping_operations (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  request jsonb not null,
  provider_request jsonb not null,
  order_guard jsonb not null,
  state text not null default 'pending' check(state in ('pending','ready','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create unique index if not exists one_active_order_shipment on public.order_shipping_operations(order_id) where state in ('pending','ready');
alter table public.order_shipping_operations enable row level security;
revoke all on public.order_shipping_operations from public,anon,authenticated,service_role;
grant select,insert,update on public.order_shipping_operations to service_role;
create or replace function public.protect_order_shipping_operation()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id or new.request is distinct from old.request
    or new.provider_request is distinct from old.provider_request or new.order_guard is distinct from old.order_guard or new.created_at is distinct from old.created_at
    or (old.state<>'pending' and new is distinct from old) then raise exception 'shipping_operation_immutable'; end if;
  return new;
end $$;
drop trigger if exists protect_order_shipping_operation on public.order_shipping_operations;
create trigger protect_order_shipping_operation before update on public.order_shipping_operations for each row execute function public.protect_order_shipping_operation();

create or replace function public.shipping_order_guard(p_order uuid)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('order_id',o.id,'order_number',o.order_number,'status',o.status,'sale_channel',o.sale_channel,
    'shipping_status',o.shipping_status,'prepared_at',o.prepared_at,'refunded_cents',o.refunded_cents,'stock_issue',o.stock_issue,
    'inventory_reserved',o.inventory_reserved,'admin_archived',o.admin_archived,'delivery_type',o.delivery_type,'pickup_point_data',o.pickup_point_data,
    'customer_name',o.customer_name,'email',o.email,'phone',o.phone,'total_cents',o.total_cents,'currency',o.currency,'tracking_number',o.tracking_number,'carrier',o.carrier,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'quantity',i.quantity,'prepared_quantity',i.prepared_quantity,'stock_debited',i.stock_debited) order by i.id) from order_items i where i.order_id=o.id),'[]'::jsonb),
    'refund_busy',exists(select 1 from order_refund_operations r where r.order_id=o.id and r.status in ('prepared','pending')),
    'return_count',(select count(*) from order_returns r where r.order_id=o.id)+(select count(*) from return_requests r where r.order_id=o.id and r.status<>'rejected'))
  from orders o where o.id=p_order
$$;

create or replace function public.claim_order_shipping(p_id uuid,p_order uuid,p_request jsonb,p_provider_request jsonb,p_guard jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous order_shipping_operations%rowtype; current_guard jsonb; row jsonb;
begin
  if p_id is null or p_order is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_provider_request) is distinct from 'object' or jsonb_typeof(p_guard) is distinct from 'object' then raise exception 'shipping_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into previous from order_shipping_operations where id=p_id;
  if found then
    if previous.order_id<>p_order or previous.request is distinct from p_request then raise exception 'shipping_operation_mismatch'; end if;
    return to_jsonb(previous);
  end if;
  perform id from orders where id=p_order for update;
  if not found then raise exception 'shipping_order_unavailable'; end if;
  perform id from order_items where order_id=p_order order by id for share;
  current_guard:=shipping_order_guard(p_order);
  if current_guard is distinct from p_guard then raise exception 'shipping_quote_changed'; end if;
  if current_guard->>'status'<>'paid' or current_guard->>'sale_channel'<>'online' or current_guard->>'shipping_status'<>'new'
    or current_guard->>'prepared_at' is null or (current_guard->>'refunded_cents')::integer<>0 or (current_guard->>'stock_issue')::boolean
    or (current_guard->>'inventory_reserved')::boolean or (current_guard->>'admin_archived')::boolean or (current_guard->>'refund_busy')::boolean
    or (current_guard->>'return_count')::integer<>0 or current_guard->>'delivery_type'<>'pickup' or jsonb_typeof(current_guard->'pickup_point_data') is distinct from 'object'
    or current_guard->>'currency'<>'eur' or nullif(btrim(current_guard->>'phone'),'') is null or nullif(btrim(current_guard->>'customer_name'),'') is null
    or nullif(current_guard->>'tracking_number','') is not null or (current_guard->>'carrier' is not null and current_guard->>'carrier'<>'mondialrelay')
    or jsonb_array_length(current_guard->'items')=0 then raise exception 'shipping_order_unavailable'; end if;
  for row in select value from jsonb_array_elements(current_guard->'items') loop
    if (row->>'quantity')::integer<>(row->>'prepared_quantity')::integer or not (row->>'stock_debited')::boolean then raise exception 'shipping_order_unavailable'; end if;
  end loop;
  if exists(select 1 from order_shipping_operations where order_id=p_order and state in ('pending','ready')) then raise exception 'shipping_order_busy'; end if;
  if p_provider_request->>'external_reference_id' is distinct from 'hn-label-'||p_id::text or p_provider_request->>'order_number' is distinct from current_guard->>'order_number' then raise exception 'shipping_invalid'; end if;
  insert into order_shipping_operations(id,order_id,request,provider_request,order_guard) values(p_id,p_order,p_request,p_provider_request,p_guard) returning * into previous;
  return to_jsonb(previous);
end $$;

create or replace function public.finish_order_shipping(p_id uuid,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous order_shipping_operations%rowtype; o orders%rowtype; attention boolean;
begin
  select * into previous from order_shipping_operations where id=p_id for update;
  if not found or jsonb_typeof(p_result) is distinct from 'object' or p_result->>'operation_id' is distinct from p_id::text or coalesce(p_result->>'state' not in ('ready','failed'),true)
    or p_result->>'shipment_id' is null or p_result->>'parcel_id' is null or p_result->>'parcel_id' !~ '^[1-9][0-9]*$' then raise exception 'shipping_result_invalid'; end if;
  if previous.state<>'pending' then return to_jsonb(previous); end if;
  select * into o from orders where id=previous.order_id for update;
  attention:=shipping_order_guard(previous.order_id) is distinct from previous.order_guard;
  if p_result->>'state'='ready' then
    if nullif(p_result->>'tracking_number','') is null then raise exception 'shipping_result_invalid'; end if;
    if not attention then update orders set carrier='mondialrelay',tracking_number=p_result->>'tracking_number' where id=o.id; end if;
  end if;
  update order_shipping_operations set state=p_result->>'state',result=p_result||jsonb_build_object('order_attention',attention),confirmed_at=now() where id=p_id returning * into previous;
  return to_jsonb(previous);
end $$;

create or replace function public.order_shipping_schema_version()
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$select 1$$;
revoke all on function public.protect_order_shipping_operation(),public.shipping_order_guard(uuid),public.claim_order_shipping(uuid,uuid,jsonb,jsonb,jsonb),public.finish_order_shipping(uuid,jsonb),public.order_shipping_schema_version() from public,anon,authenticated;
grant execute on function public.protect_order_shipping_operation(),public.shipping_order_guard(uuid),public.claim_order_shipping(uuid,uuid,jsonb,jsonb,jsonb),public.finish_order_shipping(uuid,jsonb),public.order_shipping_schema_version() to service_role;
commit;
