begin;

-- Old checkouts keep their original reservation/capture semantics.
alter table public.orders add column if not exists payment_flow text not null default 'automatic'
  check(payment_flow in ('automatic','authorize_capture'));
alter table public.orders add column if not exists checkout_lang text check(checkout_lang in ('fr','en','ar'));

create table if not exists public.order_payment_captures (
  order_id uuid primary key references public.orders(id),
  session_id text not null unique,
  payment_intent_id text unique,
  amount_cents integer not null check(amount_cents>=0),
  currency text not null check(currency in ('eur','usd')),
  state text not null check(state in ('capturing','captured','cancelling','cancelled')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_payment_captures enable row level security;
revoke all on public.order_payment_captures from public,anon,authenticated,service_role;
grant select,insert,update on public.order_payment_captures to service_role;

create or replace function public.guard_authorized_checkout()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_table_name='orders' then
    if new.payment_flow is distinct from old.payment_flow or new.checkout_lang is distinct from old.checkout_lang then raise exception 'checkout_flow_immutable'; end if;
  else
    if new.order_id is distinct from old.order_id or new.session_id is distinct from old.session_id or new.payment_intent_id is distinct from old.payment_intent_id or new.amount_cents is distinct from old.amount_cents or new.currency is distinct from old.currency or new.created_at is distinct from old.created_at then raise exception 'capture_request_immutable'; end if;
    if old.state in ('captured','cancelled') and new.state is distinct from old.state then raise exception 'capture_terminal'; end if;
    if old.state='cancelling' and new.state='capturing' then raise exception 'capture_decision_immutable'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_checkout_flow_guard on public.orders;
create trigger orders_checkout_flow_guard before update on public.orders for each row execute function public.guard_authorized_checkout();
drop trigger if exists order_capture_guard on public.order_payment_captures;
create trigger order_capture_guard before update on public.order_payment_captures for each row execute function public.guard_authorized_checkout();

create or replace function public.claim_authorized_checkout(p_order_id uuid,p_session_id text,p_intent text,p_amount integer,p_currency text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; c order_payment_captures%rowtype; available boolean;
begin
  select * into o from orders where id=p_order_id for update;
  if not found or o.payment_flow<>'authorize_capture' or p_session_id is null or p_session_id='' or p_amount is null or p_amount<>o.total_cents or p_currency is distinct from o.currency or (p_amount>0 and (p_intent is null or p_intent='')) or (o.stripe_session_id is not null and o.stripe_session_id<>p_session_id) or (o.payment_intent_id is not null and o.payment_intent_id is distinct from p_intent) then raise exception 'authorized_checkout_mismatch'; end if;
  select * into c from order_payment_captures where order_id=o.id for update;
  if found then
    if c.session_id<>p_session_id or c.payment_intent_id is distinct from p_intent or c.amount_cents<>p_amount or c.currency<>p_currency then raise exception 'authorized_checkout_mismatch'; end if;
    return to_jsonb(c);
  end if;
  if o.status<>'pending' or o.paid_at is not null or o.refunded_cents>0 then raise exception 'authorized_checkout_unavailable'; end if;
  -- No stock was changed at page opening. Only a verified bank authorization
  -- reaches this private RPC; lock and allocate before allowing capture.
  insert into order_payment_captures(order_id,session_id,payment_intent_id,amount_cents,currency,state)
    values(o.id,p_session_id,p_intent,p_amount,p_currency,'capturing');
  available:=reserve_order(o.id);
  update orders set stripe_session_id=p_session_id,payment_intent_id=p_intent where id=o.id;
  if not available then update order_payment_captures set state='cancelling',reason='stock_or_promo_unavailable',updated_at=now() where order_id=o.id; end if;
  select * into c from order_payment_captures where order_id=o.id;
  return to_jsonb(c);
end;
$$;

-- Preserve the existing release transaction, but an authorized capture in flight
-- must be reconciled by finish_authorized_checkout, never by an expiry event.
create or replace function public.release_order(p_order_id uuid,p_status text default 'abandoned')
returns boolean language plpgsql set search_path=public,pg_temp as $$
declare o orders%rowtype; r record;
begin
  if p_status not in ('abandoned','payment_failed') then raise exception 'Invalid release status'; end if;
  select * into o from orders where id=p_order_id for update;
  if not found or o.status not in ('pending','abandoned','payment_failed') then return false; end if;
  if exists(select 1 from order_payment_captures where order_id=o.id and state in ('capturing','cancelling')) then return false; end if;
  for r in select variant_id,sum(quantity)::integer as qty from order_items where order_id=o.id and stock_debited and variant_id is not null group by variant_id order by variant_id loop
    update product_variants set stock=stock+r.qty where id=r.variant_id;
  end loop;
  update order_items set stock_debited=false where order_id=o.id;
  update orders set inventory_reserved=false,status=p_status where id=o.id;
  update promo_codes set used_count=0,reserved_order_id=null where reserved_order_id=o.id;
  return true;
end;
$$;

create or replace function public.finish_authorized_checkout(p_order_id uuid,p_session_id text,p_intent text,p_outcome text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype; c order_payment_captures%rowtype;
begin
  select * into o from orders where id=p_order_id for update;
  select * into c from order_payment_captures where order_id=p_order_id for update;
  if not found or c.session_id is distinct from p_session_id or c.payment_intent_id is distinct from p_intent or p_outcome is null or p_outcome not in ('captured','cancelled') then raise exception 'authorized_checkout_mismatch'; end if;
  if c.state in ('captured','cancelled') then
    if c.state<>p_outcome then raise exception 'capture_terminal'; end if;
    return to_jsonb(c);
  end if;
  update order_payment_captures set state=p_outcome,updated_at=now() where order_id=o.id returning * into c;
  if p_outcome='captured' then
    perform finalize_order_payment(o.id,c.session_id,c.amount_cents,c.currency,c.payment_intent_id);
  else
    perform release_order(o.id,'payment_failed');
  end if;
  return to_jsonb(c);
end;
$$;

-- One reminder per attempt and at most one per recipient per 24 hours.
-- Claim before sending; old 24h-reminder fields are marked too, preventing two jobs.
create or replace function public.claim_checkout_reminder(p_order_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare o orders%rowtype;
begin
  select * into o from orders where id=p_order_id;
  if not found or o.email is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('checkout-reminder:'||lower(o.email),0));
  select * into o from orders where id=p_order_id for update;
  if o.status not in ('pending','abandoned') or o.paid_at is not null or o.payment_intent_id is not null or o.relance_sent_at is not null or o.reminder_24h_sent_at is not null or o.cart_restore_token is null or o.created_at>now()-interval '2 hours' or o.created_at<now()-interval '72 hours' then return false; end if;
  if exists(select 1 from orders where lower(email)=lower(o.email) and (relance_sent_at>now()-interval '24 hours' or reminder_24h_sent_at>now()-interval '24 hours' or paid_at>=o.created_at)) then return false; end if;
  update orders set relance_sent_at=now(),reminder_24h_sent_at=now() where id=o.id;
  return true;
end;
$$;

create or replace function public.authorized_checkout_schema_version()
returns integer language sql stable as $$ select 1; $$;
create or replace function public.recoverable_authorized_checkouts()
returns table(order_id uuid,session_id text) language sql stable security invoker set search_path=public,pg_temp as $$
  select c.order_id,c.session_id from order_payment_captures c join orders o on o.id=c.order_id
  where c.state in ('capturing','cancelling') or (c.state='captured' and o.status='paid' and o.confirmation_claimed_at is null)
  order by (c.state='captured'),c.created_at limit 10;
$$;
revoke all on function public.guard_authorized_checkout(),public.claim_authorized_checkout(uuid,text,text,integer,text),public.finish_authorized_checkout(uuid,text,text,text),public.claim_checkout_reminder(uuid),public.authorized_checkout_schema_version(),public.recoverable_authorized_checkouts(),public.release_order(uuid,text) from public,anon,authenticated;
grant execute on function public.guard_authorized_checkout(),public.claim_authorized_checkout(uuid,text,text,integer,text),public.finish_authorized_checkout(uuid,text,text,text),public.claim_checkout_reminder(uuid),public.authorized_checkout_schema_version(),public.recoverable_authorized_checkouts(),public.release_order(uuid,text) to service_role;
commit;
