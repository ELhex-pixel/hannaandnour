-- Hanna & Nour - MIGRATION: demo reviews + home page curation
-- Run this in the Supabase SQL editor (à exécuter dans l'éditeur SQL Supabase).
-- 1) Table pour les avis de démonstration (admin-editable, globaux : affichés
--    sur toutes les pages produit quand l'illustration est active + alimente la
--    section témoignages de l'accueil).
create table if not exists demo_reviews (
  id uuid primary key default gen_random_uuid(),
  author_name text not null,
  rating integer not null default 5 check (rating between 1 and 5),
  body text not null default '',
  location text not null default '',
  verified boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed : reprise des avis démo actuels (page produit + témoignages).
insert into demo_reviews (author_name, rating, body, location, verified, active, sort_order)
values
  ('Aisha M.', 5, 'La qualité est absolument magnifique. Je ne me suis jamais sentie aussi confiante et belle dans une tenue modeste. Hanna & Nour comprend vraiment ce que l''on recherche.', 'Paris, France', true, true, 1),
  ('Fatima K.', 5, 'Livraison rapide, emballage magnifique, et l''abaya tombe parfaitement. C''est désormais ma boutique de référence pour toute ma mode modeste.', 'Lyon, France', true, true, 2),
  ('Sara L.', 5, 'Tissu d''une qualité superbe, livré très vite et emballé avec soin. La couleur dorée est superbe. Je recommande vivement Hanna & Nour !', 'Bruxelles, Belgique', false, true, 3),
  ('Amina B.', 5, 'Le tombé de ce hijab est parfait, il ne glisse pas du tout. Un vrai jeu de confort qui change tout. Cela vaut chaque centime.', 'Marseille, France', true, true, 4),
  ('Khadija L.', 5, 'J''adore la façon dont Hanna & Nour célèbre la pudeur tout en restant tendance. L''ensemble de prière est si confortable et beau pour le culte quotidien.', 'Roubaix, France', false, true, 5)
on conflict (id) do nothing;

-- 2) Curation de la page d'accueil (settings key 'home').
insert into settings (key, value, updated_at)
values ('home', jsonb_build_object(
  'bestsellers_count', 4,
  'bestsellers', jsonb_build_array(
    'silk-hijab', 'flowing-abaya', 'prayer-set', 'modest-dress', 'pearl-brooch',
    'velvet-abaya', 'jersey-hijab', 'chiffon-wedding', 'embroidered-abaya', 'premium-prayer-set'
  ),
  'collections', jsonb_build_array(
    jsonb_build_object('title', 'Tenues de prière', 'subtitle', 'Confort et sérénité au quotidien', 'image', 'images/collection-prayer.jpg', 'url', 'collections.html'),
    jsonb_build_object('title', 'Abayas élégantes', 'subtitle', 'Coupes fluides et intemporelles', 'image', 'images/collection-abayas.jpg', 'url', 'collections.html'),
    jsonb_build_object('title', 'Hijabs du quotidien', 'subtitle', 'Soie, mousseline et coton premium', 'image', 'images/collection-hijabs.jpg', 'url', 'collections.html')
  )
), now())
on conflict (key) do nothing;