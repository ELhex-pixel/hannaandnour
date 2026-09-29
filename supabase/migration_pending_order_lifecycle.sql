-- Hanna & Nour - MIGRATION: cycle de vie des commandes en attente
-- (à exécuter dans l'éditeur SQL Supabase, tout le bloc d'un coup)
-- Garde d'envoi unique pour l'email de relance automatique à 24 h.
-- Les commandes en attente (pending/abandoned) non payées sont supprimées
-- automatiquement à 72 h par la fonction scheduled `pending-cleanup`.
alter table orders add column if not exists reminder_24h_sent_at timestamptz;

-- Index utile au crawl (statut + ancienneté) pour les longues listes.
create index if not exists idx_orders_status_created on orders (status, created_at);