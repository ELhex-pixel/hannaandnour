-- ============================================================
-- Hanna & Nour - Supabase schema
-- Run schema.sql then seed.sql in the Supabase SQL editor
-- (Dashboard > SQL > New query).
-- ============================================================

-- ---------- PRODUCTS ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  sku text unique not null,
  name_en text not null,
  name_fr text not null,
  name_ar text not null,
  description_en text not null,
  description_fr text not null,
  description_ar text not null,
  features_en jsonb not null default '[]',
  features_fr jsonb not null default '[]',
  features_ar jsonb not null default '[]',
  fabric_comp_en text not null default '',
  fabric_comp_fr text not null default '',
  fabric_comp_ar text not null default '',
  care_en jsonb not null default '[]',
  care_fr jsonb not null default '[]',
  care_ar jsonb not null default '[]',
  price_cents integer not null check (price_cents > 0),
  compare_at_price_cents integer,
  category text not null check (category in ('hijab','abaya','prayer','dress','accessory')),
  colors jsonb not null default '[]',
  sizes jsonb not null default '["One Size"]',
  fabrics jsonb not null default '[]',
  occasions jsonb not null default '[]',
  image text not null,
  gallery jsonb not null default '[]',
  rating numeric(2,1) not null default 4.5,
  review_count integer not null default 0,
  badge text,
  is_featured boolean not null default false,
  is_bestseller boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- REVIEWS ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending','approved')),
  created_at timestamptz not null default now()
);

-- ---------- ORDERS ----------
create sequence if not exists order_number_seq;

create table if not exists orders (
  id uuid primary key,
  order_number text not null,
  stripe_session_id text unique,
  email text not null,
  customer_name text not null,
  phone text,
  address1 text not null,
  address2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null,
  shipping_method text not null,
  subtotal_cents integer not null default 0,
  shipping_cents integer not null default 0,
  tax_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'usd',
  status text not null default 'pending' check (status in ('pending','paid','abandoned','refunded')),
  promo_code text,
  user_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid,
  product_slug text not null,
  product_name text not null,
  image text,
  variant text,
  unit_price_cents integer not null,
  quantity integer not null check (quantity > 0)
);

-- ---------- NEWSLETTER ----------
create table if not exists newsletter (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  source text not null default 'footer',
  created_at timestamptz not null default now()
);

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
-- Called by the Stripe webhook when a payment is confirmed.
-- Returns true only when there was enough stock. Runs in its own row lock
-- (the `and stock >= p_qty` guard makes it race-safe).
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

-- ---------- PROMO CODES ----------
create table if not exists promo_codes (
  code text primary key,
  percent_off integer not null check (percent_off > 0 and percent_off <= 100),
  active boolean not null default true,
  single_use boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- ROW LEVEL SECURITY ----------

alter table products enable row level security;
alter table reviews enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table newsletter enable row level security;
alter table promo_codes enable row level security;
alter table product_variants enable row level security;
alter table settings enable row level security;

-- Variants / settings have NO public policies: Netlify functions (service_role)
-- bypass RLS, so only the API can read or write them.

-- Public can read active products
drop policy if exists "public_read_products" on products;
create policy "public_read_products" on products
  for select to anon, authenticated
  using (active = true);

-- Public can read approved reviews
drop policy if exists "public_read_reviews" on reviews;
create policy "public_read_reviews" on reviews
  for select to anon, authenticated
  using (status = 'approved');

-- Anyone can submit a review (lands as pending, reviewed in dashboard)
drop policy if exists "public_insert_reviews" on reviews;
create policy "public_insert_reviews" on reviews
  for insert to anon, authenticated
  with check (true);

-- Anyone can subscribe to the newsletter
drop policy if exists "public_insert_newsletter" on newsletter;
create policy "public_insert_newsletter" on newsletter
  for insert to anon, authenticated
  with check (true);

-- Orders / order items / promo codes: NO public policies.
-- Netlify functions use the service_role key, which bypasses RLS.

-- Auto-update products.updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists products_set_updated_at on products;
create trigger products_set_updated_at before update on products
  for each row execute function set_updated_at();