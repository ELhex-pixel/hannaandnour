# Remise à zéro synchronisée des chiffres et des visites

## Fonctionnement

Dans **Chiffres & visites** et **Bilan des ventes**, le bouton **Remettre chiffres et visites à zéro** démarre une nouvelle période commune, après saisie d’un motif et confirmation.

La période concerne :

- chiffre d’affaires, net après remboursements et commandes payées, en ligne et en magasin ;
- articles vendus, unités retournées, remboursements et coûts des articles vendus ;
- tableau des ventes, prix d’achat historiques et marges par produit, graphique des encaissements ;
- pages vues, produits consultés, ajouts panier, paiements commencés et achats web suivis ;
- classements des produits et des pages les plus consultés.

**Période actuelle** affiche l’activité depuis la dernière remise à zéro. **Historique antérieur** affiche les données précédentes. **Toutes les périodes** permet de retrouver l’ensemble. Les deux rubriques partagent la sélection et la coupure enregistrée sur le serveur.

Les commandes et leurs montants ne sont ni effacés, ni remboursés, ni réécrits. Les visites sont conservées. Les stocks disponibles et les prix d’achat configurés sont des données actuelles, distinctes des compteurs de période. Un coût historique absent n’est pas inventé ; l’avertissement de coût manquant reste visible dans la période où la vente figure.

Les retours et remboursements restent rattachés à la date de paiement de leur commande, même s’ils sont enregistrés plus tard. Les statistiques de visites utilisent la date de l’événement ; les achats suivis ne sont pas le journal financier des ventes.

## Reprise et synchronisation

Une demande incertaine conserve son identifiant et son contenu dans `hn-admin-activity-period-operation`. Réessayer reprend exactement cette demande et ne démarre pas une deuxième période. Une modification de période dans une autre fenêtre impose une nouvelle lecture avant toute nouvelle confirmation.

Les lectures du tableau de bord et du bilan indiquent l’identifiant de période attendu. Le serveur refuse une période périmée ; une panne ne devient pas un tableau à zéro. Les bornes de date sont appliquées avant la pagination et conservent les microsecondes à la frontière, sans vente perdue entre deux périodes.

## Migration avant publication

Fichier : **`supabase/migration_activity_periods.sql`**.

Cette nouvelle migration ajoute uniquement `admin_activity_periods`, la RPC privée `start_admin_activity_period` et le marqueur `activity_periods_schema_version()` égal à 1. La table est privée, avec RLS et sans droits publics ; le rôle serveur peut lire et insérer, pas supprimer le journal. L’exécution du fichier ne démarre aucune période et ne modifie aucune commande, visite, quantité ou valeur existante.

1. Le propriétaire ouvre le projet Supabase de la boutique → SQL Editor → New query.
2. Il exécute uniquement ce nouveau fichier.
3. Il confirme « migration exécutée » — confirmation reçue du propriétaire pour ce lot.
4. Le contrôle de publication vérifie le marqueur et la table en lecture seule avant de publier.

Aucune migration ni remise à zéro réelle n’est exécutée automatiquement par les tests ou le build.

## Vérifications de ce lot

- Tests des frontières exactes avant / à / après la coupure, compteurs financiers et classements cohérents.
- PGlite : migration rejouée, reprise du même identifiant, conflit de période refusé et conservation des commandes, visites et stocks.
- Contrôles de session admin et quota avant les actions.
- Navigateur local : remise commune, reprise après réponse perdue/rechargement, historique restauré, synchronisation du bilan et affichage mobile/ordinateur.

Les anciennes commandes de maintenance **stock à zéro** et **suppression des événements de visite** ont leurs effets propres. Le nouveau bouton de période conserve les données historiques.
