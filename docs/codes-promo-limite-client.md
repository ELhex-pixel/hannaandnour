# Limite d’utilisation des codes promo par client

## Activer

Le propriétaire exécute `supabase/migration_promo_customer_limits.sql` dans l’éditeur SQL du projet Supabase habituel, puis confirme le résultat. Le build de production vérifie en lecture seule `promo_customer_limits_schema_version() = 1` et la colonne `promo_codes.max_uses_per_customer`. Aucune migration n’est exécutée par le site ou le build.

La migration ajoute un réglage nullable, deux index de lecture et une vérification privée. Elle conserve les commandes, les stocks et les anciens compteurs. Les codes existants restent sans limite par client jusqu’à leur modification explicite dans l’admin.

## Utilisation

Dans **Admin → Promos → Nouveau code / Modifier**, renseigner **Nombre maximal d’utilisations par client** :

- `1` : une commande utilisant le code par client ;
- `2` : deux commandes par client ;
- champ vide : pas de limite par client.

Le tableau affiche la limite enregistrée. Le code d’une promotion existante reste fixe pour conserver son identité et l’historique du comptage ; créer une nouvelle promotion pour un nouveau code. Les autres champs restent modifiables.

## Comptage

Un client est reconnu par le compte authentifié **ou** l’adresse e-mail normalisée de la commande (espaces périphériques retirés, casse ignorée). Une commande correspondante compte une seule fois, même si ses deux identités correspondent. Les achats invités sont rapprochés par leur e-mail. Des adresses et comptes différents restent des identités distinctes.

Les anciennes commandes payées utilisant exactement ce code comptent aussi. Une commande payée puis remboursée ou annulée après encaissement reste une utilisation. Les anciennes règles d’usage unique global continuent de s’appliquer si elles existent.

Un panier impayé ouvert sur Stripe ne bloque aucune utilisation. Après autorisation bancaire, la transaction réserve temporairement une utilisation avec le stock. Une annulation bancaire confirmée libère cette utilisation. Une capture incertaine reste protégée jusqu’au rapprochement existant ; un simple événement d’expiration ne libère pas une capture en cours.

## Vérifications serveur

Le récapitulatif panier peut présenter la réduction avant que l’adresse e-mail soit renseignée. À la soumission du paiement, le serveur relit le code et contrôle la limite avec l’e-mail validé et l’identifiant issu de la session authentifiée. Un identifiant ou compteur fourni par le navigateur n’est jamais utilisé.

La limite est revérifiée après autorisation bancaire dans `reserve_order`, sous verrou du code promo et avant débit de stock/capture. Deux finalisations concurrentes ne peuvent donc pas dépasser la limite. Les réessais du même ordre conservent l’idempotence existante. Le refus conduit à l’annulation de l’autorisation via le parcours existant.

Les achats historiques déjà encaissés continuent à être rapprochés selon leur flux d’origine. Les fonctions de capture, de remboursement et de restitution de stock ne sont pas réécrites par cette migration.

## Validation

Tests locaux avec PGlite et mocks : limites 1/2, clients distincts, casse et espaces de l’e-mail, compte authentifié malgré un changement d’e-mail, historique payé/remboursé, réservations concurrentes, échec puis réutilisation, réessais, usage unique global, catalogue supprimé et accès privés. Aucun paiement, e-mail ou code promo réel n’est créé pour les tests.
