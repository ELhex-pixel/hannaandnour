# Mondial Relay — choix du relais au paiement

## Décisions du propriétaire

- Expédition depuis la France.
- Destinations relais : France métropolitaine, Belgique, Espagne et Pays-Bas, selon les points réellement retournés et disponibles.
- **Tarif unique Point Relais / Locker : 5,99 €**, modifiable dans l’admin → Paramètres → Retrait / point relais. La configuration publique a confirmé `pickup_cents: 599` ; ce lot ne réécrit aucun réglage de prix, devise ou TVA.
- Les exports Sendcloud servent de référence de coût pour leur tranche « 1–2 kg », pas de prix automatiquement imposés aux clients.

## Fonctionnement du lot

Le client sélectionne le mode Point Relais, choisit son pays et recherche par code postal. Les résultats sont une liste de radios accessibles : aucun point n’est présélectionné. Les noms/adresses du fournisseur restent du texte, y compris si leur contenu ressemble à du HTML.

Le changement de pays ou de code postal efface le choix et les anciens résultats. Les réponses d’une recherche devenue obsolète ou d’un mode de livraison quitté sont ignorées. Une panne/vide laisse le paiement bloqué en mode relais ; une nouvelle recherche permet la reprise.

La recherche publique `/api/service-points` est limitée à 30 appels par 10 minutes par clé de quota existante, vérifie l’activation du retrait et ne transmet aucune clé fournisseur au navigateur. Le client Sendcloud garde un délai de 5 secondes par requête, un corps JSON limité à 512 Ko, aucune redirection, aucun cache et aucun réessai automatique.

Avant toute création de commande, réservation ou session Stripe, le serveur :

1. Valide l’identifiant entier, le pays parmi FR/BE/ES/NL, l’empreinte et la présence du téléphone.
2. Relit le détail officiel `/service-points/{id}`.
3. Vérifie le transporteur `mondial_relay`, le type relais/locker, le pays, l’adresse, l’identité et la fraîcheur.
4. Compare l’empreinte des coordonnées : un changement impose une nouvelle sélection explicite.
5. Appelle le **POST de vérification de disponibilité**, `/service-points/{id}/check-availability`, et exige `is_available: true`.
6. Enregistre les coordonnées canoniques, l’identifiant Sendcloud, l’identifiant transporteur et l’heure de contrôle.

Les codes de transporteurs de remplacement non reconnus sont refusés, même si le fournisseur propose un réseau différent. Une absence de résultats ne confirme pas l’absence de couverture commerciale.

Le devis reste l’autorité pour les prix, frais, TVA, devise et politique de retours. Le tarif provient toujours du champ global admin ; les valeurs commerciales envoyées par le navigateur ne deviennent pas des prix serveur. Le stock reste réservé atomiquement par la RPC existante.

## Migration nécessaire avant publication

Fichier : **`supabase/migration_checkout_pickup.sql`**.

Cette migration transactionnelle et rejouable ajoute une colonne nullable `orders.pickup_point_data`, son contrôle de forme et une protection de l’instantané déjà enregistré. Elle ajoute aussi le marqueur privé `checkout_pickup_schema_version()`. Elle ne met à jour aucune ancienne commande, aucun prix ni stock, et ne crée aucune politique RLS publique.

Procédure :

1. Le propriétaire ouvre le projet Supabase de la boutique et son **SQL Editor**.
2. Il exécute uniquement ce nouveau fichier, après les migrations déjà installées.
3. Il confirme « migration exécutée » — confirmation reçue du propriétaire pour ce lot.
4. L’agent effectue le preflight distant en lecture seule : marqueur égal à 1 et colonne disponible.
5. Le lot peut alors être publié selon la procédure habituelle.

Le preflight bloque le déploiement si le schéma manque. Aucune migration distante n’est lancée par le code ou les tests.

## Vérifications réalisées

- `npm run check`, `npm test`, `npm run build` : réussis, **413 tests locaux** avec l’ajustement rapide du stock inclus dans le même lot.
- Migration exécutée deux fois sur PGlite local : ancien retrait inchangé, snapshot valide conservé, changement du snapshot refusé, marqueur privé.
- Tests serveur : quatre pays, formats postaux, identité/pays/transporteur, point expiré/modifié/indisponible, protection du quota, panne fournisseur et absence d’effet commercial avant validation.
- Navigateur local sur le build compacté : 390 px FR/EN/AR et 1440 px FR ; quatre pays, frais 5,99 €, choix explicite, absence d’injection HTML/débordement, vide/panne/reprise, réponse tardive ignorée, gel pendant paiement et double clic.
- Toutes les commandes, points et paiements de ces tests sont fictifs. Aucun achat d’étiquette, débit Stripe, email ou mouvement de stock réel.

## Suite de l’étape livraison

Le choix du relais et son contrôle ne constituent pas une validation du poids, des dimensions ou du service d’affranchissement pour un colis. Le lot suivant, préparé dans `docs/etiquettes-expedition.md`, ajoute les mesures par commande, le devis et l’étiquette PDF avec reprise. Il nécessite sa nouvelle migration avant publication. Le rapprochement automatique des événements de transport et les notifications restent une étape ultérieure.

Les retours et leur transport restent distincts de la livraison aller à 5,99 €.

## Documentation fournisseur consultée

- https://www.sendcloud.dev/api/v3/service-points/retrieve-a-list-of-service-points
- https://www.sendcloud.dev/api/v3/service-points/retrieve-a-service-point
- https://www.sendcloud.dev/api/v3/service-points/check-availability-of-a-service-point
