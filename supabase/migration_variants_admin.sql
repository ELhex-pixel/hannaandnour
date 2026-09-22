-- ============================================================
-- Hanna & Nour - MIGRATION: variants + stock + settings + orders
-- Run this ONCE in the Supabase SQL editor (Dashboard > SQL > New query).
-- Idempotent: safe to re-run.
-- ============================================================

-- ---------- PRODUCT VARIANTS (color x size, real stock) ----------
create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  color text not null default '',
  size text not null default '',
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  unique (product_id, color, size)
);

create index if not exists idx_product_variants_product on product_variants(product_id);

-- ---------- SETTINGS (admin-editable, key/value) ----------
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- ORDERS extensions (fulfillment + pickup) ----------
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists shipping_status text not null default 'new' check (shipping_status in ('new','shipped','delivered'));
alter table orders add column if not exists shipped_at timestamptz;
alter table orders add column if not exists delivered_at timestamptz;
alter table orders add column if not exists delivery_type text not null default 'home' check (delivery_type in ('home','pickup'));
alter table orders add column if not exists pickup_point text;

alter table order_items add column if not exists variant_id uuid;

-- ---------- ATOMIC STOCK DECREMENT ----------
create or replace function decrement_stock(p_variant_id uuid, p_qty integer)
returns boolean
language plpgsql
security definer
as $$
begin
  update product_variants
     set stock = stock - p_qty
   where id = p_variant_id
     and stock >= p_qty;
  return found;
end;
$$;

-- ---------- RLS ----------
alter table product_variants enable row level security;
alter table settings enable row level security;
-- No public policies: only Netlify functions (service_role) can access them.