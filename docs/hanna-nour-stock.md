# Hanna & Nour Stock — installation et utilisation

## Activation

L’application est développée dans `public/stock.html`. Avant publication, exécuter **tout le fichier `supabase/migration_physical_sales.sql`** dans le SQL Editor de la base Supabase du site. Cette migration est transactionnelle et rejouable ; elle ajoute les opérations de vente physique, leur journal privé et deux champs de commande. Elle ne réinitialise aucun stock et ne recrée aucun code-barres.

Confirmer l’exécution au développeur avant publication. Le build distant vérifie le marqueur et les champs en lecture seule : une base non migrée bloque le déploiement. Aucun SQL distant n’est exécuté automatiquement.

Après publication :
1. Ouvrir **https://hannanour.com/stock.html** dans Safari sur l’iPhone.
2. Partager → **Sur l’écran d’accueil** → Ajouter. L’icône s’appelle **HN Stock**.
3. Se connecter avec le mot de passe administrateur actuel. L’application peut demander une nouvelle connexion après expiration de la session.
4. Autoriser la caméra lors du premier scan. Aucun abonnement d’application supplémentaire n’est requis.

Une connexion Internet est nécessaire. Si la caméra n’est pas disponible, saisir le code dans le champ ou utiliser un scanner qui agit comme un clavier. Le décodage caméra est livré localement, sans CDN, et ne dépend pas de l’API BarcodeDetector absente de certaines versions de Safari. Vérifier la mise au point et la lisibilité des étiquettes sur l’iPhone réel après activation.

## Deux étiquettes séparées, par variante

L’**accueil de gestion** (`/admin.html#dashboard`) rassemble huit accès : vente magasin, stock, commandes, étiquettes, produits, bilan des ventes, retours et contenus du site. Le bouton « Accueil de gestion » est visible dans les deux espaces. Sur iPhone, les rubriques de l’admin se déplient ; sur ordinateur, elles restent dans la barre latérale.

Les accès « Vendre », « Stock » et « Étiquettes » ouvrent directement le bon écran, y compris après connexion. Les filtres, aides, références et détails de calcul sont repliés ; ils restent disponibles en ouvrant leur titre. Une opération incertaine passe toujours avant un changement de parcours.

Dans **Étiquettes**, choisir le modèle + coloris + taille, puis imprimer séparément :
- **VENTE · CODE-BARRES** : code CODE128 correspondant au code-barres existant de la variante.
- **STOCK · QR CODE** : lien vers la variante dans l’application, avec son UUID.

Le modèle, le coloris et la taille figurent sur les deux étiquettes. Le choix d’une variante dans Étiquettes affiche directement les deux boutons d’impression, sans ouvrir le formulaire d’ajustement du stock. Les étiquettes sont conçues pour une largeur d’environ 70 mm ; choisir le papier, l’imprimante et l’échelle dans la boîte de dialogue d’impression. Une imprimante accessible depuis l’iPhone peut utiliser AirPrint ; l’impression est également possible depuis un ordinateur.

Les variantes sont regroupées par modèle. Ouvrir le modèle, puis utiliser directement **Code-barres · vente** ou **QR code · stock** sur la bonne couleur/taille. La recherche porte sur tout le catalogue éligible, pas uniquement la page affichée ; elle accepte modèle, référence, coloris, taille ou code-barres. Chaque page contient jusqu’à 20 variantes, et un modèle peut donc apparaître sur plusieurs pages. Les libellés One Size/Taille unique sont affichés en français sans modifier les variantes enregistrées.

Un code-barres manquant doit être généré dans l’admin → Bilan des ventes → Générer les codes manquants. Le QR code n’a pas besoin de changer ce code-barres. Scanner un QR avec la caméra native de l’iPhone ouvre la page ; l’authentification admin reste obligatoire. Le QR ne donne aucun droit d’accès et ne contient aucun token ni mot de passe.

## Vente physique — encaissement externe

1. Choisir **Ventes · code-barres** et scanner l’étiquette de vente.
2. Vérifier la variante, puis **Ajouter une unité au panier**. Modifier les quantités si nécessaire.
3. **Actualiser le récapitulatif** : les prix du catalogue, la devise, la TVA et le stock disponible sont relus sur le serveur.
4. Encaisser le **total affiché** en espèces, avec le terminal bancaire ou un autre moyen externe.
5. Choisir le moyen de paiement, cocher la confirmation d’encaissement/remise des articles, puis confirmer la vente.

L’application ne débite aucun paiement. Elle enregistre une commande payée/remise (`HN-P-…`), les lignes, les coûts historiques disponibles et le retrait de stock dans **une seule transaction**. Les ventes figurent dans l’historique de l’application, les commandes et les statistiques de l’admin.

Par défaut, le prix physique correspond au prix catalogue augmenté de la TVA configurée, comme le calcul du site, sans livraison, code promo ni promotion automatique du panier en ligne. Si le catalogue, la TVA, la devise ou la disponibilité changent avant confirmation, le serveur refuse l’ancien récapitulatif ; relire et confirmer les nouvelles valeurs. Le montant encaissé à l’extérieur doit correspondre au montant confirmé.

### Baisser ou augmenter le prix d’une vente

Avant activation de cette option, exécuter **`supabase/migration_physical_prices.sql`** dans Supabase et confirmer son exécution avant publication. Cette migration ajoute les snapshots et les fonctions ; elle ne change aucun prix du catalogue, aucune quantité ni aucun montant d’une ancienne commande.

Dans le panier, modifier **Prix unitaire pour cette vente (hors TVA)**. La virgule et le point sont acceptés, avec deux décimales maximum. Le prix peut être inférieur ou supérieur au catalogue, ou égal à zéro pour offrir l’article. Une note de prix est facultative. Le prix choisi s’applique à toutes les unités de cette ligne.

Cliquer ensuite sur **Vérifier les prix et le total** : la TVA et le total sont recalculés par le serveur. Une modification du prix, de la note ou des quantités demande une nouvelle vérification et une nouvelle confirmation d’encaissement. **Revenir au prix catalogue** annule le prix personnalisé de la ligne. Le catalogue et le prix d’achat restent inchangés.

Les nouvelles ventes conservent le prix catalogue d’origine, le prix réellement vendu et la note éventuelle dans l’historique de l’application et les détails de la commande admin. Les anciennes commandes gardent leurs montants ; leur ancien prix catalogue non enregistré n’est pas reconstitué artificiellement.

## Stock — QR code

1. Choisir **Stock · QR code** et scanner l’étiquette de la variante.
2. Choisir : ajout d’arrivage, retrait justifié ou correction du disponible après comptage.
3. Saisir une quantité entière et un motif.
4. Vérifier la prévisualisation avant/après et confirmer.

Le **stock disponible** exclut les quantités déjà réservées par les commandes en ligne. Un comptage doit donc porter sur ce disponible, pas sur une quantité comprenant les colis déjà réservés. Les ajustements restent dans le journal Stock de l’admin. Une variante désactivée peut être consultée/ajustée, mais une vente physique exige des variantes et produits actifs, non retirés du catalogue.

## Réponse perdue ou connexion interrompue

La tentative est sauvegardée avant envoi, avec un identifiant stable. L’application bloque les nouvelles modifications et propose **Vérifier / reprendre**. Un réessai après rechargement ou reconnexion utilise le même identifiant et le même contenu : il retrouve la vente existante au lieu de déduire une deuxième fois le stock.

Ne pas effacer le stockage de Safari ni créer une deuxième vente pour remplacer une réponse incertaine. Les conflits explicitement refusés par la transaction permettent de relire les données et confirmer à nouveau. La déconnexion ferme la caméra et masque les données ; la tentative incertaine reste récupérable à la prochaine connexion.

Les retours physiques et remboursements sont des opérations distinctes. Un remboursement d’un encaissement externe doit être traité avec ce moyen de paiement ; la nouvelle application ne déclenche pas de remboursement Stripe pour ces ventes.

## Vérifications réalisées localement

- Migration rejouée, rollback vérifié, droits privés/RLS, montants et snapshots de coûts.
- Réessais/concurrence : une vente et un seul retrait de stock pour le même identifiant.
- Réservation en ligne entre devis et confirmation ; prix changé, stock épuisé, variante désactivée et produit retiré.
- Navigateur : lecture sans écriture au scan, panier, confirmation, réponse perdue puis reprise après rechargement, ajustement QR, deux étiquettes distinctes, historique, déconnexion et largeurs 320/390/1024 px.
- Les tests utilisent des fixtures et une base locale ; aucune vente, opération de stock, paiement ni email réels n’a été effectué.
# Modification rapide depuis la fiche produit

Dans **Produits → Modifier → Quantités par taille et coloris**, chaque variante enregistrée propose **Modifier ici**. Le panneau s’ouvre sous sa ligne et conserve les autres champs en cours de saisie.

1. Choisir **Arrivage**, **Retrait** ou **Correction : nouveau disponible**.
2. Renseigner la quantité et le motif du mouvement.
3. Vérifier l’aperçu avant → après, puis confirmer.

Une correction remplace le **disponible**, hors unités réservées ou déjà vendues ; un arrivage ajoute les unités saisies. Le bouton d’actualisation relit le stock réel et les mouvements restent dans le journal existant. Le stock s’enregistre dès la confirmation de l’ajustement ; le bouton **Enregistrer le produit** concerne ensuite les autres champs de la fiche.

Si le résultat d’une demande reste incertain, utiliser **Réessayer la même opération**, y compris après fermeture ou rechargement de la fiche. Le même identifiant est conservé pour éviter un double mouvement. Une autre variante ou le gestionnaire complet ne permet pas de créer un mouvement distinct tant que cette opération n’est pas résolue.
