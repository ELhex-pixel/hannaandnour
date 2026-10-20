# Journal Hanna & Nour — refonte et propositions clients

## Contenu préparé

Six articles originaux remplacent les six anciens articles de démonstration, à la demande du propriétaire :

1. Une garde-robe capsule qui vous ressemble vraiment.
2. L’art des superpositions : du relief, sans compliquer la tenue.
3. Bien choisir une coupe : les détails qui changent le confort.
4. Associer les couleurs sans suivre de règles rigides.
5. Laver, sécher, ranger : les réflexes d’une garde-robe soignée.
6. Du quotidien à une occasion : faire évoluer une tenue en trois gestes.

Les textes sont disponibles en français, anglais et arabe dans `content/journal-editorial.js`. Les URL historiques sont conservées pour les anciens liens ; titre, extrait, texte, catégorie, auteur éditorial et illustration sont actualisés. Les autres articles et les propositions clients ne sont pas remplacés par cette opération. Les anciennes lignes sont sauvegardées dans une table privée avant la première actualisation.

L’interface propose une grande introduction, des cartes avec photos locales, une recherche, des filtres par thème et un sommaire sur les articles. Le texte reste du texte simple : un paragraphe commençant par `##` devient un intertitre, jamais du HTML exécutable.

## Photos choisies

Les photos ont été téléchargées depuis Unsplash, contrôlées visuellement et converties en WebP local, jusqu’à 1400 px de large. Les pages ne chargent pas directement Unsplash et n’exigent pas de clé externe. Ce sont des illustrations éditoriales, pas des photos présentées comme des produits propres à la boutique.

| Fichier local | Source de la photographie |
|---|---|
| `journal-capsule.webp` | https://images.unsplash.com/photo-1441986300917-64674bd600d8 |
| `journal-superpositions.webp` | https://images.unsplash.com/photo-1490481651871-ab68de25d43d |
| `journal-confort.webp` | https://images.unsplash.com/photo-1512436991641-6745cdb1723f |
| `journal-couleurs.webp` | https://images.unsplash.com/photo-1445205170230-053b83016050 |
| `journal-entretien.webp` | https://images.unsplash.com/photo-1489987707025-afc232f7ea0f |
| `journal-occasions.webp` | https://images.unsplash.com/photo-1483985988355-763728e1935b |

Référence de la licence source : https://unsplash.com/license. Les images et leurs associations restent modifiables depuis les outils d’article de l’administration.

## Proposer un article en tant que client

Sur la page Blog, la rubrique **Proposer un article** s’ouvre après connexion avec le compte client existant. Le formulaire demande un nom public, un titre, un thème, une illustration parmi les photos du journal et le texte original (300 à 20 000 caractères).

L’envoi reste en attente et privé. Le client consulte ses vingt dernières propositions, leur état et le motif transmis si l’article n’est pas retenu. Il n’a aucun accès aux propositions d’autres comptes. Les appels sont authentifiés et limités ; cinq propositions peuvent être en attente par compte.

Une réponse perdue conserve le même identifiant et le même texte sous une clé locale propre au compte (`hn-journal-submission-<UUID compte>`). Réessayer n’ajoute pas de doublon. La déconnexion efface immédiatement les champs et la liste de l’interface ; le compte retrouve uniquement sa propre demande à la reconnexion. Le token reste géré par l’authentification existante, jamais dans l’URL.

## Relire et publier depuis l’admin

Dans **Blog → Articles proposés par les clients** :

1. Choisir **À relire** et ouvrir une proposition.
2. Vérifier le nom public, le titre, le texte, le thème et la photo.
3. Ajuster l’extrait et les champs à publier si nécessaire.
4. Choisir **Valider et publier** et confirmer, ou **Ne pas retenir** avec un motif visible du client.

Seule la décision admin peut créer un article public. La décision et la publication sont atomiques en base et idempotentes : une reprise ne publie pas deux articles. Une proposition déjà traitée ou modifiée ne peut pas être approuvée avec une ancienne version. Les décisions restent dans un journal privé.

Les articles publiés par la communauté apparaissent avec leur nom public et une URL `communaute-<UUID>`. Ils restent éditables dans la liste d’articles habituelle. Leur texte s’affiche dans sa langue d’origine si une traduction n’a pas encore été renseignée. L’éditeur admin possède des champs de traduction EN/AR ; les six articles éditoriaux sont déjà traduits.

## Installation avant publication

Dans le projet Supabase de la boutique, exécuter dans cet ordre :

1. **`supabase/migration_blog_community.sql`** : traductions et tables/fonctions privées de propositions, décisions et sauvegardes.
2. **`supabase/refresh_blog_editorial.sql`** : remplacement demandé des six textes, avec sauvegarde préalable et conservation des URL.

Le second fichier est généré de façon déterministe par `node scripts/prepare-journal-editorial.js`. Le rejouer ne réécrit pas un article que l’admin a modifié après la refonte. Il ne publie aucune proposition client et conserve l’état de visibilité des articles existants.

Le propriétaire a confirmé « les deux fichiers sont exécutés ». Le preflight contrôle le marqueur `blog_community_schema_version()=1`, les tables et la colonne de traductions en lecture seule avant publication. Aucune migration n’est exécutée automatiquement par le build.

## Vérifications

- Contrôles des contenus FR/EN/AR et de leurs illustrations locales.
- Tests serveur : identité client imposée par la session, actions admin protégées, limites, statuts forgés et photos arbitraires refusés.
- PGlite : envois et décisions rejoués, publication uniquement après approbation, refus conservé, limite de propositions, sauvegarde et réécriture rejouable.
- Navigateur local : page, thèmes, recherche, sommaire, formulaire connecté, envoi incertain, validation admin/reprise, publication unique et effacement des données affichées après déconnexion.
