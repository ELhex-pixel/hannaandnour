-- Hanna & Nour - MIGRATION: blog posts + Our Story content
-- Run this in the Supabase SQL editor (à exécuter dans l'éditeur SQL Supabase).
-- 1) Table blog_posts (articles du blog, admin-editable). Le champ body est du
--    texte simple : les paragraphes sont séparés par une ligne vide.
create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null default '',
  category text not null default '',
  image text not null default '',
  excerpt text not null default '',
  body text not null default '',
  author text not null default '',
  published_at timestamptz not null default now(),
  read_minutes integer not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed : reprise des articles actuels du blog.
insert into blog_posts (slug, title, category, image, excerpt, body, author, published_at, read_minutes, active) values
('styler-hijab-quotidien', '5 façons simples de styler votre hijab du quotidien', 'Conseils de style', 'images/hero.jpg',
 'Des drapés classiques aux torsades modernes, découvrez des styles de hijab polyvalents, du bureau au week-end, en toute simplicité.',
 'Le hijab du quotidien mérite autant d''attention que les grandes occasions. Avec quelques gestes simples, vous pouvez transformer un look ordinaire en une tenue affirmée et élégante.

Commencez par choisir un tissu adapté à votre journée : une mousseline légère pour les températures douces, un coton premium pour le travail, une soie pour les sorties. La texture du tissu change tout en matière de tombé.

Enfin, osez varier les styles : le drapé latéral pour allonger la silhouette, la torsade pour structurer, ou encore le style turban pour les journées pressées. Entraînez-vous devant le miroir : en quelques jours, ces gestes deviendront naturels.',
 'Amina H.', '2026-03-12', 5, true),
('art-abaya-moderne', 'L''art de l''abaya : porter la tradition avec modernité', 'Inspiration mode', 'images/eid-abaya.jpg',
 'Adoptez l''élégance de l''abaya avec des techniques de styling contemporaines qui célèbrent à la fois l''héritage et la modernité.',
 'L''abaya est bien plus qu''un vêtement : c''est une déclaration. Les créateurs contemporains l''ont réinventée avec des coupes structurées, des ceintures fines et des jeux de matières qui subliment chaque mouvement.

Pour un look moderne, jouez sur les contrastes : une abaya fluide associée à des accessoires en cuir, une pièce en velours portée en soirée, ou une version en crêpe légère pour la journée. L''important est de laisser respirer la silhouette tout en conservant l''élégance du tombé.

N''ayez pas peur de la couleur. Anthracite, vert sauge, bleu nuit ou bordeaux : les teintes profondes enrichissent la tenue sans trahir l''esprit de la pièce.',
 'Zahra K.', '2026-02-28', 7, true),
('guide-tenues-priere', 'Le guide ultime pour choisir une tenue de prière', 'Guide shopping', 'images/prayer-wear.jpg',
 'Confort, couverture et qualité : notre guide complet pour choisir une tenue de prière qui accompagne votre pratique spirituelle.',
 'La tenue de prière doit allier trois qualités essentielles : une couverture totale, un confort absolu et des tissus qui ne gênent pas la concentration. Un ensemble en jersey souple ou en crêpe fluide répond parfaitement à ces exigences.

Pensez aussi à la praticité : des coupes ajustées qui ne glissent pas pendant les mouvements de la salat, une matière qui ne froisse pas facilement pour les déplacements, et des teintes sobres qui vous mettent en paix.

Enfin, investissez dans la qualité. Une bonne tenue de prière se lave bien, dure des années et devient un repère rassurant de votre quotidien spirituel.',
 'Maryam S.', '2026-02-14', 4, true),
('mode-modeste-2026', 'Pourquoi la mode modeste compte en 2026', 'Communauté', 'images/everyday-hijab.jpg',
 'Le mouvement de la mode modeste transforme l''industrie. Voici pourquoi il compte plus que jamais pour les femmes partout dans le monde.',
 'Loin d''être une tendance passagère, la mode modeste s''impose comme une force durable de l''industrie. Elle incarne une exigence : celle de proposer des vêtements qui respectent les valeurs, la dignité et la liberté de chacune.

Les femmes qui la portent ne se définissent pas par ce qu''elles cachent, mais par ce qu''elles expriment : une élégance choisie, une identité affirmée, une confiance inébranlable.

En 2026, le sujet dépasse la simple mode : c''est un dialogue entre diversité culturelle, éthique industrielle et autonomie des femmes.',
 'Amina H.', '2026-02-01', 6, true),
('entretien-hijabs-soie', 'Comment entretenir vos hijabs en soie et mousseline', 'Conseils d''entretien', 'images/pearl-brooch.jpg',
 'Prolongez la vie de vos tissus précieux avec ces conseils simples de lavage, de séchage et de rangement venus de notre atelier.',
 'La soie et la mousseline sont des tissus nobles qui demandent un soin particulier. Lavez-les à la main dans une eau froide avec un détergent doux, ou utilisez un programme délicat avec un filet de protection.

Séchage : jamais de machine ! Égouttez délicatement et séchez à plat, à l''abri du soleil. Repassez à basse température, idéalement quand le tissu est encore légèrement humide.

Rangez vos hijabs pliés plutôt que suspendus, pour préserver leur tombé. Un morceau de bois de cèdre ou un sachet de lavande gardera le tissu frais dans vos placards.',
 'Zahra K.', '2026-01-25', 3, true),
('idees-tenues-aid', 'Idées de tenues pour l''Aïd : du matin aux célébrations en famille', 'Occasions', 'images/velvet-abaya.jpg',
 'Des tenues complètes pour l''Aïd, qui vous gardent élégante, confortable et couverte, de la première prière à la dernière réunion de famille.',
 'L''Aïd est un moment de joie et de partage, et votre tenue doit être à la hauteur. Pour la prière du matin, privilégiez une abaya fluide dans une teinte douce, accompagnée d''un hijab en soie qui ne glisse pas.

Pour les visites en famille, optez pour des pièces confortables comme un ensemble en jersey avec une ceinture fine, ou une abaya en velours pour les repas plus formels.

Complétez avec des accessoires discrets : une broche, un sac ton sur ton, de jolies chaussures plates. L''élégance de l''Aïd se résume souvent aux détails.',
 'Maryam S.', '2026-01-08', 8, true)
on conflict (slug) do nothing;

-- 2) Contenu « Notre histoire » (settings key 'story') : hero + « Made with Intention ».
insert into settings (key, value, updated_at)
values ('story', jsonb_build_object(
  'hero', jsonb_build_object(
    'subtitle', 'Notre histoire',
    'title', 'Là où la foi rencontre la mode',
    'p1', 'Hanna & Nour — alliant Hanna (la grâce) et Nour (la lumière) — est née d''une conviction simple : la pudeur n''est pas une limite, c''est une libération. Nous existons pour renforcer les femmes qui choisissent de se couvrir, en leur offrant une mode qui honore leurs valeurs sans compromettre leur style.',
    'p2', 'Fondée en 2021 par deux sœurs, Amina et Zahra, Hanna & Nour a commencé comme une petite collection de hijabs artisanaux vendus sur les marchés locaux. Aujourd''hui, nous servons des milliers de femmes dans le monde entier avec des pièces conçues, confectionnées et sélectionnées avec amour.',
    'image', 'images/hero.jpg'
  ),
  'craft', jsonb_build_object(
    'subtitle', 'Artisanat',
    'title', 'Confectionné avec intention',
    'p1', 'Chaque pièce Hanna & Nour commence par un croquis et une prière. Nous travaillons directement avec des communautés d''artisans pour trouver les plus beaux tissus — des soies éthiques d''Ouzbékistan aux cotons tissés à la main d''Égypte.',
    'p2', 'Nos partenaires de production sont certifiés, équitablement rémunérés et traités avec dignité. Nous visitons chaque atelier et connaissons chaque artisan personnellement.',
    'image', 'images/craftsmanship.jpg'
  )
), now())
on conflict (key) do nothing;