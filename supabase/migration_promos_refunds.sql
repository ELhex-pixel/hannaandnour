-- ============================================================
-- Phase 3 — Promotions admin + refunds (run once in the SQL editor)
-- 1) increment_stock RPC (used to restock an order when refunded)
--    promo_codes already exists in schema.sql (no change needed here).
-- ============================================================

create or replace function increment_stock(p_variant_id uuid, p_qty integer)
returns boolean
language sql
as $$
  update product_variants
     set stock = stock + p_qty
   where id = p_variant_id;
  select found;
$$;