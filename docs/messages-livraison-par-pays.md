# Messages de livraison et pays approximatif

Le propriétaire a choisi : détection automatique du pays approximatif, textes du bandeau et du pied de page calculés à partir des règles de l’admin, **conservation des tarifs actuels** et des quatre pays ouverts. Le tableau de tarifs CSV proposé a été refusé : aucun prix, aucune marge, aucun transporteur ni aucune activation de pays n’est importé ou modifié par ce changement.

## Pays détecté et choix du client

`shipping-country.mjs` est une petite fonction Netlify **v2** utilisant `context.geo.country.code`, fourni par la plateforme. Ce format ESM isolé permet l’accès au contexte géographique documenté ; les fonctions commerciales existantes restent en CommonJS.

L’endpoint GET `/api/shipping-country` / `/.netlify/functions/shipping-country` ne renvoie que `{country: "FR"}` ou `null`. Il ne consulte ni n’enregistre une IP, ville, position GPS ou coordonnée, ne lit pas de base de données, ne contacte pas de service externe et ne journalise pas la géolocalisation. La réponse ne peut pas être mise en cache partagé. Les paramètres et en-têtes de pays fournis par le navigateur sont ignorés.

`public/js/shipping-country.js` attend au maximum trois secondes et mémorise seulement le code pays dans sessionStorage pour la navigation. Une détection manquante ou invalide laisse une indication neutre et un choix manuel. Le choix enregistré dans le panier/paiement reste prioritaire, y compris si une réponse de détection arrive plus tard. Le stockage refusé conserve un fonctionnement en mémoire pour la page.

Le pays approximatif est une aide d’affichage et de présélection, pas une preuve de destination. Le client peut toujours choisir son véritable pays de livraison dans le panier ou au paiement. Un pays non ouvert n’est jamais remplacé automatiquement par la France.

## Textes et prix

Le bandeau, même lorsqu’un code promo y figure, le pied de page et les informations de livraison de la fiche produit utilisent le même résumé du pays courant :

- nom du pays et tarif standard actif ;
- tarif relais/locker si payant, ou son seuil avant réduction si l’option de gratuité est cochée ;
- mention d’indisponibilité si le pays/mode n’est pas proposé ;
- message neutre si le pays ou une configuration fraîche manque.

Le cas `announcePromo` compose désormais le résumé de livraison et la promotion, au lieu de réutiliser l’ancienne promesse générale « Livraison gratuite dès 80 € ». Les textes changent avec le choix du pays, la langue et les nouvelles réponses de configuration. FR/EN/AR restent cohérents.

Le propriétaire a ensuite demandé la formulation courte **« Livraison offerte dès 80 € avant réduction »**, sans nom de pays ni liste de tarifs dans le bandeau et le pied de page. Le seuil reste calculé à partir des règles du pays courant. Si la gratuité relais est désactivée, ils indiquent « Livraison payante ». La fiche produit et les choix de livraison au paiement conservent les détails des modes, tarifs et conditions avant confirmation de commande. Les règles commerciales et la sélection du pays restent les mêmes.

Les tarifs restent exclusivement dans `settings.shipping_rules`. Les devis et paiements relisent et contrôlent toujours la destination réelle côté serveur. Aucune migration SQL ni mutation de réglages n’est nécessaire pour cette évolution d’affichage.
