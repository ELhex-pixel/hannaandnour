-- ============================================================
-- Migration : catalogue aligné sur le modèle
-- « Hanna-Nour-Mode-Modeste-Elegante » (photos, prix €, noms FR)
-- + passage de la devise du magasin en EUR.
--
-- À exécuter dans le Supabase SQL Editor (Table editor n'aide pas).
-- Re-fetch du /admin -> Settings -> Enregistrer après usage
-- (ou attendre le TTL du cache) pour voir « € » côté boutique.
-- ============================================================

begin;

-- 1) Devise du magasin -> EUR (admin-editable, lue par /api/config)
insert into settings (key, value) values
  ('currency', '{"code":"eur","symbol":"€"}')
on conflict (key) do update set value = excluded.value;

-- 2) Hijab en soie — 34,90 € (modèle : "Hijab en soie")
update products set
  price_cents           = 3490,
  name_en               = 'Silk Hijab',
  name_fr               = 'Hijab en soie',
  image                 = 'images/silk-hijab.jpg'
where slug = 'silk-hijab';

-- 3) Abaya fluide émeraude — 89,00 € (modèle : "Abaya fluide")
update products set
  price_cents           = 8900,
  name_en               = 'Emerald Flowing Abaya',
  name_fr               = 'Abaya fluide émeraude',
  image                 = 'images/eid-abaya.jpg'
where slug = 'flowing-abaya';

-- 4) Ensemble prière lavande — 59,90 € (modèle : "Ensemble de prière lavande")
update products set
  price_cents           = 5990,
  name_en               = 'Lavender Prayer Set',
  name_fr               = 'Ensemble prière lavande',
  image                 = 'images/prayer-wear.jpg'
where slug = 'prayer-set';

-- 5) Robe modeste rosée — 74,50 € (modèle : "Robe modeste rosée")
update products set
  price_cents           = 7450,
  name_en               = 'Rose Modest Dress',
  name_fr               = 'Robe modeste rosée',
  image                 = 'images/modest-dress.jpg',
  gallery               = '[{"src":"images/modest-dress.jpg","label":"Main view"},{"src":"images/hero.jpg","label":"Detail view"}]'
where slug = 'modest-dress';

commit;