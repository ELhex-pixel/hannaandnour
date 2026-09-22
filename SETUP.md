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
3. Récupérez dans **Settings > API** :
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → à mettre dans `js/config.js` (client)
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY` (serveur, **jamais** dans le navigateur)

## 2. Configurer le client

Éditez `js/config.js` :

```js
window.HN_CONFIG = {
  API_BASE: '',               // vide : appels via /.netlify/functions/...
  SUPABASE_URL: 'https://xxxx.supabase.co',
  SUPABASE_ANON_KEY: 'xxxx-anon-public-key'
};
```

## 3. Créer le compte Stripe

1. Sur https://dashboard.stripe.com, récupérez une clé **test** `sk_test_...`.
2. Déployez le site (ou lancez `netlify dev`) puis créez le webhook :
   - **Stripe > Developers > Webhooks > Add endpoint**
   - URL : `https://VOTRE-DOMAINE/api/stripe-webhook`
   - Événements à écouter : `checkout.session.completed` et `checkout.session.expired`
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
| `STRIPE_PRICE_CURRENCY` | devise, ex. `usd` |
| `SITE_URL` | URL publique du site (sans `/` final), ex. `https://votre-site.netlify.app` |
| `TAX_RATE` | taux de taxe décimal, ex. `0.07` |
| `FREE_SHIPPING_THRESHOLD_CENTS` | seuil livraison gratuite en centimes, ex. `7500` |
| `SHIPPING_STANDARD_CENTS` | frais standard en centimes, ex. `699` |
| `SHIPPING_EXPRESS_CENTS` | frais express en centimes, ex. `1200` |
| `SHIPPING_NEXTDAY_CENTS` | frais J+1 en centimes, ex. `2500` |
| `RESEND_API_KEY` | clé API Resend (optionnel) pour l'email de confirmation de commande |
| `MAIL_FROM` | expéditeur des emails (optionnel), ex. `Hanna & Nour <no-reply@votre-domaine.com>` |
| `CONTACT_EMAIL` | destinataire des messages du formulaire de contact (optionnel, défaut `care@hannaandnour.com`) |
| `ADMIN_PASSWORD` | mot de passe de l'espace admin (`/admin`) — le définir obligatoirement |

## 4ter. Espace administrateur (`/admin`)

Accédez au site sur `/admin`, entrez le mot de passe `ADMIN_PASSWORD`.

- **Produits** : créer/modifier/supprimer, champ par champ (nom 3 langues, prix, catégorie,
  badge, galerie) ; **upload de photos** → stockées dans le bucket Supabase `product-images` ;
  grille **stock par variante** (couleur × taille) — une ligne vide = produit sans stock géré
  (vendu sans limite).
- **Commandes** : liste les commandes payées, marque en *expédiée* (avec n° de suivi) ou *livrée*,
  et imprime **facture / bon de livraison / étiquette colis** (code-barres Code 128, impression
  navigateur → PDF).
- **Paramètres** : frais de livraison (standard/express/J+1/point relais), seuil de livraison
  gratuite et taux de taxe — sans redéployer, inscrits dans la table `settings` (priorité sur les
  variables d'environnement).
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
4. En mode test, payez avec la carte `4242 4242 4242 4242` en saisissant **votre email** dans le
   formulaire → vous recevez l'email de confirmation.

## 5. Déployer

```bash
npm install
netlify login
netlify deploy --prod
```

## Règles métier (à garder cohérentes entre client et serveur)

- Taxe : 7 % (client `js/checkout.js`, `js/cart-page.js` ; serveur `checkout.js`, dépliable via `TAX_RATE`).
- Livraison standard : gratuite ≥ 7500 ¢ sinon 699 ¢ ; express 1200 ¢ ; J+1 2500 ¢.
- Code promo : `WELCOME15` → −15 % (table `promo_codes`, client `PROMO_LOCAL` en fallback visuel).
- Tout changement de prix/taxe/frais doit être répercuté dans le JS client **et** les fonctions Netlify, sinon le total affiché ≠ total facturé.

## Commandes de dev

```bash
netlify dev          # site + fonctions en local (port 8888)
```