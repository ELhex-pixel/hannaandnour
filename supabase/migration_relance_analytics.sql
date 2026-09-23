-- ============================================================
-- Phase 4 — Abandoned-cart recovery + in-house analytics
-- Run once in the Supabase SQL editor.
-- ============================================================

-- ----- Orders: cart restore token + relance sent flag -----
alter table orders add column if not exists cart_restore_token text;
alter table orders add column if not exists relance_sent_at timestamptz;
create index if not exists idx_orders_restore_token on orders (cart_restore_token);

-- ----- Analytics events (in-house) -----
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('pageview','product_view','add_to_cart','checkout_attempt','purchase')),
  product_slug text,
  path text,
  referrer text,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_type_time on analytics_events (event_type, created_at);

alter table analytics_events enable row level security;