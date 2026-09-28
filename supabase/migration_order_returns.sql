-- ============================================================
-- Hanna & Nour - MIGRATION: order returns (tableau de bord Ventes & Stock)
-- Run this ONCE in the Supabase SQL editor (Dashboard > SQL > New query).
-- Idempotent: safe to re-run.
-- ============================================================

-- Retours par ligne de commande (total ou partiel). `return_ref` est la clé
-- d'idempotence : deux envois du même retour ne créent qu'une seule ligne.
create table if not exists order_returns (
  id uuid primary key default gen_random_uuid(),
  return_ref text not null unique,
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid references order_items(id) on delete set null,
  product_slug text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null default 0,
  total_refund_cents integer not null default 0,
  reason text not null default 'retour_client',
  created_at timestamptz not null default now()
);

create index if not exists idx_order_returns_order on order_returns(order_id);
create index if not exists idx_order_returns_item on order_returns(order_item_id);
create index if not exists idx_order_returns_created on order_returns(created_at);

-- RLS activée sans aucune policy publique : seules les fonctions Netlify
-- (service_role, qui bypass RLS) peuvent lire/écrire cette table.
alter table order_returns enable row level security;