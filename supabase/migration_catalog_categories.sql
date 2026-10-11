-- Expanded clothing categories. Apply after the existing commerce migrations.
-- Does not recategorize products or change prices, quantities or order history.
begin;
alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check check(category in (
  'hijab','abaya','prayer','dress','accessory','knitwear','jacket','skirt','top','trousers',
  'set','jumpsuit','tracksuit','tshirt','shirt','blouse','cardigan','sweatshirt','hoodie','coat','cape','vest','jeans','shorts'
));
create or replace function public.catalog_categories_schema_version()
returns integer language sql security invoker set search_path=public,pg_temp as $$ select 1 $$;
revoke all on function public.catalog_categories_schema_version() from public,anon,authenticated;
grant execute on function public.catalog_categories_schema_version() to service_role;
commit;
