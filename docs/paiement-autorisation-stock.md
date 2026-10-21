# Paiement validé par la banque, puis stock et encaissement automatique

## Choix du propriétaire

- Retirer le bouton client « Annuler ce paiement en attente » et remplacer l’avertissement de réservation par une aide de reprise par email.
- Ne plus bloquer le stock quand un client ouvre Stripe sans terminer son paiement.
- Mode retenu : **autorisation bancaire → disponibilité atomique → encaissement automatique**, pour protéger la dernière pièce contre deux encaissements concurrents.

## Fonctionnement des nouvelles commandes

1. Le devis relit prix, variantes et disponibilité. Les totaux positifs inférieurs à 0,50 € / 0,50 $ restent refusés avant création.
2. Le brouillon est enregistré avec `payment_flow=authorize_capture` et `checkout_lang`. Aucun appel à `reserve_order` n’est effectué à l’ouverture de Checkout ; aucune quantité ni utilisation de code promo ne change à ce stade.
3. La session Stripe utilise `payment_intent_data.capture_method=manual`. Les moyens de paiement proposés doivent supporter l’autorisation suivie d’un encaissement séparé. Les cartes et leurs wallets compatibles restent possibles ; tous les moyens précédemment visibles ne sont pas nécessairement compatibles.
4. Après la validation bancaire, `checkout.session.completed` déclenche `authorized-checkout.js`. Il relit la session et le PaymentIntent chez Stripe, vérifie leurs identifiants, métadonnées, montant, devise, mode, autorisation et montant capturable.
5. `claim_authorized_checkout` verrouille la commande et utilise la transaction existante `reserve_order` pour attribuer les unités et le code promo à une seule autorisation. Cette brève allocation après validation bancaire protège l’encaissement en cours, y compris quand le réseau est incertain.
6. S’il reste du stock, le serveur capture automatiquement le montant exact, sur le même PaymentIntent, avec `hn-capture-<order UUID>`. Il relit le résultat avant `finish_authorized_checkout`, qui finalise atomiquement la commande et conserve les coûts historiques existants. Le traitement habituel claim-first envoie ensuite la confirmation.
7. Si le stock ou le code promo n’est plus disponible, l’autorisation est annulée sur le même PaymentIntent avec `hn-cancel-auth-<order UUID>`. Aucune capture n’est lancée. L’annulation confirmée termine la tentative en `payment_failed`. Il ne s’agit pas d’un remboursement d’un montant déjà encaissé. Selon la banque, une autorisation peut temporairement ressembler à un débit.
8. Une capture ou confirmation SQL perdue reste dans le journal privé ; un réessai rapproche le même paiement. Le job de récupération, toutes les cinq minutes, retrouve les opérations à terminer et les sessions liées en attente de plus de cinq minutes, même si le premier webhook n’a pas créé de journal. Une page Stripe encore ouverte n’alloue aucun stock. Une expiration ordinaire ne peut pas libérer une capture encore incertaine.

Les commandes gratuites suivent une allocation atomique identique, sans PaymentIntent ni capture bancaire. Une capture effectuée hors de ce parcours depuis le Dashboard Stripe est rapprochée, jamais facturée une seconde fois ; le finaliseur existant signale `stock_issue` si cette intervention extérieure a encaissé un article indisponible. Aucun remboursement automatique n’est ajouté.

## Présentation et relance

- Le compte ne propose plus le bouton d’annulation. Une tentative non réglée explique la reprise par email ; une autorisation déjà reçue indique qu’une confirmation est en cours.
- La page de retour Stripe attend le statut serveur `paid` avant d’afficher une confirmation et de vider le panier. Les lectures sont sans cache, bornées et renouvelables manuellement.
- Une relance est prévue après **deux heures** sans paiement, contrôlée toutes les quinze minutes, uniquement dans la fenêtre de restauration de 72 heures. Son objet est « Finalisez votre paiement », avec un lien personnel vers le panier ; prix et disponibilités sont relus avant un nouveau paiement.
- Le claim SQL précède l’envoi : un seul rappel par tentative, au maximum un par destinataire sur 24 heures, et aucun rappel d’une ancienne tentative après un achat payé plus récent. Les marqueurs de l’ancienne relance à 24 h sont aussi pris en compte ; `pending-cleanup` n’envoie plus cette seconde relance.
- Les sessions déjà payées, en traitement asynchrone ou dont l’état est inconnu sont exclues avant envoi. Les comptes FR/EN/AR conservent leur langue de commande, y compris après expiration de la session.
- Les envois nécessitent la configuration Resend existante (`RESEND_API_KEY`, expéditeur autorisé). Un résultat SMTP incertain ne déclenche pas un second envoi automatique.

## Installation avant publication

1. Dans **Stripe réel → API keys → clé du site**, passer **Payment Intents de Read à Write**. Conserver **Checkout Sessions: Write** et **Charges and Refunds: Write**. Aucune clé n’est envoyée dans la conversation ou inscrite dans le dépôt.
2. Le propriétaire exécute **uniquement `supabase/migration_authorized_checkout.sql`** sur la base concernée, puis confirme l’exécution. Le fichier ajoute les colonnes et le journal privé, les RPC de capture/récupération/relance et la protection des captures en cours. Il ne lance aucun paiement, email, remboursement, seed ou ajustement de stock existant.
3. Le preflight exige `authorized_checkout_schema_version()=1`, les colonnes et le journal en lecture seule avant publication. Les cinq événements Checkout/remboursement déjà configurés sur le webhook restent utilisés.

**Installation confirmée par le propriétaire : « SQL exécuté et permission modifiée ». Le build contrôle ensuite la compatibilité en lecture seule avant publication.**

## Anciennes tentatives

Les anciennes commandes restent `payment_flow=automatic` et conservent leurs montants, stocks et historiques. Les sessions existantes ne sont pas converties en autorisations manuelles. Leur expiration et leur rapprochement utilisent le parcours historique. Une ancienne création incertaine sans identifiant de session ne peut pas être restituée automatiquement sans vérification : le nouveau SQL ne prétend pas réparer ces lignes.

## Vérifications

Tests isolés : création sans réservation, montants exacts, identité fournisseur, capture et annulation d’autorisation, réponses perdues, récupération, concurrence de la dernière unité dans PostgreSQL, coûts historiques, codes promo, droits privés, relances claim-first, absence de faux succès et messages FR/EN/AR. Aucun paiement, annulation bancaire, remboursement ou email réel n’est exécuté pour les tests.

Référence Stripe : https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
