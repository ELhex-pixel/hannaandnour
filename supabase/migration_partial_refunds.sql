-- Private refund journal and server-calculated quotes. Apply after the existing
-- commerce/admin migrations, first in an isolated test database. No existing
-- order is modified by installation. No Stripe request or email is made here.
begin;
create table if not exists public.order_refund_operations (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete restrict,
  kind text not null check(kind in ('partial','full')),
  request jsonb not null,
  reason text not null,
  amount_cents integer not null check(amount_cents > 0),
  shipping_cents integer not null default 0 check(shipping_cents >= 0 and shipping_cents <= amount_cents),
  currency text not null check(currency in ('eur','usd')),
  base_refunded_cents integer not null check(base_refunded_cents >= 0),
  lines jsonb not null default '[]' check(jsonb_typeof(lines)='array'),
  status text not null default 'prepared' check(status in ('prepared','pending','succeeded','failed')),
  stripe_refund_id text unique,
  stripe_started_at timestamptz,
  email_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists one_open_order_refund on public.order_refund_operations(order_id) where status in ('prepared','pending');
alter table public.order_refund_operations enable row level security;
revoke all on public.order_refund_operations from public,anon,authenticated;
grant select,insert,update on public.order_refund_operations to service_role;
revoke delete on public.order_refund_operations from service_role;

create or replace function public.order_refund_quote(p_order uuid,p_kind text,p_items jsonb,p_shipping boolean)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; selected jsonb; result_lines jsonb := '[]'; x record;
  refunded_qty integer; amount bigint := 0; component bigint; shipping integer := 0;
  net bigint; tax_base bigint; known bigint;
begin
  select * into o from orders where id=p_order;
  if not found or o.status <> 'paid' or o.total_cents <= o.refunded_cents then raise exception 'refund_order_unavailable'; end if;
  if p_kind is null or p_kind not in ('partial','full') or p_shipping is null then raise exception 'refund_invalid'; end if;
  if exists(select 1 from order_refund_operations where order_id=o.id and status in ('prepared','pending')) then raise exception 'refund_order_busy'; end if;
  if p_kind='full' then
    return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'kind','full','amount_cents',o.total_cents-o.refunded_cents,'currency',o.currency,'refunded_cents',o.refunded_cents,'total_cents',o.total_cents,'shipping_cents',0,'lines','[]'::jsonb,'request',jsonb_build_object('kind','full','items','[]'::jsonb,'shipping',false));
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'refund_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) v where jsonb_typeof(v->'id') <> 'string' or not(v ? 'id') or not(v ? 'quantity') or jsonb_typeof(v->'quantity') <> 'number' or (v->>'quantity') !~ '^[1-9][0-9]{0,5}$') then raise exception 'refund_invalid'; end if;
  select jsonb_agg(jsonb_build_object('id',(v->>'id')::uuid,'quantity',(v->>'quantity')::integer) order by (v->>'id')::uuid) into selected from jsonb_array_elements(p_items) v;
  if (select count(distinct v->>'id') from jsonb_array_elements(selected) v) <> jsonb_array_length(selected) then raise exception 'refund_duplicate_item'; end if;
  if exists(select 1 from jsonb_array_elements(selected) v where not exists(select 1 from order_items where id=(v->>'id')::uuid and order_id=o.id)) then raise exception 'refund_item_unavailable'; end if;
  select coalesce(sum(amount_cents),0) into known from order_refund_operations where order_id=o.id and status='succeeded';
  if known <> o.refunded_cents then raise exception 'refund_external_reconciliation'; end if;
  net := o.subtotal_cents-o.discount_cents;
  if net < 0 or o.total_cents <> net+o.tax_cents+o.shipping_cents or
     exists(select 1 from order_items where order_id=o.id and (net_total_cents is null or quantity <= 0)) or
     (select coalesce(sum(net_total_cents),0) from order_items where order_id=o.id) <> net or
     (select coalesce(sum(unit_price_cents::bigint*quantity),0) from order_items where order_id=o.id) <> o.subtotal_cents or
     (net=0 and o.tax_cents<>0) then raise exception 'refund_allocation_unavailable'; end if;
  select coalesce(sum(case when net=0 then 0 else floor(o.tax_cents::numeric*net_total_cents/net) end),0) into tax_base from order_items where order_id=o.id;
  for x in
    with shares as (
      select i.*,case when net=0 then 0 else floor(o.tax_cents::numeric*i.net_total_cents/net)::bigint end as tax_share,
        case when net=0 then 0 else mod(o.tax_cents::numeric*i.net_total_cents,net) end as remainder
      from order_items i where i.order_id=o.id
    ), ranked as (select shares.*,row_number() over(order by remainder desc,id) as rank from shares)
    select ranked.*,net_total_cents+tax_share+case when rank <= o.tax_cents-tax_base then 1 else 0 end as gross,
      (v->>'quantity')::integer as requested
    from ranked join jsonb_array_elements(selected) v on ranked.id=(v->>'id')::uuid order by ranked.id
  loop
    select coalesce(sum((line->>'quantity')::integer),0) into refunded_qty
      from order_refund_operations r cross join lateral jsonb_array_elements(r.lines) line
      where r.order_id=o.id and r.status='succeeded' and line->>'id'=x.id::text;
    if x.requested > x.quantity-refunded_qty then raise exception 'refund_quantity_unavailable'; end if;
    -- Cumulative integer allocation: even repeated single-unit refunds add up
    -- to exactly the original discounted, tax-inclusive line amount.
    component := floor(x.gross::numeric*(refunded_qty+x.requested)/x.quantity)-floor(x.gross::numeric*refunded_qty/x.quantity);
    amount := amount+component;
    result_lines := result_lines || jsonb_build_array(jsonb_build_object('id',x.id,'product_name',x.product_name,'variant',x.variant,'quantity',x.requested,'sold_quantity',x.quantity,'already_refunded_quantity',refunded_qty,'amount_cents',component));
  end loop;
  if p_shipping then
    shipping := o.shipping_cents-coalesce((select sum(shipping_cents) from order_refund_operations where order_id=o.id and status='succeeded'),0);
    if shipping <= 0 then raise exception 'refund_shipping_unavailable'; end if;
    amount := amount+shipping;
  end if;
  if amount <= 0 or amount > o.total_cents-o.refunded_cents then raise exception 'refund_amount_unavailable'; end if;
  return jsonb_build_object('order_id',o.id,'order_number',o.order_number,'kind','partial','amount_cents',amount,'currency',o.currency,'refunded_cents',o.refunded_cents,'total_cents',o.total_cents,'shipping_cents',shipping,'lines',result_lines,'request',jsonb_build_object('kind','partial','items',selected,'shipping',p_shipping));
end; $$;

create or replace function public.claim_order_refund(p_id uuid,p_order uuid,p_kind text,p_items jsonb,p_shipping boolean,p_reason text,p_expected_amount integer,p_expected_currency text,p_expected_refunded integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; existing order_refund_operations%rowtype; q jsonb; requested jsonb;
begin
  if p_id is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'refund_invalid'; end if;
  select * into o from orders where id=p_order for update;
  if not found then raise exception 'refund_order_unavailable'; end if;
  requested := jsonb_build_object('kind',p_kind,'items',case when p_kind='full' then '[]'::jsonb else (select jsonb_agg(jsonb_build_object('id',(v->>'id')::uuid,'quantity',(v->>'quantity')::integer) order by (v->>'id')::uuid) from jsonb_array_elements(p_items) v) end,'shipping',case when p_kind='full' then false else p_shipping end);
  select * into existing from order_refund_operations where id=p_id;
  if found then
    if existing.order_id <> p_order or existing.request <> requested or existing.reason <> btrim(p_reason) or existing.amount_cents is distinct from p_expected_amount or existing.currency is distinct from p_expected_currency or existing.base_refunded_cents is distinct from p_expected_refunded then raise exception 'refund_operation_mismatch'; end if;
    return to_jsonb(existing);
  end if;
  q := order_refund_quote(p_order,p_kind,p_items,p_shipping);
  if (q->>'amount_cents')::integer is distinct from p_expected_amount or q->>'currency' is distinct from p_expected_currency or (q->>'refunded_cents')::integer is distinct from p_expected_refunded then raise exception 'refund_quote_changed'; end if;
  insert into order_refund_operations(id,order_id,kind,request,reason,amount_cents,shipping_cents,currency,base_refunded_cents,lines)
    values(p_id,o.id,p_kind,q->'request',btrim(p_reason),p_expected_amount,(q->>'shipping_cents')::integer,p_expected_currency,p_expected_refunded,q->'lines') returning * into existing;
  -- A partial monetary credit does not prove a physical return/cancellation.
  -- Prevent a later aggregate full-refund webhook from automatically restocking.
  if p_kind='partial' then update orders set refund_restock=false where id=o.id; end if;
  return to_jsonb(existing);
end; $$;

create or replace function public.start_order_refund(p_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare oid uuid; changed uuid;
begin
  select order_id into oid from order_refund_operations where id=p_id;
  perform 1 from orders where id=oid for update;
  update order_refund_operations set stripe_started_at=now(),updated_at=now() where id=p_id and status='prepared' and stripe_started_at is null returning id into changed;
  return changed is not null;
end; $$;

create or replace function public.finish_order_refund(p_id uuid,p_refund text,p_status text,p_amount integer,p_currency text,p_intent text,p_cumulative integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare oid uuid; o orders%rowtype; r order_refund_operations%rowtype;
begin
  select order_id into oid from order_refund_operations where id=p_id;
  select * into o from orders where id=oid for update;
  select * into r from order_refund_operations where id=p_id for update;
  if not found or p_status is null or p_status not in ('pending','succeeded','failed') or p_refund is null or p_refund !~ '^re_[A-Za-z0-9_]{1,110}$' or p_intent is null or p_intent !~ '^pi_[A-Za-z0-9_]{1,110}$' or p_amount is distinct from r.amount_cents or p_currency is distinct from r.currency or (o.payment_intent_id is not null and o.payment_intent_id <> p_intent) or (r.stripe_refund_id is not null and r.stripe_refund_id <> p_refund) then raise exception 'refund_result_mismatch'; end if;
  if r.status='succeeded' then return to_jsonb(r); end if;
  if r.status='failed' and p_status <> 'failed' then raise exception 'refund_result_mismatch'; end if;
  if p_status='succeeded' then
    if p_cumulative is null or p_cumulative < r.base_refunded_cents+r.amount_cents or p_cumulative > o.total_cents then raise exception 'refund_result_mismatch'; end if;
    perform reconcile_order_refund(o.id,p_intent,o.total_cents,o.currency,p_cumulative);
  end if;
  update order_refund_operations set stripe_refund_id=p_refund,status=p_status,updated_at=now() where id=r.id returning * into r;
  return to_jsonb(r);
end; $$;

create or replace function public.claim_order_refund_email(p_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed uuid;
begin
  update order_refund_operations set email_claimed_at=now() where id=p_id and status='succeeded' and email_claimed_at is null returning id into changed;
  return changed is not null;
end; $$;
create or replace function public.order_refund_info(p_order uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; items jsonb; history jsonb; pending uuid;
begin
  select * into o from orders where id=p_order;
  if not found then raise exception 'refund_order_unavailable'; end if;
  select jsonb_agg(jsonb_build_object('id',i.id,'product_name',i.product_name,'variant',i.variant,'quantity',i.quantity,
    'refunded_quantity',coalesce((select sum((line->>'quantity')::integer) from order_refund_operations r cross join lateral jsonb_array_elements(r.lines) line where r.order_id=o.id and r.status='succeeded' and line->>'id'=i.id::text),0)) order by i.id)
    into items from order_items i where i.order_id=o.id;
  select jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'status',r.status,'amount_cents',r.amount_cents,'currency',r.currency,'shipping_cents',r.shipping_cents,'reason',r.reason,'created_at',r.created_at,'lines',r.lines) order by r.created_at desc,r.id)
    into history from (select * from order_refund_operations where order_id=o.id order by created_at desc,id limit 20) r;
  select id into pending from order_refund_operations where order_id=o.id and status in ('prepared','pending');
  return jsonb_build_object('order_id',o.id,'refunded_cents',o.refunded_cents,'remaining_cents',greatest(0,o.total_cents-o.refunded_cents),'currency',o.currency,'items',coalesce(items,'[]'),'operations',coalesce(history,'[]'),'pending_operation',pending);
end; $$;
create or replace function public.admin_refunds_schema_version() returns integer language sql security invoker set search_path=public,pg_temp as $$ select 1 $$;

do $$ declare signature text; begin
  foreach signature in array array['order_refund_quote(uuid,text,jsonb,boolean)','claim_order_refund(uuid,uuid,text,jsonb,boolean,text,integer,text,integer)','start_order_refund(uuid)','finish_order_refund(uuid,text,text,integer,text,text,integer)','claim_order_refund_email(uuid)','order_refund_info(uuid)','admin_refunds_schema_version()'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
    execute 'grant execute on function public.'||signature||' to service_role';
  end loop;
end $$;
commit;
