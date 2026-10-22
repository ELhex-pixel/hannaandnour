# Statistiques des visites : exclure les navigateurs de gestion

## Utilisation

Dans **Admin → Chiffres & visites → Ne pas compter mes propres visites**, le statut indique si le navigateur courant est exclu.

- Une connexion admin ou Stock active l’exclusion de ce navigateur. Une session admin déjà présente est également reconnue au chargement.
- L’exclusion est conservée après déconnexion et partagée entre les onglets sur le même domaine. Elle s’applique à chaque prochain événement, y compris si la boutique était déjà ouverte dans un autre onglet.
- Connectez-vous une fois à l’admin sur chaque navigateur et appareil utilisé pour gérer la boutique. Un autre profil, la navigation privée ou un autre domaine ne partage pas le réglage.
- Le bouton **Exclure ce navigateur des visites** permet aussi de l’activer directement. **Réactiver le comptage après déconnexion** la retire après confirmation ; la session admin, tant qu’elle est détectée, reste exclue.
- Si le stockage navigateur est indisponible, le statut indique que la persistance et le partage entre onglets ne sont pas garantis.

## Compteurs

Une page vue est un affichage, pas une personne. Une même personne peut voir plusieurs pages ou recharger une fiche. Les statistiques existantes ne contiennent pas d’identifiant de visiteur permettant de dédupliquer les personnes ou de retrouver a posteriori les passages du propriétaire.

Les anciennes pages explicitement de gestion (Admin, Stock, impression, API) sont retirées du calcul des vues et classements, sans suppression de lignes. Les anciennes visites du propriétaire sur les pages publiques restent dans l’historique puisqu’elles ne sont pas identifiables de façon fiable. Aucun compteur, période, commande ou historique financier n’est automatiquement remis à zéro.

Les ventes réellement payées restent dans les rapports financiers et dans les achats web suivis. Un achat d’essai payé par le propriétaire demeure une vraie transaction ; l’exclusion de navigation ne l’efface pas.

## Fonctionnement

- `analytics-preferences.js` utilise uniquement le marqueur local `hn-analytics-excluded=1`, sans copier le token administrateur dans `localStorage`, sans IP, email ou empreinte navigateur.
- `store.track` consulte la préférence avant `sendBeacon` ou `fetch` pour les pages vues, vues produit, ajouts panier et essais de checkout. Aucun appel analytique n’est envoyé pour ces événements internes.
- Le build charge le module avant `store.js` sur les pages publiques. Les sources admin et Stock le chargent avant leurs contrôleurs de connexion. Les appels et contrôles commerciaux continuent à fonctionner indépendamment du suivi.
- Le serveur refuse d’enregistrer les événements de pages explicitement de gestion avant toute écriture ; les rapports appliquent aussi ce filtre aux anciennes lignes concernées. Les événements `purchase` du webhook de paiement ne sont pas exclus.
- Aucune migration SQL ni collecte nominative supplémentaire. Pas de liste de clients ajoutée aux statistiques de visite.

## Vérifications

Tests et fixtures locales : visiteur ordinaire, exclusion admin restaurée/nouvelle, Stock, onglets, après logout, réactivation confirmée, stockage refusé, préférences reçues dans une boutique déjà ouverte, absence de jeton dans le suivi, confidentialité des paramètres, filtres serveur/agrégateurs et conservation des achats.
