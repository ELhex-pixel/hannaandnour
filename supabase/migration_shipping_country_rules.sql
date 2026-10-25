begin;

-- Extend only the validated Mondial Relay destination list. Existing snapshots
-- remain immutable; no order, stock, price or customer-paid shipping is updated.
alter table public.orders drop constraint if exists orders_pickup_point_data_valid;
alter table public.orders add constraint orders_pickup_point_data_valid check (
  pickup_point_data is null or coalesce((
    delivery_type='pickup' and jsonb_typeof(pickup_point_data)='object'
    and jsonb_typeof(pickup_point_data->'id')='number'
    and pickup_point_data->>'id' ~ '^[1-9][0-9]{0,15}$'
    and (pickup_point_data->>'id')::numeric<=9007199254740991
    and pickup_point_data->>'carrier'='mondial_relay'
    and length(pickup_point_data->>'carrier_service_point_id') between 1 and 80
    and length(pickup_point_data->>'name') between 1 and 160
    and pickup_point_data->>'type' in ('servicepoint','locker')
    and pickup_point_data->>'fingerprint' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(pickup_point_data->'address')='object'
    and pickup_point_data->'address'->>'country_code' in ('FR','BE','ES','NL','DE','IT')
    and pickup_point_data->'address'->>'country_code'=country
    and length(pickup_point_data->'address'->>'postal_code') between 4 and 7
    and length(pickup_point_data->'address'->>'city') between 1 and 100
    and length(pickup_point_data->'address'->>'street') between 1 and 160
    and length(pickup_point_data->>'availability_checked_at') between 20 and 30
  ),false)
);
create or replace function public.shipping_country_rules_schema_version()
returns integer language sql stable security invoker set search_path=public,pg_temp as $$select 1$$;
revoke all on function public.shipping_country_rules_schema_version() from public,anon,authenticated;
grant execute on function public.shipping_country_rules_schema_version() to service_role;

commit;
