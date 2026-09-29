-- Invitation email pour noter les produits après livraison (voir admin.js).
-- review_email_sent_at = garde-fou d'idempotence : un seul email par commande.
alter table orders add column if not exists review_email_sent_at timestamptz;