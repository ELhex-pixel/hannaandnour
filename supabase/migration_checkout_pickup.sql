begin;
do $$ begin
  if public.commerce_schema_version() <> 1 then raise exception 'Commerce prerequisites missing'; end if;
end $$;

-- Existing orders (including physical sales and old free-text pickups) retain
-- their historical fields. Only new validated web pickups carry this snapshot.
alter table public.orders add column if not exists pickup_point_data jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_pickup_point_data_valid') then
    alter table public.orders add constraint orders_pickup_point_data_valid check (
      pickup_point_data is null or coalesce((
        delivery_type = 'pickup' and jsonb_typeof(pickup_point_data) = 'object'
        and jsonb_typeof(pickup_point_data->'id') = 'number'
        and pickup_point_data->>'id' ~ '^[1-9][0-9]{0,15}$'
        and (pickup_point_data->>'id')::numeric <= 9007199254740991
        and pickup_point_data->>'carrier' = 'mondial_relay'
        and length(pickup_point_data->>'carrier_service_point_id') between 1 and 80
        and length(pickup_point_data->>'name') between 1 and 160
        and pickup_point_data->>'type' in ('servicepoint','locker')
        and pickup_point_data->>'fingerprint' ~ '^[a-f0-9]{64}$'
        and jsonb_typeof(pickup_point_data->'address') = 'object'
        and pickup_point_data->'address'->>'country_code' in ('FR','BE','ES','NL')
        and pickup_point_data->'address'->>'country_code' = country
        and length(pickup_point_data->'address'->>'postal_code') between 4 and 7
        and length(pickup_point_data->'address'->>'city') between 1 and 100
        and length(pickup_point_data->'address'->>'street') between 1 and 160
        and length(pickup_point_data->>'availability_checked_at') between 20 and 30
      ), false)
    );
  end if;
end $$;

create or replace function public.protect_order_pickup_snapshot()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if old.pickup_point_data is not null and new.pickup_point_data is distinct from old.pickup_point_data then
    raise exception 'pickup_snapshot_immutable';
  end if;
  return new;
end $$;
drop trigger if exists protect_order_pickup_snapshot on public.orders;
create trigger protect_order_pickup_snapshot before update of pickup_point_data on public.orders
for each row execute function public.protect_order_pickup_snapshot();

create or replace function public.checkout_pickup_schema_version()
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$select 1$$;
revoke all on function public.protect_order_pickup_snapshot(), public.checkout_pickup_schema_version() from public,anon,authenticated;
grant execute on function public.protect_order_pickup_snapshot(), public.checkout_pickup_schema_version() to service_role;
commit;
