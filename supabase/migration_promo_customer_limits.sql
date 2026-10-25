begin;

-- A null limit preserves the existing unlimited behaviour. No historical order,
-- stock, payment or existing global single-use counter is changed.
alter table public.promo_codes add column if not exists max_uses_per_customer integer
  check(max_uses_per_customer between 1 and 1000000);

create index if not exists orders_promo_customer_email_idx
  on public.orders(promo_code,lower(btrim(email)))
  where paid_at is not null or status in ('paid','refunded') or inventory_reserved;
create index if not exists orders_promo_customer_user_idx
  on public.orders(promo_code,user_id)
  where paid_at is not null or status in ('paid','refunded') or inventory_reserved;

-- Private, read-only eligibility check. One order counts once even if both
-- identities match. Paid/refunded history remains counted; an unpaid draft
-- without the short finalization-stage reservation never consumes an attempt.
create or replace function public.promo_customer_can_use(p_code text,p_user_id uuid,p_email text)
returns boolean language plpgsql volatile security invoker set search_path=public,pg_temp as $$
declare promo promo_codes%rowtype; n bigint;
begin
  select * into promo from promo_codes where code=p_code;
  if not found then return false; end if;
  if promo.max_uses_per_customer is null then return true; end if;
  if p_email is null or length(btrim(p_email)) not between 3 and 254 or position('@' in p_email)=0 then return false; end if;
  select count(*) into n from orders o
    where o.promo_code=p_code
      and (o.paid_at is not null or o.status in ('paid','refunded') or o.inventory_reserved)
      and (lower(btrim(o.email))=lower(btrim(p_email)) or (p_user_id is not null and o.user_id=p_user_id));
  return n<promo.max_uses_per_customer;
end;
$$;

-- Same lock order and stock transaction as migration_catalog_return_cleanup:
-- order -> products -> variants -> promo. The promo row lock serializes the
-- customer usage check and allocation across competing bank authorizations.
create or replace function public.reserve_order(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; r record; v product_variants%rowtype; promo promo_codes%rowtype;
begin
  select * into o from orders where id=p_order_id for update;
  if not found or o.status<>'pending' then return false; end if;
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
    if not promo_customer_can_use(promo.code,o.user_id,o.email) then return false; end if;
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

create or replace function public.promo_customer_limits_schema_version()
returns integer language sql stable as $$ select 1; $$;
revoke all on function public.promo_customer_can_use(text,uuid,text),public.promo_customer_limits_schema_version(),public.reserve_order(uuid) from public,anon,authenticated;
grant execute on function public.promo_customer_can_use(text,uuid,text),public.promo_customer_limits_schema_version(),public.reserve_order(uuid) to service_role;

commit;
