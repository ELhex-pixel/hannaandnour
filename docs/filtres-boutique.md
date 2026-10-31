# Filtres de boutique selon le catalogue

Les catégories sans produit actif sont masquées. Les groupes Catégorie, Taille et Occasion n’apparaissent que s’ils proposent au moins deux valeurs, ou si une valeur est déjà sélectionnée et doit pouvoir être retirée. Le prix apparaît lorsqu’il existe plusieurs prix distincts, ou lorsqu’une borne a été saisie.

`GET /api/products?facets=true` lit uniquement `id,category,sizes,occasions,price_cents` des produits actifs non supprimés du catalogue, dans l’ordre des IDs, par lots de 500 avec un total exact. La lecture complète est bornée à 2 000 produits et utilise les reprises bornées de lecture publique. Panne, données invalides, catalogue trop volumineux ou lecture partielle restent des erreurs, jamais une fausse liste vide.

Les filtres décrivent le catalogue complet, pas seulement les huit produits de la page affichée. Les filtres ne disparaissent pas en fonction d’une combinaison momentanément sans résultat. Les critères explicites provenant de l’URL restent visibles/supprimables même si leur valeur n’existe plus. Aucune catégorie, taille, variante, quantité ni fiche produit n’est modifiée.

Les groupes sont masqués dans le HTML initial pour éviter l’affichage des 24 catégories en attendant les données. Les mêmes groupes sont utilisés dans la barre latérale et le dialogue mobile ; les options masquées n’entrent pas dans la navigation clavier. Le bouton mobile est masqué lorsqu’aucun groupe n’est utile. Une panne des facettes n’invente pas d’options à partir d’une page partielle et n’empêche pas la liste des produits de fonctionner.

Cette évolution ne demande pas de migration SQL. La fonction SQL historique `catalog_facets()` est conservée pour compatibilité ; l’API publique calcule les facettes complètes avec leurs catégories et bornes de prix côté serveur.
