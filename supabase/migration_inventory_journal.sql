begin;

do $$
begin
  if public.admin_inventory_schema_version() <> 1 then raise exception 'Inventory prerequisites missing'; end if;
end;
$$;

create table if not exists public.inventory_journal_resets (
  id uuid primary key,
  archived_count integer not null check (archived_count >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.inventory_journal_archives (
  adjustment_id uuid primary key references public.inventory_adjustments(id) on delete restrict,
  reset_id uuid not null references public.inventory_journal_resets(id) on delete restrict deferrable initially deferred
);
create index if not exists inventory_journal_archives_reset_idx on public.inventory_journal_archives(reset_id);
alter table public.inventory_journal_resets enable row level security;
alter table public.inventory_journal_archives enable row level security;
revoke all on public.inventory_journal_resets,public.inventory_journal_archives from public,anon,authenticated,service_role;
grant select,insert on public.inventory_journal_resets,public.inventory_journal_archives to service_role;

create or replace function public.reset_inventory_journal(p_operation_id uuid, p_confirmation text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare previous inventory_journal_resets%rowtype; archived integer;
begin
  if p_operation_id is null or p_confirmation is distinct from 'REINITIALISER' then raise exception 'inventory_journal_invalid'; end if;
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(hashtextextended('inventory_journal_reset',0));
  select * into previous from inventory_journal_resets where id=p_operation_id;
  if found then
    return jsonb_build_object('operation_id',previous.id,'archived_count',previous.archived_count,'already',true);
  end if;
  insert into inventory_journal_archives(adjustment_id,reset_id)
    select id,p_operation_id from inventory_adjustments
    where not exists(select 1 from inventory_journal_archives a where a.adjustment_id=inventory_adjustments.id)
    on conflict(adjustment_id) do nothing;
  get diagnostics archived = row_count;
  insert into inventory_journal_resets(id,archived_count) values(p_operation_id,archived);
  return jsonb_build_object('operation_id',p_operation_id,'archived_count',archived,'already',false);
end;
$$;

create or replace function public.list_inventory_journal(p_variant_id uuid default null, p_archived boolean default false)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(entry order by entry.created_at desc,entry.id desc),'[]'::jsonb)
  from (
    select i.id,i.variant_id,i.mode,i.quantity,i.stock_before,i.stock_after,i.reason,i.product_name,i.color,i.size,i.barcode,i.created_at
    from inventory_adjustments i
    where (p_variant_id is null or i.variant_id=p_variant_id)
      and exists(select 1 from inventory_journal_archives a where a.adjustment_id=i.id)=p_archived
    order by i.created_at desc,i.id desc limit 100
  ) entry;
$$;

create or replace function public.inventory_journal_schema_version()
returns integer language sql stable set search_path = public, pg_temp as $$ select 1 $$;

revoke all on function public.reset_inventory_journal(uuid,text),public.list_inventory_journal(uuid,boolean),public.inventory_journal_schema_version() from public,anon,authenticated;
grant execute on function public.reset_inventory_journal(uuid,text),public.list_inventory_journal(uuid,boolean),public.inventory_journal_schema_version() to service_role;

commit;
