begin;

drop policy if exists "public_insert_reviews" on public.reviews;
drop policy if exists "public_insert_newsletter" on public.newsletter;
alter table public.blog_posts enable row level security;
alter table public.demo_reviews enable row level security;

alter table public.orders add column if not exists inventory_reserved boolean not null default false;
alter table public.orders add column if not exists stock_issue boolean not null default false;
alter table public.orders add column if not exists confirmation_claimed_at timestamptz;
alter table public.orders add column if not exists admin_archived boolean not null default false;
alter table public.orders add column if not exists payment_intent_id text;
alter table public.orders add column if not exists refunded_cents integer not null default 0;
alter table public.orders add column if not exists carrier text;
alter table public.orders add column if not exists stripe_creation_started boolean not null default false;
alter table public.orders add column if not exists refund_restock boolean not null default true;
alter table public.order_items add column if not exists stock_debited boolean not null default false;
alter table public.order_items add column if not exists net_total_cents integer check (net_total_cents >= 0);
alter table public.promo_codes add column if not exists reserved_order_id uuid references public.orders(id) on delete set null;
create index if not exists orders_normalized_email_idx on public.orders (lower(btrim(email)));
create unique index if not exists orders_order_number_unique on public.orders(order_number);
create unique index if not exists reviews_purchase_product_unique on public.reviews(order_id, product_id) where order_id is not null;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending','paid','abandoned','refunded','cancelled','payment_failed'));

create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
alter table public.rate_limits enable row level security;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  if p_limit < 1 or p_seconds < 1 or length(p_key) <> 64 then return false; end if;
  insert into rate_limits(key, window_start, count) values (p_key, now(), 1)
  on conflict(key) do update set
    count = case when rate_limits.window_start <= now() - make_interval(secs => p_seconds) then 1 else rate_limits.count + 1 end,
    window_start = case when rate_limits.window_start <= now() - make_interval(secs => p_seconds) then now() else rate_limits.window_start end
  returning count into n;
  return n <= p_limit;
end;
$$;

create or replace function public.reserve_order(p_order_id uuid)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; r record; v product_variants%rowtype; promo promo_codes%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.status <> 'pending' then return false; end if;
  if o.inventory_reserved then return true; end if;
  for r in select variant_id, sum(quantity)::integer as qty from order_items
           where order_id = o.id and variant_id is not null group by variant_id order by variant_id loop
    select * into v from product_variants where id = r.variant_id for update;
    if not found or not v.active or v.stock < r.qty then return false; end if;
  end loop;
  if o.promo_code is not null then
    select * into promo from promo_codes where code = o.promo_code for update;
    if not found or not promo.active or (promo.expires_at is not null and promo.expires_at <= now()) then return false; end if;
    if promo.single_use and promo.used_count > 0 then return false; end if;
    if promo.single_use then update promo_codes set used_count = 1, reserved_order_id = o.id where code = promo.code; end if;
  end if;
  for r in select variant_id, sum(quantity)::integer as qty from order_items
           where order_id = o.id and variant_id is not null group by variant_id order by variant_id loop
    update product_variants set stock = stock - r.qty where id = r.variant_id;
  end loop;
  update order_items set stock_debited = true where order_id = o.id and variant_id is not null;
  update orders set inventory_reserved = true where id = o.id;
  return true;
end;
$$;

create or replace function public.release_order(p_order_id uuid, p_status text default 'abandoned')
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; r record;
begin
  if p_status not in ('abandoned','payment_failed') then raise exception 'Invalid release status'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found or o.status not in ('pending','abandoned','payment_failed') then return false; end if;
  for r in select variant_id, sum(quantity)::integer as qty from order_items
           where order_id = o.id and stock_debited and variant_id is not null group by variant_id order by variant_id loop
    update product_variants set stock = stock + r.qty where id = r.variant_id;
  end loop;
  update order_items set stock_debited = false where order_id = o.id;
  update orders set inventory_reserved = false, status = p_status where id = o.id;
  update promo_codes set used_count = 0, reserved_order_id = null where reserved_order_id = o.id;
  return true;
end;
$$;

create or replace function public.finalize_order_payment(p_order_id uuid, p_session_id text, p_amount integer, p_currency text, p_intent text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; r record; v product_variants%rowtype; available boolean := true;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_amount is null or p_currency is null or p_session_id is null or p_session_id = '' or o.total_cents <> p_amount or o.currency <> p_currency or (o.stripe_session_id is not null and o.stripe_session_id <> p_session_id) then
    raise exception 'Payment mismatch';
  end if;
  if o.status in ('paid','refunded','cancelled') then return jsonb_build_object('changed', false); end if;
  if not o.inventory_reserved then
    for r in select variant_id, sum(quantity)::integer as qty from order_items
             where order_id = o.id and variant_id is not null group by variant_id order by variant_id loop
      select * into v from product_variants where id = r.variant_id for update;
      if not found or v.stock < r.qty or not v.active then available := false; end if;
    end loop;
    if available then
      for r in select variant_id, sum(quantity)::integer as qty from order_items
               where order_id = o.id and variant_id is not null group by variant_id order by variant_id loop
        update product_variants set stock = stock - r.qty where id = r.variant_id;
      end loop;
      update order_items set stock_debited = true where order_id = o.id and variant_id is not null;
    end if;
  end if;
  update orders set status = 'paid', paid_at = now(), inventory_reserved = false,
    stock_issue = not available, admin_archived = false, stripe_session_id = p_session_id, payment_intent_id = p_intent where id = o.id;
  update promo_codes set used_count = 1, reserved_order_id = null where code = o.promo_code and single_use;
  return jsonb_build_object('changed', true, 'stock_issue', not available);
end;
$$;

create or replace function public.restock_order(p_order_id uuid)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; r record;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.status not in ('refunded','cancelled') or not o.refund_restock or (o.shipping_status <> 'new' and o.cancel_reason is distinct from 'out_of_stock') then return false; end if;
  for r in select i.variant_id, sum(greatest(0, i.quantity - coalesce((select sum(quantity) from order_returns where order_item_id = i.id), 0)))::integer as qty
           from order_items i where i.order_id = o.id and i.stock_debited and i.variant_id is not null group by i.variant_id order by i.variant_id loop
    update product_variants set stock = stock + r.qty where id = r.variant_id;
  end loop;
  update order_items set stock_debited = false where order_id = o.id;
  return true;
end;
$$;

create or replace function public.reconcile_order_refund(p_order_id uuid, p_intent text, p_amount integer, p_currency text, p_refunded integer)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if p_intent is null or p_amount is null or p_currency is null or p_refunded is null or p_refunded < 0 or p_refunded > p_amount or o.total_cents <> p_amount or o.currency <> p_currency or (o.payment_intent_id is not null and o.payment_intent_id <> p_intent) then raise exception 'Refund mismatch'; end if;
  update orders set payment_intent_id = p_intent, refunded_cents = greatest(refunded_cents,p_refunded),
    status = case when greatest(refunded_cents,p_refunded) = total_cents and status <> 'cancelled' then 'refunded' else status end
  where id = o.id;
  if p_refunded = p_amount then
    perform restock_order(o.id);
    update orders set inventory_reserved = false where id = o.id;
  end if;
  return true;
end;
$$;

create or replace function public.record_order_return(p_order_id uuid, p_item_id uuid, p_quantity integer, p_ref text, p_reason text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; i order_items%rowtype; returned integer; cents integer; existing order_returns%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.status <> 'paid' then raise exception 'Order unavailable'; end if;
  select * into i from order_items where id = p_item_id and order_id = o.id for update;
  if not found then raise exception 'Item unavailable'; end if;
  select * into existing from order_returns where return_ref = p_ref;
  if found then
    if existing.order_id <> o.id or existing.order_item_id <> i.id then raise exception 'Invalid return reference'; end if;
    return jsonb_build_object('ok', true, 'already', true, 'refundCents', existing.total_refund_cents);
  end if;
  select coalesce(sum(quantity), 0) into returned from order_returns where order_item_id = i.id;
  if p_quantity is null or p_quantity < 1 or p_quantity > i.quantity - returned or p_ref is null or length(btrim(p_ref)) < 1 or length(p_ref) > 100 then raise exception 'Invalid return quantity'; end if;
  cents := round(coalesce(i.net_total_cents, round(i.unit_price_cents::numeric * i.quantity * greatest(0, o.subtotal_cents - o.discount_cents) / greatest(1, o.subtotal_cents)))::numeric * (returned + p_quantity) / i.quantity)
         - round(coalesce(i.net_total_cents, round(i.unit_price_cents::numeric * i.quantity * greatest(0, o.subtotal_cents - o.discount_cents) / greatest(1, o.subtotal_cents)))::numeric * returned / i.quantity);
  insert into order_returns(return_ref, order_id, order_item_id, product_slug, quantity, unit_price_cents, total_refund_cents, reason)
  values(p_ref, o.id, i.id, i.product_slug, p_quantity, i.unit_price_cents, cents, left(p_reason, 500));
  if i.stock_debited and i.variant_id is not null then update product_variants set stock = stock + p_quantity where id = i.variant_id; end if;
  return jsonb_build_object('ok', true, 'refundCents', cents);
end;
$$;

create table if not exists public.order_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0
);
alter table public.order_claims enable row level security;

create or replace function public.start_admin_reset(p_hash text)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare a jsonb; ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  insert into settings(key,value) values('admin_auth','{}') on conflict(key) do nothing;
  select value into a from settings where key = 'admin_auth' for update;
  if coalesce((a->>'reset_sent_at')::bigint,0) > ms - 60000 then return false; end if;
  update settings set value = a || jsonb_build_object('reset_otp_hash',p_hash,'reset_otp_exp',ms+900000,'reset_otp_attempts',0,'reset_sent_at',ms) where key = 'admin_auth';
  return true;
end;
$$;

create or replace function public.apply_admin_reset(p_hash text, p_password_hash text)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare a jsonb; attempts integer; ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  select value into a from settings where key = 'admin_auth' for update;
  if not found or a->>'reset_otp_hash' is null or coalesce((a->>'reset_otp_exp')::bigint,0) <= ms then return false; end if;
  attempts := coalesce((a->>'reset_otp_attempts')::integer,0);
  if attempts >= 5 then return false; end if;
  if a->>'reset_otp_hash' <> p_hash then
    update settings set value = a || jsonb_build_object('reset_otp_attempts',attempts+1) where key = 'admin_auth';
    return false;
  end if;
  update settings set value = (a - 'reset_otp_hash' - 'reset_otp_exp' - 'reset_otp_attempts') || jsonb_build_object('password_hash',p_password_hash,'token_version',coalesce((a->>'token_version')::integer,0)+1) where key = 'admin_auth';
  return true;
end;
$$;

create or replace function public.claim_guest_orders(p_user_id uuid, p_hash text)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare c order_claims%rowtype;
begin
  select * into c from order_claims where user_id = p_user_id for update;
  if not found or c.expires_at <= now() or c.attempts >= 5 then return false; end if;
  update order_claims set attempts = attempts + 1 where user_id = p_user_id;
  if c.code_hash <> p_hash then return false; end if;
  update orders set user_id = p_user_id where user_id is null and lower(btrim(email)) = c.email;
  delete from order_claims where user_id = p_user_id;
  return true;
end;
$$;

create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','received')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.return_requests enable row level security;
create index if not exists return_requests_owner_idx on public.return_requests(user_id, created_at);
create or replace function public.receive_return_request(p_id uuid)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare r return_requests%rowtype; o orders%rowtype; result jsonb;
begin
  select * into r from return_requests where id = p_id;
  if not found then raise exception 'Request unavailable'; end if;
  select * into o from orders where id = r.order_id for update;
  select * into r from return_requests where id = p_id for update;
  if r.status = 'received' then return jsonb_build_object('ok', true, 'already', true); end if;
  if r.status <> 'approved' then raise exception 'Request not approved'; end if;
  result := record_order_return(r.order_id, r.order_item_id, r.quantity, r.id::text, r.reason);
  update return_requests set status = 'received', updated_at = now() where id = r.id;
  return result;
end;
$$;
create unique index if not exists return_requests_open_item_idx on public.return_requests(order_item_id) where status in ('requested','approved');
alter table public.return_requests add column if not exists evidence_paths jsonb not null default '[]';

create or replace function public.request_return(p_user_id uuid, p_order_id uuid, p_item_id uuid, p_quantity integer, p_reason text, p_days integer)
returns uuid language plpgsql set search_path = public, pg_temp as $$
declare o orders%rowtype; i order_items%rowtype; returned integer; request_id uuid;
begin
  select * into o from orders where id = p_order_id and user_id = p_user_id for update;
  if not found or o.status <> 'paid' or o.shipping_status <> 'delivered' or o.delivered_at is null or o.delivered_at < now() - make_interval(days => p_days) then raise exception 'Order ineligible'; end if;
  select * into i from order_items where id = p_item_id and order_id = o.id for update;
  if not found then raise exception 'Item unavailable'; end if;
  select coalesce(sum(quantity), 0) into returned from order_returns where order_item_id = i.id;
  if p_quantity is null or p_quantity < 1 or p_quantity > i.quantity - returned or length(btrim(p_reason)) < 3 then raise exception 'Invalid return'; end if;
  insert into return_requests(user_id, order_id, order_item_id, quantity, reason) values(p_user_id, o.id, i.id, p_quantity, left(p_reason, 1000)) returning id into request_id;
  return request_id;
end;
$$;

alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check (category in ('hijab','abaya','prayer','dress','accessory','knitwear','jacket','skirt','top','trousers'));
alter table public.products add column if not exists fit_en text not null default '';
alter table public.products add column if not exists fit_fr text not null default '';
alter table public.products add column if not exists fit_ar text not null default '';
alter table public.products add column if not exists measurements_en text not null default '';
alter table public.products add column if not exists measurements_fr text not null default '';
alter table public.products add column if not exists measurements_ar text not null default '';
alter table public.products add column if not exists opacity text not null default 'unspecified' check (opacity in ('unspecified','opaque','semi-sheer','sheer'));
alter table public.products add column if not exists video_url text not null default '';
alter table public.products add column if not exists search_vector tsvector generated always as
  (to_tsvector('simple', coalesce(name_en,'') || ' ' || coalesce(name_fr,'') || ' ' || coalesce(name_ar,'') || ' ' || coalesce(description_en,'') || ' ' || coalesce(description_fr,'') || ' ' || coalesce(description_ar,'') || ' ' || category)) stored;
create index if not exists products_search_idx on public.products using gin(search_vector);
create or replace function public.catalog_facets()
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sizes', coalesce((select jsonb_agg(value order by value) from (select distinct jsonb_array_elements_text(sizes) as value from products where active) s),'[]'::jsonb),
    'occasions', coalesce((select jsonb_agg(value order by value) from (select distinct jsonb_array_elements_text(occasions) as value from products where active) s),'[]'::jsonb)
  );
$$;
create or replace function public.search_products(p_query text, p_categories text[], p_sizes text[], p_occasions text[], p_min integer, p_max integer)
returns setof public.products language sql stable set search_path = public, pg_temp as $$
  select * from products where active
    and (p_query = '' or search_vector @@ websearch_to_tsquery('simple', p_query))
    and (cardinality(p_categories) = 0 or category = any(p_categories))
    and (cardinality(p_sizes) = 0 or sizes ?| p_sizes)
    and (cardinality(p_occasions) = 0 or occasions ?| p_occasions)
    and (p_min is null or price_cents >= p_min)
    and (p_max is null or price_cents <= p_max);
$$;

create or replace function public.product_review_stats(p_ids uuid[])
returns table(product_id uuid, approved_count bigint, approved_rating numeric)
language sql stable set search_path = public, pg_temp as $$
  select product_id, count(*), round(avg(rating), 1) from reviews where status = 'approved' and product_id = any(p_ids) group by product_id;
$$;

create or replace function public.save_product_variants(p_product_id uuid, p_rows jsonb)
returns boolean language plpgsql set search_path = public, pg_temp as $$
declare row jsonb; current_stock integer;
begin
  perform id from products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  perform id from product_variants where product_id = p_product_id order by id for update;
  for row in select * from jsonb_array_elements(p_rows) loop
    select stock into current_stock from product_variants where product_id = p_product_id and color = row->>'color' and size = row->>'size';
    if found and (row->>'expected_stock' is null or current_stock <> (row->>'expected_stock')::integer) then raise exception 'Stock changed'; end if;
  end loop;
  update product_variants set active = false where product_id = p_product_id;
  for row in select * from jsonb_array_elements(p_rows) loop
    insert into product_variants(product_id,color,size,stock,active,barcode)
    values(p_product_id,row->>'color',row->>'size',(row->>'stock')::integer,(row->>'active')::boolean,row->>'barcode')
    on conflict(product_id,color,size) do update set stock = excluded.stock, active = excluded.active, barcode = excluded.barcode;
  end loop;
  return true;
end;
$$;

create sequence if not exists public.variant_barcode_seq;
select setval('public.variant_barcode_seq', greatest((select last_value from public.variant_barcode_seq), coalesce((select max(substring(barcode from 3)::bigint) from product_variants where barcode ~ '^HN[0-9]{7}$'), 1)));
create or replace function public.next_variant_barcode()
returns text language plpgsql set search_path = public, pg_temp as $$
declare n text;
begin
  n := nextval('public.variant_barcode_seq')::text;
  return 'HN' || lpad(n, greatest(7, length(n)), '0');
end;
$$;
revoke all on sequence public.variant_barcode_seq from public, anon, authenticated;
grant usage, select on sequence public.variant_barcode_seq to service_role;

create or replace function public.decrement_stock(p_variant_id uuid, p_qty integer)
returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  if p_qty is null or p_qty <= 0 then return false; end if;
  update product_variants set stock = stock - p_qty where id = p_variant_id and stock >= p_qty;
  return found;
end;
$$;
alter function public.decrement_stock(uuid,integer) security invoker;

create or replace function public.increment_stock(p_variant_id uuid, p_qty integer)
returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
  if p_qty is null or p_qty <= 0 then return false; end if;
  update product_variants set stock = stock + p_qty where id = p_variant_id;
  return found;
end;
$$;

do $$
declare signature text;
begin
  foreach signature in array array[
    'decrement_stock(uuid,integer)', 'increment_stock(uuid,integer)', 'claim_single_use_promo(text)',
    'consume_rate_limit(text,integer,integer)', 'reserve_order(uuid)', 'release_order(uuid,text)',
    'finalize_order_payment(uuid,text,integer,text,text)', 'restock_order(uuid)',
    'record_order_return(uuid,uuid,integer,text,text)', 'claim_guest_orders(uuid,text)',
    'request_return(uuid,uuid,uuid,integer,text,integer)', 'product_review_stats(uuid[])', 'receive_return_request(uuid)',
    'search_products(text,text[],text[],text[],integer,integer)', 'save_product_variants(uuid,jsonb)', 'next_variant_barcode()',
    'start_admin_reset(text)', 'apply_admin_reset(text,text)', 'reconcile_order_refund(uuid,text,integer,text,integer)', 'catalog_facets()'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to service_role';
    execute 'alter function public.' || signature || ' set search_path = public, pg_temp';
  end loop;
end;
$$;

create or replace function public.commerce_schema_version()
returns integer language sql immutable set search_path = public, pg_temp as $$
  select 1;
$$;
revoke all on function public.commerce_schema_version() from public, anon, authenticated;
grant execute on function public.commerce_schema_version() to service_role;

commit;
