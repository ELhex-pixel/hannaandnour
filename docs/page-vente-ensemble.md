# Page de vente moderne — ensemble col rond et pantalon large

Lien à utiliser dans les publications :

https://hannanour.com/fr/products/ensemble-col-rond-pantalon-large.html

## Présentation

- La même fiche produit et la même URL deviennent une page de vente éditoriale : grande photo entière, prix, coloris nommés avec disponibilité, taille et quantité regroupées, boutons d’achat, détails, questions fréquentes et retour aux options.
- Le thème crème/doré et son mode sombre sont conservés. Les versions anglaise et arabe utilisent la même fiche, avec leurs textes et leur direction de lecture.
- `product-landing.css` est limité à la classe `product-landing`, activée uniquement pour le slug de cet ensemble. Le pré-rendu lui applique cette classe sans figer de prix ni de stock.
- `product-landing.js` présente les données et rend les miniatures utilisables au clavier. Les boutons de fin de page ramènent aux vrais choix ; ils n’ajoutent aucun article et ne lancent aucun paiement.

## Données et achat

Le contrôleur `product.js` conserve les achats et les lectures fraîches : prix, configuration, variantes et quantités avant ajout, actualisation visible toutes les quinze secondes, maintien du choix et blocage en cas de panne. Le module éditorial reçoit uniquement les réponses validées de ces lectures ; il n’ajoute ni appel réseau ni cache.

Les deux grandes vues suivent les associations de galerie enregistrées pour le coloris choisi. Aucune association, photo, teinte, référence, variante ou quantité du catalogue n’est modifiée. Un coloris épuisé reste inspectable ; le message signale un autre coloris disponible sans le sélectionner à la place du client.

Les caractéristiques, conseils de taille, matière, entretien et mesures viennent de la fiche admin et s’affichent seulement lorsqu’ils sont renseignés. Les questions sur les retours reprennent la politique reçue ; en cas de lecture indisponible, le texte renvoie aux conditions plutôt que conserver un délai non confirmé. La promotion surprise reste révélée par le panier et le paiement existants.

Les avis sont toujours gérés par le parcours et les réglages existants. Une note de zéro avis n’est pas mise en avant dans le bloc d’achat ; le module suit les résultats d’avis chargés sans inventer de note ou de témoignage.

## Vérifications

- Rendu factuel, contenu échappé, galerie par coloris, disponibilité inconnue distincte d’un épuisement et pré-rendu ciblé.
- Navigateur avec données publiques copiées en fixtures locales : 320/390/768/1440 px, FR/EN/AR, clair/sombre, boutons/miniatures, photos, ajout double-clic, limites panier, prix actualisé, sélection et FAQ préservées, panne bloquante.
- Aucun achat, paiement, modification de stock ou sauvegarde de catalogue réel pendant les essais. Aucune migration requise.
