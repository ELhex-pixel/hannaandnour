begin;

do $$
begin
  if public.admin_operations_schema_version() <> 1 then raise exception 'Operations prerequisites missing'; end if;
end;
$$;

create or replace function public.save_return_policy(p_days integer, p_payer text, p_expected_version text)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare policy jsonb; result jsonb;
begin
  if p_days is null or p_days < 14 or p_days > 365 or p_payer is null or p_payer not in ('customer','store') then raise exception 'policy_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hn-return-policy',0));
  select value into policy from settings where key='return_policy' for update;
  if coalesce(policy->>'version','initial') is distinct from p_expected_version then raise exception 'policy_changed'; end if;
  result := jsonb_build_object('version',gen_random_uuid()::text,'days',p_days,'withdrawal_payer',p_payer,'fault_payer','store');
  insert into settings(key,value) values('return_policy',result) on conflict(key) do update set value=excluded.value,updated_at=now();
  return result;
end;
$$;

create or replace function public.return_policy_editor_schema_version()
returns integer language sql stable set search_path = public, pg_temp as $$ select 1 $$;

revoke all on function public.save_return_policy(integer,text,text), public.return_policy_editor_schema_version() from public, anon, authenticated;
grant execute on function public.save_return_policy(integer,text,text), public.return_policy_editor_schema_version() to service_role;

commit;
