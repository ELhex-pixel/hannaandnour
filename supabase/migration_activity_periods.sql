begin;
do $$ begin
  if public.commerce_schema_version() <> 1 then raise exception 'Commerce prerequisites missing'; end if;
end $$;
create table if not exists public.admin_activity_periods (
  id uuid primary key,
  previous_id uuid references public.admin_activity_periods(id),
  started_at timestamptz not null,
  reason text not null check (length(reason) between 3 and 300)
);
create index if not exists admin_activity_periods_started_idx on public.admin_activity_periods(started_at desc);
alter table public.admin_activity_periods enable row level security;
revoke all on public.admin_activity_periods from public,anon,authenticated,service_role;
grant select,insert on public.admin_activity_periods to service_role;

create or replace function public.start_admin_activity_period(p_id uuid,p_previous uuid,p_reason text,p_confirmation text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare head admin_activity_periods%rowtype; previous admin_activity_periods%rowtype; created admin_activity_periods%rowtype;
begin
  if p_id is null or p_reason is null or length(btrim(p_reason)) not between 3 and 300 or p_confirmation is distinct from 'NOUVELLE_PERIODE' then raise exception 'activity_period_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_activity_periods',0));
  select * into previous from admin_activity_periods where id=p_id;
  if found then
    if previous.previous_id is distinct from p_previous or previous.reason is distinct from btrim(p_reason) then raise exception 'activity_period_operation_mismatch'; end if;
    return jsonb_build_object('operation_id',previous.id,'started_at',previous.started_at,'already',true);
  end if;
  select * into head from admin_activity_periods order by started_at desc,id desc limit 1;
  if head.id is distinct from p_previous then raise exception 'activity_period_changed'; end if;
  insert into admin_activity_periods(id,previous_id,started_at,reason)
  values(p_id,p_previous,greatest(clock_timestamp(),coalesce(head.started_at,clock_timestamp())+interval '1 microsecond'),btrim(p_reason)) returning * into created;
  return jsonb_build_object('operation_id',created.id,'started_at',created.started_at,'already',false);
end $$;
create or replace function public.activity_periods_schema_version()
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$select 1$$;
revoke all on function public.start_admin_activity_period(uuid,uuid,text,text),public.activity_periods_schema_version() from public,anon,authenticated;
grant execute on function public.start_admin_activity_period(uuid,uuid,text,text),public.activity_periods_schema_version() to service_role;
commit;
