-- Avis d'invités : colonne order_id (lien vers la commande) pour la preuve
-- d'achat et l'anti-doublon (un seul avis par commande).
-- À exécuter dans le SQL editor Supabase.
alter table reviews add column if not exists order_id uuid references orders(id) on delete set null;

-- Index pour l'anti-doublon (recherche par commande).
create index if not exists reviews_order_id_idx on reviews (order_id);