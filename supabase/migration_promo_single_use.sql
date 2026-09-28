-- Hanna & Nour - MIGRATION: promotions à usage unique réellement appliquées
-- Run this in the Supabase SQL editor (à exécuter dans l'éditeur SQL Supabase).
-- promo_codes.single_use existait mais n'était jamais contrôlé au checkout :
-- un code « usage unique » restait réutilisable indéfiniment.
-- 1) Compteur d'usages sur promo_codes.
-- 2) RPC atomique : ne prête le code qu'au premier ordre (used_count 0 -> 1).
--    L'UPDATE conditionnel évite la course entre deux checkouts concurrents.
alter table promo_codes add column if not exists used_count integer not null default 0;

create or replace function claim_single_use_promo(p_code text)
returns boolean
language sql
as $$
  update promo_codes
     set used_count = used_count + 1
   where code = p_code
     and single_use = true
     and used_count = 0;
  select found;
$$;