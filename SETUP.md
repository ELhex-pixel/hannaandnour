# Hanna & Nour — Configuration (Supabase + Stripe + Netlify)

Ce site statique est devenu un e-commerce complet : catalogue stocké dans **Supabase**,
paiement réel via **Stripe Checkout**, et une API servie par des **Netlify Functions**.

> Le projet fonctionne **sans configuration** en pur front-end (catalogue démo en dur,
> totaux, ajouts au panier persistés en localStorage). Pour activer le backend,
> suivez ce guide.

---

## 1. Créer le projet Supabase

1. Créez un compte/projet sur https://supabase.com.
2. Dans **SQL Editor**, exécutez dans l'ordre :
   - `supabase/schema.sql` (tables + RLS + trigger)
   - `supabase/seed.sql` (6 produits + promo `WELCOME15`)
   - `supabase/seed_products_2.sql` (6 produits supplémentaires)
   - `supabase/migration_variants_admin.sql` (variantes/stock, settings, livraison — idempotent)
   - `supabase/rls_accounts.sql` (comptes clients : table `user_wishlist` + RLS sur la commande et les favoris — défense en profondeur)
   - `supabase/migration_promos_refunds.sql` (remboursements : RPC `increment_stock` pour re-stocker une commande remboursée)
   - `supabase/migration_relance_analytics.sql` (relance panier + analytics maison : colonnes `cart_restore_token`/`relance_sent_at` sur `orders`, table `analytics_events`)
   - `supabase/migration_model_catalog.sql` (catalogue modèles)
   - `supabase/migration_blog_story.sql` (articles de blog + contenu « Notre histoire »)
   - `supabase/migration_demo_reviews_home.sql` (avis démo + curation de l'accueil)
   - `supabase/migration_order_cancel.sql` (statut `cancelled` + motif/date d'annulation)
   - `supabase/migration_rls_blog_demo.sql` (RLS sur `blog_posts` et `demo_reviews`)
   - `supabase/migration_promo_single_use.sql` (codes promo à usage unique réellement appliqués)
   - `supabase/migration_order_returns.sql` (retours par ligne : table `order_returns` + RLS pour le tableau de bord « Ventes & Stock »)
    - `supabase/migration_pending_order_lifecycle.sql` (colonnes de relance des commandes en attente)
    - `supabase/migration_guest_reviews.sql` (avis associés à une commande)
    - `supabase/migration_barcode_scan.sql` (codes-barres des variantes)
    - `supabase/migration_integrity_features.sql` (sécurité, réservations transactionnelles, retours et recherche)
    - `supabase/migration_admin_inventory.sql` (ajustements de stock idempotents avec motif, progression de préparation)
     - `supabase/migration_admin_operations.sql` (contrôle des retours, politique figée par commande, coûts privés et marge estimée)
     - `supabase/migration_return_policy_editor.sql` (réglage futur de 14 à 365 jours, sans modification des données historiques)
3. Récupérez dans **Settings > API** :
   - `Project URL` → `SUPABASE_URL`
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY` (serveur, **jamais** dans le navigateur)
   - La clé `anon` n'est utile à **rien** côté client : aucune page ne parle à Supabase directement (tout passe par les Netlify Functions). Ne l'exposez pas.

## 2. Configurer le client

Rien à configurer dans `public/js/config.js` : `window.HN_CONFIG` ne contient plus que
`API_BASE` (vide par défaut ; les appels passent par `/.netlify/functions/...`).
Les identifiants Supabase vivent uniquement dans les variables d'environnement Netlify (§ 4).

## 3. Créer le compte Stripe

1. Sur https://dashboard.stripe.com, récupérez une clé **test** `sk_test_...`.
2. Déployez le site (ou lancez `netlify dev`) puis créez le webhook :
   - **Stripe > Developers > Webhooks > Add endpoint**
   - URL : `https://VOTRE-DOMAINE/api/stripe-webhook`
    - Événements à écouter : `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` et `charge.refunded`
   - Copiez le **Signing secret** `whsec_...` → `STRIPE_WEBHOOK_SECRET`
3. Testez le paiement avec la carte  `4242 4242 4242 4242`.

## 4. Variables d'environnement Netlify

Copiez `.env.example` en `.env` pour `netlify dev`, et définissez les mêmes variables dans
**Netlify > Site settings > Environment variables** :

| Variable | Description |
| --- | --- |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` (serveur uniquement) |
| `STRIPE_SECRET_KEY` | clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | signing secret du webhook |
| `STRIPE_PRICE_CURRENCY` | devise, ex. `usd` (fallback — la devise est normalement réglée dans `/admin` → Settings, clé `currency`) |
| `SITE_URL` | URL publique du site (sans `/` final), ex. `https://votre-site.netlify.app` |
| `TAX_RATE` | taux de taxe décimal, ex. `0.07` |
| `FREE_SHIPPING_THRESHOLD_CENTS` | seuil livraison gratuite en centimes, ex. `7500` |
| `SHIPPING_STANDARD_CENTS` | frais standard en centimes, ex. `699` |
| `SHIPPING_EXPRESS_CENTS` | frais express en centimes, ex. `1200` |
| `SHIPPING_NEXTDAY_CENTS` | frais J+1 en centimes, ex. `2500` |
| `RESEND_API_KEY` | clé API Resend (optionnel) pour l'email de confirmation de commande |
| `MAIL_FROM` | expéditeur des emails (optionnel), ex. `Hanna & Nour <no-reply@votre-domaine.com>` |
| `CONTACT_EMAIL` | destinataire des messages du formulaire de contact (optionnel, défaut `care@hannanour.com`) |
| `SENDCLOUD_PUBLIC_KEY` | identifiant de l’intégration API Sendcloud dédiée à Mondial Relay, serveur uniquement |
| `SENDCLOUD_SECRET_KEY` | clé secrète de cette intégration, serveur uniquement |
| `ADMIN_PASSWORD` | mot de passe de l'espace admin (`/admin`) — le définir obligatoirement |

## 4ter. Espace administrateur (`/admin`)

Accédez au site sur `/admin`, entrez le mot de passe `ADMIN_PASSWORD`.

- **Produits** : créer/modifier/supprimer, champ par champ (nom 3 langues, prix, catégorie,
  badge, galerie) ; **upload de photos** → stockées dans le bucket Supabase `product-images` ;
  grille **stock par variante** (couleur × taille) — une ligne vide = produit sans stock géré
  (vendu sans limite).
- **Compression des photos admin** : jusqu’à 20 JPG/PNG/WebP de 40 Mo chacun ; les fichiers de 4 Mo ou moins sont envoyés inchangés. Au-delà, le navigateur crée séquentiellement une copie WebP (PNG si cet encodage est indisponible), sans recadrage ni fond ajouté, de 2 560 pixels maximum sur le grand côté. Si nécessaire, qualité et dimensions sont réduites par étapes bornées, sans descendre sous 1 200 pixels sur le grand côté d’une grande image. Les sources à traiter dépassant 50 mégapixels ou 16 000 pixels par côté sont refusées. Les originaux locaux restent intacts ; la galerie indique les copies compressées et chaque échec. Arrêt, fermeture de fiche et déconnexion empêchent le lancement d’un envoi après préparation ; un upload déjà parti peut finir sans réinsérer ses données dans une autre fiche. Aucun réessai réseau automatique.
  La limite serveur reste de 4 Mo, avec contrôle de signature JPEG/PNG/WebP, session admin en en-tête et quota persistant avant Storage. Aucune nouvelle table/politique publique, aucun secret ou fichier envoyé à un tiers pour la compression. Les montants, réservations, stocks, webhooks et emails ne sont pas modifiés. Enregistrer la fiche reste nécessaire pour conserver les nouvelles URL ; l’IA photo demeure facultative et décochée par défaut.
- **Teintes produit** : les noms reconnus utilisent la palette commune admin/site (dont « Gris clair »). Un nom inconnu n’est plus affiché en doré : son aperçu reste hachuré tant qu’aucune teinte n’est définie. « Choisir la teinte exacte » permet d’enregistrer un hexadécimal `#RRGGBB` après confirmation ; cette définition s’applique au même nom normalisé sur toute la boutique, indépendamment de l’enregistrement de la fiche. Les noms de variantes, stocks et historiques restent inchangés. Les teintes sont des aperçus écran, pas une mesure de la couleur du tissu.
  L’action `saveColorSwatch` exige une session admin en en-tête, valide le nom (80 caractères maximum) et la teinte côté serveur, puis applique un quota persistant de 30 appels/10 minutes. Chaque nom est une ligne indépendante `product-color:<nom normalisé>` dans `settings`, table privée avec RLS : un réessai écrase seulement la même teinte, jamais d’autres réglages. `/api/config` et les réglages admin relisent uniquement les noms/hex validés de ce préfixe (plafond de 1 000 définitions ; dépassement signalé par une erreur, pas une palette partielle). Aucun nouveau schéma, paiement, webhook, email ou changement de stock ; les invariants monétaires et de réservation ne sont pas sollicités. Une page déjà ouverte doit être actualisée après modification.
- **Commandes** : liste les commandes payées, marque en *expédiée* (avec n° de suivi) ou *livrée*,
  et imprime **facture / bon de livraison / étiquette colis** (code-barres Code 128, impression
  navigateur → PDF).
- **Paramètres** : frais de livraison (standard/express/J+1/point relais), seuil de livraison
  gratuite et taux de taxe — sans redéployer, inscrits dans la table `settings` (priorité sur les
  variables d'environnement). S'y ajoute la **liste des couleurs du filtre boutique** (clé
  `catalog` dans `settings`) ; le filtre Couleur est actuellement retiré de `/shop` — le champ
  reste disponible dans l'admin en prévision d'une réactivation.
- **Messages** : les messages envoyés via `/contact` (table `contact_messages`, RLS activée) y sont
  listés — lecture, masquage lu/non lu, suppression. Le formulaire les transmet aussi par email
  (best-effort) vers `CONTACT_EMAIL` si `RESEND_API_KEY` est défini.

## 4equiv. Formulaire de contact (`/contact`)

Page `contact.html` + `js/contact.js` : POST vers `/api/contact`
(`netlify/functions/contact.js`), qui valide nom/email/message, enregistre dans
`contact_messages` et tente un email vers `CONTACT_EMAIL`.
Aucune colonne Supabase supplémentaire n'est requise : la table est créée par la migration
(`supabase/migration_variants_admin.sql`).

## 4bis. Emails de confirmation (Resend, optionnel)

Envoie automatiquement un récap de commande à l'acheteur quand le webhook Stripe confirme le paiement.

1. Créez un compte gratuit sur https://resend.com (l'email d'inscription recevra les tests).
2. **API Keys > Create API Key** → copiez la clé `re_...` → variable `RESEND_API_KEY`.
3. Le domaine n'est pas obligatoire pour tester : en **sandbox** (`onboarding@resend.dev`),
   Resend n'envoie qu'à votre propre email d'inscription. Pour un vrai domaine :
   **Domains > Add** → vérifiez les DNS → utilisez `no-reply@votre-domaine.com` dans `MAIL_FROM`.
   Pour **Mot de passe oublié**, si `RESEND_API_KEY` est configurée, le serveur génère un lien de récupération à usage unique via Supabase Auth puis envoie l’email directement avec Resend et `MAIL_FROM`. Il n’utilise pas le SMTP Supabase dans ce cas et ne tente pas un deuxième envoi en cas d’erreur. Sans clé Resend, le SMTP Supabase reste utilisé. Autoriser exactement `SITE_URL/reset.html` dans les redirections Supabase Auth. Les inscriptions restent dépendantes du SMTP Supabase : cette correction ne valide pas leur envoi. Aucun lien, token ou destinataire n’est journalisé ni renvoyé dans la réponse de récupération.
4. En mode test, payez avec la carte `4242 4242 4242 4242` en saisissant **votre email** dans le
   formulaire → vous recevez l'email de confirmation.

## 5. Déployer

```bash
npm install
npm run check
npm test
npm run build
netlify login
netlify deploy
```

> Le dossier publié est `dist/` (`netlify.toml`) : les fichiers de dev ne sont pas servis. Le SQL se lance depuis la console Supabase, jamais automatiquement au build. Toutes les clés restent dans les variables d'environnement Netlify — ne jamais les committer. Ne lancer un déploiement de production qu'après validation du staging et demande explicite.

> La version Node est épinglée par `.nvmrc` (`22`) : elle pilote le build ET le runtime des
> fonctions. Pour forcer le runtime des fonctions différemment du build, définissez `AWS_LAMBDA_JS_RUNTIME`
> (ex. `nodejs22.x`) dans **Netlify > Site settings > Environment variables**.

## Règles métier (à garder cohérentes entre client et serveur)

- Taxe : 7 % (client `js/checkout.js`, `js/cart-page.js` ; serveur `checkout.js`, dépliable via `TAX_RATE`).
- Livraison standard : gratuite ≥ 7500 ¢ sinon 699 ¢ ; express 1200 ¢ ; J+1 2500 ¢.
- Codes promo : gérés dans la table `promo_codes` depuis **/admin → Promos**. Les codes marqués
  **usage unique** (`single_use`) ne sont acceptés qu'une seule fois (l'ordre le premier à le
   réserver l'emporte, RPC `reserve_order`). Le client les charge via `/api/promos`
  (`HN.promoRate`), annonce dans le header réalimentée dynamiquement ; `WELCOME15` reste le seed
  et le fallback hors-ligne.
- Les formules en centimes sont dans `public/js/commerce.js`, partagées avec le serveur. Le checkout exige une confirmation du devis serveur et reconfirme après tout changement de montant ou de devise.
- **Relance panier** : `netlify/functions/relance.js` (fonction **planifiée Netlify**, quotidienne à 08:30 UTC — pas de cron externe). Commande `pending` créée il y a > 2 h et jamais relancée → **1 email** avec lien `cart.html?restore=<token>` qui remet les articles dans le panier ; puis `relance_sent_at` est posé. Nécessite `RESEND_API_KEY` + `SITE_URL`.
- **Analytics maison** (pas de GA4) : le client envoie `pageview`/`product_view`/`add_to_cart`/`checkout_attempt` à `/api/track` (`sendBeacon`), le webhook ajoute `purchase` ; table `analytics_events`, onglet **/admin → Stats** (7 j / 30 j / total, produits et pages les plus vus).

## Mise à niveau : intégrité, staging et nouvelles fonctionnalités

Le runtime est désormais Node 22 (`.nvmrc`). Avant de déployer ce code, appliquer **en staging d’abord** `supabase/migration_integrity_features.sql`, après les migrations existantes, notamment `migration_guest_reviews.sql`, `migration_pending_order_lifecycle.sql` et `migration_barcode_scan.sql`. Cette migration est transactionnelle et rejouable. Elle n'est jamais exécutée automatiquement contre Supabase par le build.

Le lot admin Stock / Préparation nécessite ensuite `supabase/migration_admin_inventory.sql`. Tester d’abord les migrations dans une base locale isolée ; aucune copie transactionnelle de production n’est nécessaire. Avant toute application en production : obtenir un accord explicite, sauvegarder la base, vérifier les prérequis et l’identité de la base ciblée. Vérifier ensuite `commerce_schema_version()` = 1 et `admin_inventory_schema_version()` = 1, ainsi que les droits RLS. Le build effectue seulement des lectures et bloque la publication si ce lot manque ; il n’applique aucune migration. Les captures locales et données de test ne doivent jamais être importées en production.

Les ajustements manuels sont atomiques et identifiés par une UUID d’opération conservée par le navigateur tant que le résultat est incertain. Réessayer le même identifiant ne réapplique pas l’ajustement. Les comptages portent sur le disponible, hors unités réservées ou déjà vendues, et refusent un instantané périmé. Le journal couvre ces ajustements, pas les anciens mouvements ni le stock initial des fiches produit. La préparation conserve des quantités vérifiées par ligne, sans débit de stock, achat d’étiquette, email ou changement du statut d’expédition. Les commandes impayées, archivées, expédiées, avec anomalie de stock ou remboursement sont refusées. Le contrôle « colis prêt » ne remplace pas la prise en charge physique du transporteur.

Le lot Retours / Coûts nécessite `supabase/migration_admin_operations.sql` après ces prérequis. Il reste local tant que sauvegarde, vérification et accord explicite de migration/publication ne sont pas obtenus. Le marqueur `admin_operations_schema_version()` doit valoir 1 ; le build vérifie les trois marqueurs et les tables en lecture seule, sans migration automatique ni seed. Vérifier avant migration les conditions historiquement promises : les commandes sans snapshot reçoivent le maximum de 30 jours et de l’ancien délai configuré ; une ancienne promesse plus favorable doit être identifiée et conservée avant activation. Aucun délai de garantie légale n’est remplacé par cette fenêtre commerciale.

Les demandes distinguent changement d’avis, erreur vendeur et non-conformité. Les deux dernières ne sont pas rejetées automatiquement par la fenêtre commerciale et imposent la prise en charge boutique. L’acceptation exige un motif et fixe qui paie le retour, sans email ni étiquette automatique. La réception exige le contrôle physique et la quantité revendable (zéro possible, retours mixtes possibles). Seules ces unités augmentent le disponible, dans une transaction idempotente ; les autres restent hors vente. Le journal des retours conserve les quantités et le contrôle. Les anciens retours restent identifiés comme contrôle non documenté, sans être rejoués. Un remboursement après expédition n’ajoute pas de stock, même si l’expédition a ensuite été réinitialisée. Un remboursement avant départ conserve la restitution idempotente des unités réellement débitées. Aucun remboursement n’est déclenché par la réception ; le bouton existant de la commande rembourse intégralement via Stripe, pas partiellement par ligne.

La saisie du délai commence à 0, mais l’enregistrement exige 14 à 365 jours pour les futures commandes : zéro n’est ni une politique active ni une suppression du droit légal de rétractation. Le changement d’avis reste payé par le client informé avant achat ou offert par la boutique. La politique figure au devis avant paiement et est conservée sur la commande, sans pouvoir être modifiée ensuite. Un changement de version impose une nouvelle confirmation du devis. Les conditions de retrait et de garantie légaux et les vraies CGV restent à finaliser avec l’utilisateur avant toute vente ; aucune page légale de démonstration n’est convertie en CGV commerciales par cette évolution.

Le réglage à 14 jours nécessite **uniquement la nouvelle migration** `supabase/migration_return_policy_editor.sql`, après les prérequis déjà installés ; ne pas rejouer les anciens lots en production. Cette migration transactionnelle remplace le validateur de la RPC privée, ajoute le marqueur privé `return_policy_editor_schema_version()` = 1 et ne modifie aucune politique enregistrée, commande, quantité ou montant. Le build exige désormais ce quatrième marqueur en lecture seule. Accord explicite, sauvegarde récupérable et vérification de cible restent obligatoires avant migration/publication. La politique actuelle n’est jamais automatiquement remise à 0, 14 ou 30 jours.

Le champ admin en lecture seule, le pied de page et les métadonnées produit affichent le délai de la même politique serveur, pas l’ancien réglage de livraison. Avant chargement, les textes statiques restent neutres au lieu de promettre 30 jours. Le site relit la configuration au retour sur l’onglet et reçoit une notification locale lorsqu’une politique est enregistrée dans un autre onglet du même navigateur ; pas de polling ni de connexion publique à la base. Un autre navigateur relit les conditions au chargement/retour sur la page ; le devis serveur reste l’autorité avant paiement. Les snapshots historiques et les promesses déjà faites ne sont pas raccourcis. Invariants vérifiés : règle commune et lecture serveur, protection des droits/promesses et de la reconfirmation du devis, RPC/table privées avec RLS, session en en-tête, quota persistant et verrou/version concurrente. Aucun paiement, stock, webhook ou email supplémentaire.

Les coûts d’achat par variante, leur journal et les snapshots de commande résident dans trois tables privées avec RLS sans politique publique. Un coût vide est inconnu, zéro doit être saisi explicitement. Chaque nouvelle ligne fige le coût disponible dans sa devise, sans conversion et sans recalcul des anciennes ventes. Les modifications de coût sont justifiées et contrôlées contre une modification concurrente. La marge affichée est une estimation articles après remise et retours physiques, moins les achats des unités non remises en stock : hors emballage, transport, commissions, charges et impôts. Les coûts absents, retours historiques sans contrôle et commandes avec remboursement monétaire donnent une marge inconnue, avec sous-total calculable explicitement partiel. Ce n’est ni un bénéfice net ni une comptabilité. Les montants encaissés et les remboursements confirmés sont distincts de la valeur des retours physiques ; les devises ne sont jamais additionnées. Le rapport groupe les commandes par date de paiement et rattache leurs retours/remboursements connus à ce jour à la même cohorte, pas à la date d’opération bancaire. Les plafonds de lecture (20 000 commandes, 10 000 produits, 1 000 coûts actuels, 200 demandes de retour) sont signalés lorsqu’ils sont atteints.

L’ancienne caisse `scanSale` et les resets globaux `resetAll`/`resetStock` sont suspendus côté serveur et interface : la caisse historique ne garantissait pas une transaction complète, les resets contournent le journal ou suppriment l’historique. Utiliser le parcours Stock justifié, l’archivage et les commandes du checkout. Ne pas les réactiver avant leur remplacement transactionnel et des tests de concurrence et de réessai. Aucun remboursement Stripe, affranchissement ou email de commerce réel ne fait partie des validations locales.

Invariants vérifiés pour ces lots : règles et politique relues côté serveur puis affichées au client ; quantités non fiables revalidées ; remises entières et montant Stripe conservés par les tests existants ; RLS, lectures, écritures et RPC privées des nouveaux journaux/coûts ; réception transactionnelle et réessais idempotents ; ordre cohérent des verrous ; sessions en en-tête ; limites persistantes avant les modules admin. Les nouveaux formulaires n’ont aucun effet externe à revendiquer (email, paiement, étiquette). Les webhooks de paiement ne sont pas modifiés par ce lot et restent couverts par leurs tests de réconciliation.

Avant application, rechercher les doublons de `orders.order_number` et de `reviews(order_id, product_id)` pour les lignes liées à une commande. Les nouveaux index uniques feront échouer la migration plutôt que supprimer des données. Corriger les doublons manuellement, sans effacer des commandes payées.

### Staging isolé

1. Créer un second projet Supabase et y exécuter le schéma et les migrations. Utiliser seulement des données de test, pas les données personnelles de production.
2. Créer un site Netlify de staging, ou configurer des variables **spécifiques aux contextes** `deploy-preview` / `branch-deploy`. Ne pas hériter des clés de production : URL et service role Supabase staging, clé Stripe `sk_test_…`, secret webhook test distinct, `ADMIN_PASSWORD` distinct, expéditeur de test Resend.
3. Définir `STAGING_MODE=true`, `EXPECTED_STAGING_SUPABASE_URL` sur l’URL exacte du projet staging et `PRODUCTION_SUPABASE_URL` sur celle de la production (URL publique, sans secret). Le build et les fonctions exigent que ces deux bases diffèrent. Pour un second site Netlify dont le contexte est `production`, ces trois variables doivent aussi être configurées ; ne jamais y copier la clé Supabase de production.
4. Définir `SITE_URL` sur l’URL du staging. En preview, les liens utilisent `DEPLOY_PRIME_URL`. Configurer les redirections autorisées Supabase Auth pour `/account.html` et `/reset.html` sur chaque domaine de test.
5. Dans Supabase Auth, activer **Confirm email** et configurer un expéditeur SMTP fonctionnel. L’inscription attend la confirmation ; les anciens comptes auto-confirmés ne récupèrent plus les commandes invitées sans le code email envoyé via Resend.
6. Configurer le webhook Stripe test : événements checkout déjà documentés **plus `charge.refunded`**. Les stocks sont réservés à la création de la session (30 minutes), libérés sur expiration/échec, puis confirmés atomiquement après vérification du montant et de la devise. Une tâche de récupération traite les sessions expirées dont le webhook a été manqué.

### Build et validations

Lors d'une publication Netlify, le build vérifie en lecture seule la version du schéma Supabase et les colonnes utilisées. Si la migration manque ou si les identifiants serveur ne sont pas disponibles pour le build, la nouvelle publication échoue et la version précédente reste en ligne. Ne pas supprimer cette vérification pour contourner une migration manquante. Pour mettre à jour le site existant, appliquer uniquement les migrations requises sur sa base, jamais les seeds ou la migration de catalogue de démonstration.

`npm ci`, `npm run check`, `npm test`, puis `npm run build`. Publication : **`dist/`**, et non `public/`. Le build génère des pages `/fr/…`, `/en/…`, `/ar/…`, leurs hreflang, le sitemap public, des assets à empreinte avec cache immutable et des images WebP/JPEG optimisées. `public/` reste le code source et l’aperçu statique. Ne plus déployer `public/` par glisser-déposer : cela contournerait le build et les fonctions.

Les tests Node natifs couvrent les formules et allocations exactes en centimes ; PGlite exécute réellement les migrations PostgreSQL, sans connexion à une base externe. Aucun test ne débite Stripe ni ne contacte l’IA. Les paiements Stripe, SMTP, uploads Supabase et le rendu mobile doivent encore être testés sur le staging configuré.

### Usage des nouvelles fonctions

- **Compte client** : code email à usage unique pour retrouver les commandes invitées ; demandes de retour après livraison dans le délai configuré, motif et photo facultative de 2 Mo. Les photos sont dans le bucket **privé** `return-evidence`, créé par le serveur. Seul l'admin reçoit un lien signé de cinq minutes.
- **Admin → Retours clients** : accepter/refuser, puis confirmer la réception physique pour remettre en stock. Cela ne rembourse pas automatiquement Stripe. Le remboursement complet reste dans la commande ; un remboursement partiel doit être traité dans Stripe puis rapproché. Les deux montants ne doivent pas être confondus.
- **Suivi** : choisir le transporteur et saisir le numéro lors de l’expédition ; le client voit les jalons enregistrés et le lien Colissimo, Chronopost, Mondial Relay ou DHL. Aucun abonnement API transporteur ni synchronisation automatique de leurs événements n’est configuré.
- **Fiche produit** : nouvelles catégories pull/maille, veste, jupe, haut, pantalon ; coupe et mesures en trois langues, transparence vérifiée et lien vidéo HTTPS.
- **Description photo** : définir `GEMINI_API_KEY`, `OPENAI_API_KEY` **ou** `OPENROUTER_API_KEY` côté serveur, dans les variables Netlify disponibles pour **Functions**, contexte **Production** pour le site publié. Gemini est prioritaire si sa clé est renseignée ; `GEMINI_MODEL` est facultatif (défaut `gemini-3.5-flash-lite`). Le modèle dispose d'un Free Tier, mais le projet Google doit rester sur l'offre gratuite pour éviter des frais. Pour OpenAI/OpenRouter, `PRODUCT_VISION_MODEL` est facultatif (défaut vision `gpt-4o-mini` / `openai/gpt-4o-mini`). Redéployer après une modification des variables. L’upload propose automatiquement un brouillon si la case est cochée ; le bouton permet aussi de relancer l’analyse. La photo est transmise au fournisseur IA ; le débit admin est limité, mais les coûts et quotas du fournisseur restent à surveiller. Gemini reçoit uniquement les octets d’une image du site ou du bucket public `product-images` (JPG/PNG/WebP, 4 Mo maximum, sans suivre de redirection). Les erreurs HTTP 500/502/503/504 sont reprises au maximum deux fois, dans un délai total de 20 secondes incluant le téléchargement, sans changement de modèle ni de fournisseur. Un Retry-After trop long ou un délai restant insuffisant arrête les reprises ; les erreurs de clé, de facturation et de quota ne sont pas reprises. Les tentatives peuvent consommer du quota et, sur un projet payant, générer des frais. Le diagnostic indique le modèle réellement utilisé et le nombre de tentatives sans révéler la clé ni le corps de réponse Google. Les clés ne sont jamais saisies dans la fiche admin, transmises au navigateur, stockées dans Supabase ou incluses dans Git. La proposition ne modifie ni les prix, ni les stocks, ni la composition/entretien et exige une validation avant enregistrement/publication. Ce réglage ne change pas le fournisseur du chatbot public.
- **Recherche** : index GIN trilingue, requête serveur, filtres et pagination bornée (48 produits au maximum par requête). Le détail produit est chargé par slug, sans dépendre de la première page du catalogue.

### Export XLSX TikTok Shop France

Dans **Admin → Export TikTok** :

1. Télécharger dans Seller Center le modèle officiel de **création** de la catégorie concernée, en unités métriques, puis le sélectionner dans l’admin. Le classeur `.xlsx` reste dans le navigateur : il n’est pas transmis à Netlify ni stocké sur le site. Limites : 20 Mo pour le fichier, 50 Mo décompressés, 1 000 entrées ZIP. Un navigateur récent avec CompressionStream/DecompressionStream `deflate-raw` est requis.
2. Choisir chaque produit déjà enregistré et compléter les champs du modèle. Les obligations spécifiques de la feuille cachée `HiddenStyle` prennent priorité sur les mentions génériques « obligatoire conditionnel » : poids **colis emballé en g**, dimensions **en cm**, fabricant, personne responsable, informations de sécurité, et tout autre attribut obligatoire. Les listes TikTok sont reprises sans inventer de fabricant, certification, composition ou code EAN. Enregistrer ces informations avec le bouton dédié ; cela ne modifie pas la fiche publique ni les stocks. Elles résident dans `settings` sous `tiktok:<product_id>`, une table déjà protégée par RLS sans accès public. Aucune nouvelle migration SQL n’est nécessaire ; les migrations existantes restent requises.
3. Sélectionner au maximum 100 produits de la catégorie exacte du modèle, puis télécharger le XLSX rempli (maximum 4 994 variantes). L’API relit les prix, les variantes et le stock en base. Aucune quantité/prix fournie par le navigateur ne remplace ces données. Les produits sans stock géré sont refusés ; seules les variantes actives sont exportées. Les variantes épuisées restent présentes avec quantité 0 ; un produit archivé est exporté avec quantité 0. Le code interne HN est utilisé comme UGS vendeur, jamais comme GTIN. Le modèle T-shirts vérifié rend le GTIN facultatif ; ne pas généraliser cette exemption aux autres catégories.
4. La devise du site doit déjà être **EUR** : l’export refuse USD plutôt que d’inventer un taux de change. Le prix est le prix TTC **unitaire**, calculé en centimes avec les mêmes règles et réglages de taxe que le checkout, sans port ni promotion. Le taux configuré n’est pas validé fiscalement par cet outil : vérifier sa conformité au régime de l’entreprise. L’arrondi de taxe d’un panier de plusieurs unités peut différer de la somme des prix TTC unitaires.
5. Vérifier les images et les justificatifs avant l’import manuel dans Seller Center. Les URL d’images sont normalisées en HTTPS JPG/PNG ; une URL publique ne prouve pas le respect de toutes les règles visuelles. Le modèle fourni comporte des consignes de résolution contradictoires entre ses feuilles ; privilégier des photos carrées de **600–1 200 px**, de moins de **5 Mo**, nettes et sur fond blanc, puis vérifier les règles courantes dans Seller Center. Le site ne contrôle pas automatiquement les pixels, les droits sur les photos, le fond ni la conformité des étiquettes. TikTok reste responsable de l’acceptation et peut demander d’autres preuves. Le classeur contient des listes de fabricants propres au vendeur : ne pas le publier dans Git.

Le générateur conserve le contenu de tous les autres composants ZIP du modèle (13 onglets dans le fichier T-shirts fourni), ainsi que les en-têtes, styles et validations de la feuille `Template`. Seules ses lignes de données à partir de la ligne 7 sont remplacées. Les textes sont écrits en cellules texte, pas en formules. Macros, liens externes de classeur, DTD XML, archives chiffrées/corrompues, catégories non reconnues, champs obligatoires manquants et valeurs interdites sont refusés. Le contrôle ne remplace pas la validation serveur TikTok.

**Ce n’est pas une synchronisation.** Ce modèle sert à créer des produits ; réimporter un fichier de création n’est pas une méthode fiable pour mettre à jour les annonces existantes. Une quantité 0 n’a aucun effet tant que TikTok n’a pas accepté l’opération appropriée. Pour les stocks déjà publiés, utiliser le modèle de modification du Seller Center ou une intégration API distincte. Un export ne réserve aucune pièce et ne protège pas contre les ventes concurrentes du même stock sur deux canaux ; séparer les quantités allouées ou synchroniser via API avant de partager un stock critique.

Les actions `getTiktokMetadata`, `saveTiktokMetadata` et `exportTiktokProducts` exigent une session admin en en-tête et une limite persistante (60 appels/heure). Aucune donnée client/commande et aucun secret TikTok ne sont inclus. Invariants vérifiés : règles de prix communes, lecture serveur des montants/stocks, RLS des réglages, session admin et débit limité. Aucun paiement, webhook, décrément de stock ou effet externe n’est ajouté : les règles de reprise/idempotence et de réservation ne sont pas sollicitées. `@xmldom/xmldom` est une dépendance de **test** uniquement ; la génération dans le navigateur n’ajoute aucune dépendance de production.

### Diagnostic Sendcloud / Mondial Relay, sans achat

L’intégration utilise **l’API v3**, depuis le serveur uniquement. Dans Sendcloud → Integrations, créer une intégration API dédiée à Hanna & Nour, activer **Service Point delivery** et cocher uniquement **Mondial Relay**. Conserver les clés dans un gestionnaire de mots de passe, puis renseigner `SENDCLOUD_PUBLIC_KEY` et `SENDCLOUD_SECRET_KEY` dans les variables Netlify disponibles pour **Functions**, contexte **Production**. Même la clé appelée « Public Key » n’est pas transmise au navigateur. Ne pas activer le webhook tant que sa réception n’est pas développée.

Après publication explicitement autorisée et redéploiement des variables, **Admin → Paramètres → Mondial Relay — connexion Sendcloud** permet :

- **Tester la connexion sans achat** : vérifier l’authentification, les réglages de l’intégration, la présence de contrats Mondial Relay actifs et d’adresses expéditeur en France métropolitaine. Les adresses privées, numéros d’entreprise, identifiants du contrat, URL webhook et clés ne sont ni affichés ni journalisés. Les listes de contrats/adresses sont limitées au premier lot de 100 ; un résultat partiel est signalé, jamais interprété comme une preuve d’absence.
- **Tester la recherche de relais** : code postal métropolitain, rayon de 15 km, au maximum 20 résultats frais, filtrés côté serveur sur Mondial Relay et France métropolitaine. Une fiche de relais fraîche ne garantit pas sa disponibilité pour un colis précis ; celle-ci devra être validée lors du futur checkout.

Les actions `sendcloudDiagnostics` et `searchSendcloudServicePoints` exigent la session admin en en-tête, avec un débit persistant partagé de **30 appels / 10 minutes**. Les requêtes Sendcloud sont exclusivement des **GET**, sur une liste fermée d’URL officielles v3, sans redirection ni reprise automatique, bornées à cinq secondes par appel et 512 Kio par réponse. Les erreurs retournées sont prédéfinies : aucune réponse brute du fournisseur ou exception réseau contenant des secrets n’est exposée. Une erreur sur un contrôle secondaire est affichée séparément, sans invalider une authentification réussie.

**Ce n’est pas encore l’automatisation des livraisons.** Aucun achat d’étiquette, import de commande, paiement, webhook, email ou changement de stock/statut n’est ajouté. Le sélecteur client, la revalidation du relais, la création officielle d’affranchissement et le suivi automatique restent à développer après validation des accès et des conditions. Colissimo reste séparé. Aucun test réel Sendcloud n’est exécuté pendant le développement : les tests utilisent des réponses simulées. Le diagnostic ne prouve pas l’absence d’abonnement ni les tarifs/quota contractuels.

Invariants vérifiés pour cette étape : clés côté serveur, session admin en en-tête, débit persistant et validation serveur des recherches. Aucun nouveau stockage/table/RPC métier n’est nécessaire : pas de migration ni de seed. Les montants, remises, taxes, réservations et stocks restent inchangés ; les invariants de paiement, webhook, claim d’email et concurrence métier ne sont pas sollicités par ces lectures.

### Données historiques et limites

Les anciennes commandes payées n’ont pas de preuve fiable de débit de stock. La migration ne fabrique pas cette preuve : leur `order_items.stock_debited` reste faux. Réconcilier leur stock manuellement avant de tester un ancien remboursement. Les commandes nouvelles disposent du journal de débit ; retours et remboursements ne réapprovisionnent que les quantités réellement débitées.

Les brouillons impayés de 72 h sont désormais **archivés de la liste admin**, pas détruits, afin de pouvoir réconcilier un événement Stripe tardif. Une anomalie de stock après paiement est conservée comme commande payée avec alerte `stock_issue`, jamais masquée comme paiement échoué. Ne pas expédier ces commandes sans vérification.

Une réponse Stripe perdue conserve la réservation. La tâche de récupération recherche la session par référence de commande (recherche bornée à 1 000 sessions) ; sans correspondance, une réconciliation manuelle est nécessaire. Ne jamais libérer cette réservation sans vérifier Stripe. Les remboursements Stripe livrés avant l'événement de paiement sont rapprochés via les métadonnées du PaymentIntent.

Les produits et commandes supprimés depuis l'admin sont archivés pour préserver l'historique. Les quantités déjà expédiées/livrées ou marquées défectueuses ne sont pas réapprovisionnées sur le seul remboursement financier ; confirmer le retour physique avant remboursement ou réconcilier manuellement. Le montant des retours enregistrés est une suggestion nette des articles, hors taxe et port, pas une preuve de remboursement Stripe.

Le référencement des produits conserve des métadonnées et données structurées calculées côté navigateur. Le sitemap de build contient les pages publiques statiques, pas encore chaque slug du catalogue. Un pré-rendu ou rendu serveur des fiches devra compléter le SEO si une indexation exhaustive sans JavaScript est requise.

Invariants vérifiés : règles communes client/serveur, prix serveur et devis confirmé, allocations exactes, RLS et droits RPC fermés, webhook idempotent, compteurs transactionnels, claim avant email, jetons en en-tête, limites persistantes. Aucun déploiement, secret ou modification de base distante n’est inclus dans cette mise à niveau.

```bash
netlify dev          # site + fonctions en local (port 8888)
```
