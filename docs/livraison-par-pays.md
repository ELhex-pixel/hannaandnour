# Livraison par pays — domicile payant et gratuité relais

## Choix du propriétaire

- Sept destinations configurables : France métropolitaine, Belgique, Pays-Bas, Allemagne, Espagne, Italie et Algérie.
- Tarifs fixes par pays et mode : standard domicile, relais/locker, express et J+1.
- Domicile toujours payant, y compris au-dessus du seuil. Chaque mode coché exige un tarif strictement positif.
- Relais et lockers Mondial Relay regroupés, avec les mêmes règles dans chaque pays.
- Gratuité relais préconfigurée à 80 € **avant réduction**, hors transport, pour les six destinations européennes ; case et seuil modifiables par pays.
- Le propriétaire renseigne les nouveaux tarifs avant activation. Aucun prix client n’est importé du CSV Sendcloud, qui porte sur des services et tranches de poids particuliers.
- L’Algérie ne propose pas de relais Mondial Relay dans ce parcours. Les modes à domicile peuvent y être configurés.

## Activation

1. Le propriétaire exécute et confirme `supabase/migration_shipping_country_rules.sql` dans Supabase. La migration étend la validation des snapshots relais à DE/IT et conserve leur immutabilité. Elle ne modifie aucune commande, aucun stock ni aucun montant historique.
2. Le build vérifie en lecture seule `shipping_country_rules_schema_version() = 1` avant publication.
3. Dans **Admin → Paramètres → Livraison par pays**, charger les réglages, renseigner et cocher les pays/modes souhaités, puis utiliser le bouton d’enregistrement dédié.

Sans règle enregistrée, le site prépare les quatre destinations déjà utilisées (FR/BE/NL/ES) avec les tarifs actuels de `settings.shipping`. Le standard reste payant et la gratuité passe sur le relais à 80 €. DE/IT/DZ restent désactivés et sans nouveaux prix jusqu’au choix du propriétaire.

Cocher un mode ne crée pas un service transporteur. Les points relais et leur disponibilité réelle sont vérifiés auprès de Sendcloud ; la présence d’un pays dans le CSV ne garantit pas un point disponible pour chaque adresse.

## Réglages et sauvegardes

La clé `settings.shipping_rules` contient une version 1, une révision et les sept pays. Chaque pays a sa case d’activation et les quatre modes, chacun avec case et tarif en centimes. Le relais porte aussi `free_enabled` et `free_threshold_cents`.

`getShippingRules` / `saveShippingRules` exigent session admin et quota. Une comparaison atomique de révision protège contre un onglet périmé. L’opération UUID et son contenu sont conservés dans `hn-admin-shipping-rules-operation` avant envoi ; une réponse perdue reprend la même opération, y compris après rechargement. Les réponses après déconnexion sont ignorées. Une sauvegarde ne change ni taxe, ni devise, ni retours, ni stock, ni commande.

Les anciens réglages généraux conservent taxe et devise. Les tarifs par pays utilisent leur propre clé et leur propre bouton, afin qu’un ancien formulaire ne les écrase pas.

## Panier, paiement et intégrité

Le panier propose un pays et un mode disponibles, repris au paiement. Un choix retiré ne sélectionne pas silencieusement une autre option. Aucun tarif vide ne devient zéro. Les montants du panier sont des estimations, revérifiées au paiement.

Le serveur relit règles, produits, remise, devise et politique de retour pour chaque devis/paiement. Il calcule le tarif du pays/mode et ignore les frais forgés du navigateur. Une modification du prix impose la confirmation du nouveau devis. Le seuil utilise le sous-total des articles avant remise ; taxe et total conservent la formule commerciale partagée.

Le pays du sélecteur relais est fixé par la destination du checkout. Les détails Sendcloud et la disponibilité sont vérifiés avant toute création de commande ou session Stripe. Un point d’un autre pays est refusé. Changer de pays invalide le relais précédent et exige une nouvelle sélection explicite. Seuls les points Mondial Relay non expirés sont admis.

Les codes postaux FR/BE/NL/DE/ES/IT sont contrôlés ; le domicile France est limité à la métropole et DZ utilise un code à cinq chiffres. Le checkout rafraîchit sa configuration lorsqu’il est visible et au retour dans la page. Il garde les choix encore valables, bloque en cas de panne et ne rafraîchit pas un paiement en cours.

Les anciennes commandes gardent leurs frais et snapshots. Les étiquettes restent le parcours privé séparé : colis réel, devis frais, confirmation et journal idempotent. Les tarifs clients sont distincts des prix d’achat des étiquettes. Express/J+1 à domicile gardent leur gestion d’expédition existante ; la case commerciale ne garantit pas un délai transporteur non confirmé.

## Messages et validation

FR/EN/AR : la mention de gratuité précise relais/lockers, seuil avant remise et pays éligibles. Sans offre confirmée, un texte neutre est utilisé. Le chatbot renvoie vers le panier pour les tarifs à jour.

Tests : matrice pays/modes/seuils, remises avant seuil, prix vides/nuls/forgés, pays décochés, quotas/admin, comparaison de révision et réponse perdue, migration DE/IT rejouable. Vérifications navigateur locales : réglages, panier et checkout à 320/390/1440 pixels, clair/sombre, FR/EN/AR, changement de pays, absence de présélection du relais et panne. Aucun affranchissement ni paiement réel utilisé pour tester.
