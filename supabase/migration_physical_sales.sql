begin;
do $$ begin
  if public.product_catalog_deletion_schema_version() <> 1 or public.admin_operations_schema_version() <> 1 then raise exception 'Physical sale prerequisites missing'; end if;
end $$;
alter table public.orders add column if not exists sale_channel text not null default 'online' check(sale_channel in ('online','physical'));
alter table public.orders add column if not exists external_payment_method text check(external_payment_method in ('cash','card','other'));
create table if not exists public.physical_sale_operations (
  id uuid primary key,
  order_id uuid not null unique references public.orders(id),
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.physical_sale_operations enable row level security;
revoke all on public.physical_sale_operations from public,anon,authenticated;
grant select,insert on public.physical_sale_operations to service_role;

-- Both quote and commit read current prices, currency, tax and real stock.
-- Locks use the same product -> variant order as online reservations.
create or replace function public.quote_physical_sale(p_items jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare row jsonb; v product_variants%rowtype; p products%rowtype; lines jsonb := '[]';
  subtotal bigint := 0; tax bigint; rate numeric; currency text; ids uuid[];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'physical_invalid'; end if;
  for row in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(row) <> 'object' or row->>'variant_id' is null or
       row->>'variant_id' !~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' or
       jsonb_typeof(row->'quantity') is distinct from 'number' or row->>'quantity' !~ '^[0-9]+$' or
       (row->>'quantity')::numeric not between 1 and 100 then raise exception 'physical_invalid'; end if;
  end loop;
  select array_agg((value->>'variant_id')::uuid order by value->>'variant_id') into ids from jsonb_array_elements(p_items);
  if cardinality(ids) <> (select count(distinct id) from unnest(ids) t(id)) then raise exception 'physical_invalid'; end if;
  perform set_config('lock_timeout','5s',true);
  perform prod.id from products prod where exists(select 1 from product_variants pv where pv.product_id=prod.id and pv.id=any(ids)) order by prod.id for update;
  perform id from product_variants where id=any(ids) order by id for update;
  perform key from settings where key in ('currency','shipping') order by key for share;
  select value->>'code' into currency from settings where key='currency';
  if currency is null or currency not in ('eur','usd') then raise exception 'physical_config'; end if;
  select (value->>'tax_rate')::numeric into rate from settings where key='shipping';
  rate := coalesce(rate,0.07);
  if rate < 0 or rate > 1 then raise exception 'physical_config'; end if;
  for row in select value from jsonb_array_elements(p_items) order by value->>'variant_id' loop
    select * into v from product_variants where id=(row->>'variant_id')::uuid;
    if not found then raise exception 'physical_unavailable'; end if;
    select * into p from products where id=v.product_id;
    if not found or not p.active or p.catalog_deleted_at is not null or not v.active or p.price_cents < 0 then raise exception 'physical_unavailable'; end if;
    if v.stock < (row->>'quantity')::integer then raise exception 'physical_stock'; end if;
    subtotal := subtotal + p.price_cents::bigint*(row->>'quantity')::integer;
    lines := lines || jsonb_build_array(jsonb_build_object('variant_id',v.id,'quantity',(row->>'quantity')::integer,
      'unit_price_cents',p.price_cents,'name',coalesce(nullif(p.name_fr,''),p.name_en),'color',v.color,'size',v.size,'stock',v.stock));
  end loop;
  tax := round(subtotal*rate);
  if subtotal+tax > 2000000000 then raise exception 'physical_invalid'; end if;
  return jsonb_build_object('currency',currency,'tax_rate',rate,'subtotal_cents',subtotal,'tax_cents',tax,'total_cents',subtotal+tax,'items',lines);
end $$;

create or replace function public.record_physical_sale(p_operation uuid,p_items jsonb,p_quote jsonb,p_method text,p_note text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous physical_sale_operations%rowtype; request jsonb; q jsonb; row jsonb; v product_variants%rowtype; p products%rowtype;
  number text; result jsonb;
begin
  if p_operation is null or p_method is null or p_method not in ('cash','card','other') or p_note is null or length(p_note)>300 or p_quote is null then raise exception 'physical_invalid'; end if;
  request := jsonb_build_object('items',p_items,'quote',p_quote,'method',p_method,'note',p_note);
  perform pg_advisory_xact_lock(hashtextextended(p_operation::text,0));
  select * into previous from physical_sale_operations where id=p_operation;
  if found then
    if previous.request is distinct from request then raise exception 'physical_operation_mismatch'; end if;
    return previous.result || jsonb_build_object('already',true);
  end if;
  q := quote_physical_sale(p_items);
  if q is distinct from p_quote then raise exception 'physical_quote_changed'; end if;
  number := 'HN-P-' || upper(replace(p_operation::text,'-',''));
  insert into orders(id,order_number,email,customer_name,address1,city,state,postal_code,country,shipping_method,
    subtotal_cents,tax_cents,shipping_cents,discount_cents,total_cents,currency,status,paid_at,
    shipping_status,delivered_at,delivery_type,prepared_at,confirmation_claimed_at,
    inventory_reserved,stock_issue,refund_restock,sale_channel,external_payment_method)
  values(p_operation,number,'','Vente comptoir','','','','','FR','pickup',
    (q->>'subtotal_cents')::integer,(q->>'tax_cents')::integer,0,0,(q->>'total_cents')::integer,q->>'currency','paid',now(),
    'delivered',now(),'pickup',now(),now(),false,false,false,'physical',p_method);
  for row in select value from jsonb_array_elements(q->'items') loop
    select * into v from product_variants where id=(row->>'variant_id')::uuid;
    select * into p from products where id=v.product_id;
    update product_variants set stock=stock-(row->>'quantity')::integer where id=v.id;
    insert into order_items(order_id,product_id,product_slug,product_name,image,variant,variant_id,unit_price_cents,quantity,net_total_cents,stock_debited,prepared_quantity)
    values(p_operation,p.id,p.slug,row->>'name',p.image,concat_ws(' / ',nullif(v.color,''),nullif(v.size,'')),v.id,p.price_cents,
      (row->>'quantity')::integer,p.price_cents*(row->>'quantity')::integer,true,(row->>'quantity')::integer);
  end loop;
  result := jsonb_build_object('operation_id',p_operation,'order_id',p_operation,'order_number',number,'total_cents',q->'total_cents','currency',q->>'currency','already',false);
  insert into physical_sale_operations(id,order_id,request,result) values(p_operation,p_operation,request,result);
  return result;
end $$;
create or replace function public.physical_sales_schema_version()
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$select 1$$;
do $$ declare signature text; begin
  foreach signature in array array['quote_physical_sale(jsonb)','record_physical_sale(uuid,jsonb,jsonb,text,text)','physical_sales_schema_version()'] loop
    execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
    execute 'grant execute on function public.'||signature||' to service_role';
  end loop;
end $$;
commit;
