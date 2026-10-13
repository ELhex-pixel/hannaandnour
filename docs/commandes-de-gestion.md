# Mes commandes de gestion

## Activation

Avant publication, exécuter tout le fichier **`supabase/migration_admin_maintenance.sql`** dans le SQL Editor Supabase du site, puis confirmer au développeur. Le fichier ajoute les opérations et leur journal privé ; **l’exécution de cette migration ne remet aucun stock à zéro, n’archive aucune commande et ne supprime aucune donnée de boutique**. Elle est transactionnelle et rejouable. Le build vérifie sa présence en lecture seule.

Après publication, ouvrir l’admin → **Mes commandes de gestion** (`/admin.html#maintenance`). Le bilan des ventes propose également un accès direct à cette rubrique.

## Tu choisis l’opération

1. Choisir l’un des huit boutons.
2. Pour les produits, messages et brouillons : sélectionner les éléments, jusqu’à 100 par opération (10 brouillons maximum).
3. **Voir l’aperçu avant confirmation** : le nombre d’éléments concernés s’affiche. Pour le stock, le nombre d’unités à retirer s’affiche aussi.
4. Saisir le motif, puis le mot demandé : **ZERO**, **ARCHIVER** ou **SUPPRIMER**.
5. Confirmer la boîte de dialogue. Le serveur relit les données avant d’exécuter et conserve la référence de l’opération.

### Stock

**Tout le stock disponible à zéro** concerne les variantes du catalogue actuel avec une quantité positive, y compris les produits hors ligne/archivés et variantes désactivées. Les fiches retirées du catalogue restent hors de cette opération. Les produits sans stock configuré n’ont pas de quantité à effacer ; cette commande ne crée pas de variantes.

Les quantités déjà réservées ou vendues dans les commandes, les ventes et les historiques restent conservés. Une annulation de réservation ou un retour physique reçu après cette opération peut rendre des unités de nouveau disponibles. Chaque variante remise à zéro reçoit un ajustement de comptage avec ton motif dans le journal du stock.

### Listes à ranger

- **Commandes terminées** : les commandes livrées, annulées ou remboursées, sans réservation ni retour/remboursement ouvert, sont retirées de la liste courante. Pour les consulter : Commandes → **Archives conservées**.
- **Retours traités** : les demandes reçues ou refusées sont rangées. Pour les consulter : Retours clients → **Historique archivé**.
- **Journal courant du stock** : les ajustements sont rangés, sans changer les quantités. Pour les consulter : Stock détaillé → Historique des ajustements → **Archives**.

Les boutons d’accès aux trois archives sont aussi disponibles directement dans Mes commandes de gestion.

### Suppression définitive

- **Produits inutilisés** : uniquement les produits hors ligne, sans stock et sans commande, avis, ajustement ou coût lié. Les fichiers photo ne sont pas effacés. Pour une fiche ayant un historique, utiliser la suppression du catalogue dans Produits.
- **Statistiques de visite** : les événements présents à la date de l’aperçu sont effacés. Les nouvelles visites, les ventes et les montants restent conservés.
- **Messages de contact** : uniquement ceux sélectionnés sont effacés.
- **Brouillons expirés** : commandes en ligne impayées de plus de 72 heures, sans réservation ni stock débité ni historique financier. Si une session Stripe existe, le serveur vérifie qu’elle est expirée, impayée, liée à la bonne commande et sans paiement associé. Une création Stripe incertaine doit être rapprochée avant que le brouillon puisse être supprimé. Cette opération n’expire pas de session, ne débite rien et ne rembourse rien.

## Réponse non confirmée

L’identifiant et le contenu de la tentative sont conservés avant envoi. Après une interruption, recharger/reconnecter puis utiliser **Vérifier / reprendre la même opération**. Le serveur retrouve le résultat enregistré sans répéter la remise à zéro ou la suppression.

Si le serveur confirme que les données ont changé ou qu’un élément n’est plus éligible, refaire l’aperçu avant une nouvelle confirmation. L’historique des commandes de gestion affiche les 20 dernières opérations, leur motif et leur référence.

Les vérifications de développement utilisent des données locales et des fixtures navigateur. Aucune opération réelle n’est effectuée pendant ces tests.
