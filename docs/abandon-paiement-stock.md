# Paiements en attente et réservations de stock

## Ce qui compte comme une vente

Une tentative créée avant la redirection Stripe reste `pending` : aucun paiement n’est confirmé. Le stock disponible est réservé atomiquement pour éviter que deux personnes achètent la dernière unité. La confirmation Stripe valide la vente sans débiter une deuxième fois ces unités.

Le compte et l’admin distinguent désormais **En attente de paiement — non payée**, **Paiement abandonné — non payée** et les commandes payées. Les tentatives impayées ne portent plus un statut d’expédition et leur montant n’est pas décrit comme payé.

## Abandon après ouverture de Stripe

- L’URL de retour panier contient l’identifiant du brouillon et un jeton limité à son annulation. Ce jeton HMAC dépend du secret aléatoire déjà enregistré sur cette commande, avec une finalité distincte de la restauration du panier. Il ne donne aucun accès au compte ni aux coordonnées client.
- `checkout-cancel.js` retire ces paramètres de l’URL après conservation dans `sessionStorage['hn-checkout-cancel']`, puis POSTe `checkout` avec `action: cancel`. Le simple GET d’un lien n’effectue aucune annulation.
- Les événements analytiques n’envoient plus les paramètres d’URL ; le serveur retire aussi paramètres et fragments des chemins et référents avant stockage pour ne pas conserver ces jetons.
- L’identifiant et le jeton sont aussi conservés avant la redirection pour gérer le retour arrière du navigateur, y compris la restauration d’une page depuis son cache. Le panier est conservé.
- Le serveur relit la commande, vérifie le jeton puis la session Stripe précise : identifiant, commande, métadonnées, mode, montant et devise. Il expire une session ouverte impayée puis vérifie son état effectif. Seule une session **expirée et impayée** permet d’appeler la RPC privée existante `release_order`.
- Un paiement terminé ou asynchrone en cours ne déclenche aucune restitution. Une panne ou une identité incohérente reste non confirmée ; la même annulation est reprise. Aucun remboursement ou email n’est déclenché par ce parcours.
- Une réponse d’expiration ou de libération perdue est rapprochée au réessai. La RPC transactionnelle évite de restituer deux fois et ne modifie pas une commande devenue payée entre-temps.

## Annuler une ancienne tentative depuis son compte

Le bouton **Annuler ce paiement en attente** appelle `auth` avec `action: cancelCheckout`, après confirmation. La session client validée et un quota sont obligatoires ; la requête filtre strictement `orders.user_id` sur le propriétaire authentifié. Un identifiant utilisateur fourni par le navigateur n’est pas utilisé. La vérification Stripe est la même que pour le retour panier. Les réponses arrivées après déconnexion ne réaffichent aucune donnée privée.

Les anciens brouillons dont la création Stripe reste incertaine et sans identifiant de session ne sont pas libérés à l’aveugle. Ils nécessitent un rapprochement. Ne pas ajouter manuellement des unités pour compenser : une restitution automatique ultérieure pourrait sinon les doubler. Le déploiement du correctif ne constitue pas une preuve de réparation des anciennes lignes distantes.

## Montants sous le minimum et refus de création

Pour les devis EUR/USD actuels, un montant strictement positif inférieur à 50 centimes est refusé avant insertion de commande, réservation et appel Stripe. Le contrôle porte sur le total après remise et livraison, pas seulement sur le prix unitaire. Un total nul reste traité comme une éventuelle commande gratuite par le parcours Stripe existant.

Après réservation, un refus Stripe certain de validation HTTP 400, d’authentification 401 ou de permission 403 libère le brouillon ; la création n’est plus marquée comme incertaine. Une erreur d’idempotence, serveur ou réseau conserve la réservation pour rapprochement, car une session a pu être créée malgré la réponse perdue.

## Fermeture de l’onglet sans retour

La session expire à 30 minutes. Son événement `checkout.session.expired` libère le stock via la RPC existante. En secours, `pending-cleanup` tourne toutes les cinq minutes et contrôle les tentatives de plus de 35 minutes. Il vérifie leur identité Stripe et n’assimile jamais un paiement asynchrone ou inconnu à une expiration. Une lecture en erreur ne bloque pas la vérification des autres lignes du lot. Les protections des relances et de l’archivage sont conservées.

## Vérifications isolées

- Handlers : minimum avant mutation, montants exacts, refus certain versus réponse Stripe perdue, langue et jeton de retour.
- Annulation : jeton, propriétaire, quota, session étrangère, montant/devise, déjà payé, traitement asynchrone, expiration perdue, libération SQL perdue et courses avec le paiement.
- PGlite : vraie réservation et vraie libération SQL, répétition sans seconde restitution, confirmation payée tardive sans stock artificiel.
- Navigateur : retour panier, conservation du panier, réessai après panne/rechargement, retour depuis le cache et affichage des impayés FR/EN/AR.

Aucune nouvelle migration SQL. Aucun paiement, remboursement, email ou ajustement réel de stock n’est exécuté pour ces vérifications.
