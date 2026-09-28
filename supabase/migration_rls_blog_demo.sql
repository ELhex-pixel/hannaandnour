-- Hanna & Nour - MIGRATION: RLS sur blog_posts et demo_reviews
-- Run this in the Supabase SQL editor (à exécuter dans l'éditeur SQL Supabase).
-- Ces deux tables n'avaient pas de Row Level Security alors que la clé anon est
-- publique (public/js/config.js) : via PostgREST, n'importe qui pouvait lire et
-- écrire les articles et les avis démo. Les fonctions Netlify utilisent le
-- service_role (qui bypass RLS) — on n'ouvre donc que la lecture publique,
-- même patron que public_read_products.
alter table blog_posts enable row level security;
alter table demo_reviews enable row level security;

-- Lecture publique des articles actifs.
drop policy if exists "public_read_blog_posts" on blog_posts;
create policy "public_read_blog_posts" on blog_posts
  for select to anon, authenticated
  using (active = true);

-- Lecture publique des avis démo actifs.
drop policy if exists "public_read_demo_reviews" on demo_reviews;
create policy "public_read_demo_reviews" on demo_reviews
  for select to anon, authenticated
  using (active = true);