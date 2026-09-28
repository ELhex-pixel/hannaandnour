-- Admin : annulation de commande (bouton "Annuler")
-- Ajoute le statut 'cancelled' à la contrainte existante + colonnes motif/date.
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check check (status in ('pending','paid','abandoned','refunded','cancelled'));
alter table orders add column if not exists cancel_reason text;
alter table orders add column if not exists cancelled_at timestamptz;