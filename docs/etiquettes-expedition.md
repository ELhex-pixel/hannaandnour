# Étiquettes d’expédition Mondial Relay

## Choix confirmés

- Départ France, livraisons en point relais / locker pour les quatre pays déjà retenus, selon les offres réellement disponibles.
- Emballages : pochettes et cartons.
- **Poids réel et dimensions du colis fermé saisis sur chaque commande**, sans poids supposé issu des exports « 1–2 kg ».
- Étiquette PDF, format A6 ou A4 au téléchargement.

## Parcours préparé

1. Dans **Préparer les colis**, terminer le contrôle des quantités de la commande payée.
2. Dans **Commandes → Voir**, ouvrir **Étiquette Mondial Relay — préparer / télécharger**.
3. Choisir l’adresse expéditeur configurée dans Sendcloud.
4. Saisir l’emballage, le poids en kg, puis longueur, largeur et hauteur / épaisseur en cm.
5. Cliquer sur **Consulter les services et tarifs** : cette consultation ne crée pas d’étiquette.
6. Choisir explicitement un service parmi les offres compatibles avec le relais et le colis.
7. Vérifier l’estimation Sendcloud, puis confirmer **Créer l’étiquette choisie**.
8. Une fois la création confirmée, télécharger le PDF A6 ou A4.

Les poids acceptent trois décimales de kg (précision au gramme), les dimensions une décimale de cm (précision au millimètre). Les deux séparateurs virgule et point sont acceptés. Aucun article, poids ou dimension n’est inventé.

Le prix indiqué est une **estimation de transport Sendcloud**. Les frais de livraison facturés au client, les montants de la commande, sa TVA et son paiement restent ceux déjà enregistrés. Les coûts d’affranchissement ne sont pas automatiquement intégrés à la marge articles.

La création d’une étiquette conserve son numéro de suivi. Elle ne signifie pas que le colis a été remis au transporteur : le statut expédié et l’email d’expédition suivent le parcours existant. L’automatisation des événements de suivi viendra ensuite.

## Conditions et conservation

Le parcours vise un **colis unique**, pour une commande en ligne payée, contrôlée en préparation, sans remboursement / retour en cours ni anomalie de stock. Le relais doit être celui enregistré et vérifiable. Les ventes physiques et les anciens retraits saisis en texte libre ne fournissent pas les données nécessaires à ce parcours.

Le serveur relit l’expéditeur, le relais, la commande et le service avant la première création. Le devis signé expire après dix minutes. Un prix ou une préparation modifiés imposent un nouveau devis et une confirmation.

Le journal privé conserve le contenu accepté avant l’appel fournisseur. Une seule demande active peut concerner la commande. La référence externe **`hn-label-<UUID>`** est conservée ; l’API v3 Sendcloud documente une réponse 409 avec l’envoi existant lorsque cette référence est réutilisée.

Si la réponse se perd, utiliser **Vérifier / réessayer la même demande**. La réouverture récupère aussi une demande présente dans le journal. La reprise recherche d’abord l’envoi existant, sans modifier son colis ou son destinataire. Si le devis conservé est expiré ou le service a changé, une absence de confirmation reste à rapprocher avec Sendcloud ; elle ne permet pas de lancer une nouvelle demande distincte.

Une annonce explicitement échouée peut être enregistrée comme telle et laisser place à un nouveau devis. Une réponse partielle, un envoi annulé, une incohérence d’identité ou une panne ne sont pas traités comme une création réussie. Les instantanés et opérations terminées ne sont pas réécrits.

Si l’état de la commande change pendant l’appel, l’étiquette obtenue reste dans le journal, avec un signalement à contrôler. Les montants ou statuts de paiement et le stock ne sont pas modifiés par ce rapprochement.

## Migration avant publication

Fichier : **`supabase/migration_order_shipping.sql`**.

Cette migration transactionnelle et rejouable crée le journal privé et ses fonctions. Elle ne crée aucun envoi et n’achète aucune étiquette ; elle n’altère aucune ancienne commande. Le rôle serveur ne peut pas supprimer les opérations. Les demandes et résultats terminés sont protégés contre une réécriture.

1. Le propriétaire ouvre le projet Supabase de la boutique → SQL Editor → New query.
2. Il exécute uniquement ce nouveau fichier, après les migrations déjà installées.
3. Il confirme « migration exécutée » — confirmation reçue du propriétaire pour ce lot.
4. Le preflight distant vérifie `order_shipping_schema_version() = 1` et les colonnes du journal en lecture seule avant publication.

## Vérifications

- Tests des conversions exactes, de l’éligibilité, des offres / tarifs signés et des modifications de devis.
- Clients fournisseur simulés : référence stable, réponse 409, réponse fournisseur / confirmation SQL perdue, données partielles et PDF invalide.
- PGlite : migration rejouée, demande unique et immuable, préparation périmée refusée, échec terminal conservé et suivi sans second débit de stock.
- Navigateur sur le build compacté : saisie par commande, service non présélectionné, absence d’achat au devis, reprise identique, téléchargement simulé et affichage mobile / ordinateur.

Tous les essais de création utilisent des données fictives. Aucun affranchissement, paiement, email ou mouvement de stock réel n’est réalisé par les tests.

## Références API v3

- https://sendcloud.dev/docs/service-points/creating-a-parcel-with-service-point-delivery.md
- https://sendcloud.dev/api/v3/shipping-options/return-a-list-of-available-shipping-options.md
- https://sendcloud.dev/api/v3/shipments/create-and-announce-a-shipment-synchronously.md
- https://sendcloud.dev/api/v3/shipments/retrieve-shipments.md
- https://sendcloud.dev/api/v3/parcel-documents/retrieve-a-parcel-document.md
