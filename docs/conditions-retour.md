# Conditions publiques de retour et de remboursement

Page conservée à l’adresse existante : **https://hannanour.com/fr/terms.html**.

## Informations confirmées par le propriétaire

- Contact : `care@hannanour.com`, confirmé actif.
- Destinataire et numéro fournis : `AOUS 17`, après demande de confirmation de l’adresse « Allée de l’Arlequin, 92000 Nanterre ».
- Adresse publiée : **Hanna & Nour — AOUS, 17 allée de l’Arlequin, 92000 Nanterre, France**.
- Organisation : retour par colis et remboursement ; nouvelle commande pour une autre taille ou un autre coloris, pas d’échange commercial direct.
- Aucun frais de remise en stock, conformément à l’option choisie dans Merchant Center.
- Politique lue au début du travail : 15 jours, changement d’avis à la charge du client, défaut/erreur à la charge de la boutique. Ces réglages restent administrables et ne sont pas réécrits par ce lot.

## Contenu

La page remplace le texte de démonstration par la procédure de livraison/retour, le délai commercial reçu de la configuration, le droit de rétractation de 14 jours minimum et ses règles de calcul, les canaux de notification sans compte obligatoire, l’adresse d’expédition du retour, l’état des biens et l’examen permis, la prise en charge des frais, les garanties légales distinctes du délai commercial, les modalités de remboursement et un modèle facultatif de déclaration de rétractation.

Le remboursement est décrit sans retard injustifié et au plus tard dans les 14 jours de la notification, avec le report légal jusqu’au bien ou à la preuve d’expédition, première date retenue. Le délai bancaire est distingué de l’émission. Aucune promesse non confirmée de réception en deux jours, ni délai de livraison chiffré non fourni, n’est créé.

Les commandes anciennes conservent leurs conditions plus favorables et leurs snapshots ; les garanties ne sont pas enfermées dans le délai commercial. Les dispositions applicables aux produits défectueux ne sont pas remplacées par le simple parcours de retour commercial.

## Mise en œuvre

- Présentation HTML, thème, navigation et URL existants conservés.
- `public/js/returns-conditions.js` : contenu FR/EN/AR et validation des faits publics.
- `scripts/returns-conditions.js` : lecture bornée de la seule politique `return_policy` pour le pré-rendu. En production, un réglage invalide bloque le build au lieu de publier un faux délai.
- `public/js/returns-page.js` : rafraîchit les conditions depuis une configuration fraîche validée, sans cache propre et sans action sur commandes, paiements ou stock. Une panne conserve le texte publié et signale que le réglage actuel n’a pas pu être vérifié.
- Le texte complet est lisible sans connexion et sans JavaScript après build ; les champs numériques et de prise en charge sont pré-rendus depuis la politique effective. En build local sans base, aucune valeur commerciale non vérifiée n’est inventée.

## Réglages Google Merchant Center à faire correspondre

- URL : `https://hannanour.com/fr/terms.html`.
- Retours défectueux et non défectueux acceptés ; période commerciale actuelle à reprendre depuis la page.
- Pas d’échange commercial direct.
- Méthode : envoi postal/par colis ; envoi à la charge du client pour un changement d’avis selon le réglage de sa commande, prise en charge boutique pour défaut/erreur.
- Aucuns frais de remise en stock.
- Le champ Google relatif à la réception du remboursement ne doit pas être assimilé à un simple délai de clic dans Stripe ; aucun délai bancaire de deux jours n’a été confirmé par le propriétaire.

## Références consultées

- Service Public, droit de rétractation : https://www.service-public.gouv.fr/particuliers/vosdroits/F10485
- Service Public, garantie légale de conformité : https://www.service-public.gouv.fr/particuliers/vosdroits/F11094
- Aide Google Merchant Center, retours : https://support.google.com/merchants/answer/14011730?hl=fr

Aucune migration ou nouvelle règle financière n’est requise. Les contrôles utilisent des données locales simulées et des lectures publiques ; aucune demande, remboursement ou notification réelle n’est envoyé pour tester.
