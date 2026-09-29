-- ---------- CODE-BARRES PAR VARIANTE (scanner Ventes & Stock) ----------
-- Chaque variante (couleur x taille) porte un code-barres unique, attribué
-- automatiquement par l'admin (séquence HN0000001, ...). Deux variantes ne
-- peuvent pas partager le même code.

alter table product_variants add column if not exists barcode text;

create unique index if not exists idx_product_variants_barcode
  on product_variants(barcode)
  where barcode is not null;