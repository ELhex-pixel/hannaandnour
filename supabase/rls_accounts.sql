-- ============================================================
-- Phase 2 — Client accounts (run once in the Supabase SQL editor)
-- 1) user_wishlist table (per-account favorites)
-- 2) Row Level Security on user_wishlist + orders (defense in depth)
--
-- The Netlify functions read/write with the service_role key, so the app
-- works whether or not RLS is enabled — these policies only protect direct
-- browser/anon access to the tables.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- WISHLIST (per account) ----------
create table if not exists user_wishlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, slug)
);

create index if not exists idx_user_wishlist_user on user_wishlist (user_id);

-- ---------- ORDERS: user_id column (already in schema.sql) ----------
alter table orders add column if not exists user_id uuid;
create index if not exists idx_orders_user on orders (user_id);

-- ---------- ROW LEVEL SECURITY ----------
alter table user_wishlist enable row level security;
alter table orders enable row level security;

-- user_wishlist: the owner reads/writes their own rows.
drop policy if exists user_wishlist_select_own on user_wishlist;
create policy user_wishlist_select_own
  on user_wishlist for select
  using (auth.uid() = user_id);

drop policy if exists user_wishlist_insert_own on user_wishlist;
create policy user_wishlist_insert_own
  on user_wishlist for insert
  with check (auth.uid() = user_id);

drop policy if exists user_wishlist_delete_own on user_wishlist;
create policy user_wishlist_delete_own
  on user_wishlist for delete
  using (auth.uid() = user_id);

-- orders: the owner reads their own orders (guest lookup stays server-side
-- via /api/orders?email= which uses the service_role key).
drop policy if exists orders_select_own on orders;
create policy orders_select_own
  on orders for select
  using (auth.uid() = user_id);
