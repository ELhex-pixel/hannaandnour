// Compatibility for known demonstration copy only. Custom content and actual
// customer reviews are never rewritten. No database mutation or schema change.
const dict = require('../../../public/js/i18n');
const normalized = text => String(text || '').replace(/[’]/g, "'").replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();
const storyDefaults = {
  hero: {
    subtitle: ['navStory', 'Notre histoire'],
    title: ['whereFaithMeetsFashion', 'Là où la foi rencontre la mode'],
    p1: ['aboutP1', "Hanna & Nour — alliant Hanna (la grâce) et Nour (la lumière) — est née d'une conviction simple : la pudeur n'est pas une limite, c'est une libération. Nous existons pour renforcer les femmes qui choisissent de se couvrir, en leur offrant une mode qui honore leurs valeurs sans compromettre leur style."],
    p2: ['aboutP2', "Fondée en 2021 par deux sœurs, Amina et Zahra, Hanna & Nour a commencé comme une petite collection de hijabs artisanaux vendus sur les marchés locaux. Aujourd'hui, nous servons des milliers de femmes dans le monde entier avec des pièces conçues, confectionnées et sélectionnées avec amour."]
  },
  craft: {
    subtitle: ['craftsmanship', 'Artisanat'],
    title: ['madeWithIntention', 'Confectionné avec intention'],
    p1: ['craftP1', "Chaque pièce Hanna & Nour commence par un croquis et une prière. Nous travaillons directement avec des communautés d'artisans pour trouver les plus beaux tissus — des soies éthiques d'Ouzbékistan aux cotons tissés à la main d'Égypte."],
    p2: ['craftP2', 'Nos partenaires de production sont certifiés, équitablement rémunérés et traités avec dignité. Nous visitons chaque atelier et connaissons chaque artisan personnellement.']
  }
};
function generalStory(story) {
  if (!story || typeof story !== 'object' || Array.isArray(story)) return story;
  const result = { ...story };
  for (const [section, fields] of Object.entries(storyDefaults)) {
    if (!story[section] || typeof story[section] !== 'object') continue;
    result[section] = { ...story[section] };
    result[section].text_keys = {};
    for (const [field, [key, old]] of Object.entries(fields)) {
      if ([old, dict.fr[key]].some(text => normalized(story[section][field]) === normalized(text))) {
        result[section][field] = dict.fr[key];
        result[section].text_keys[field] = key;
      }
    }
  }
  return result;
}
const demoDefaults = [
  ['t1', "La qualité est absolument magnifique. Je ne me suis jamais sentie aussi confiante et belle dans une tenue modeste. Hanna & Nour comprend vraiment ce que l'on recherche."],
  ['t2', "Livraison rapide, emballage magnifique, et l'abaya tombe parfaitement. C'est désormais ma boutique de référence pour toute ma mode modeste."],
  ['t3', "J'adore la façon dont Hanna & Nour célèbre la pudeur tout en restant tendance. L'ensemble de prière est si confortable et beau pour le culte quotidien."]
];
function generalDemo(review) {
  const match = demoDefaults.find(([key, old]) => [old, dict.fr[key]].some(text => normalized(text) === normalized(review.body)));
  if (!match) return review;
  const result = { ...review, body: dict.fr[match[0]] };
  for (const lang of ['fr', 'en', 'ar']) result['body_' + lang] = dict[lang][match[0]];
  return result;
}
const postDefaults = [
  {
    slug: 'guide-tenues-priere', key: 'b3', title: 'Le guide ultime pour choisir une tenue de prière',
    excerpt: 'Confort, couverture et qualité : notre guide complet pour choisir une tenue de prière qui accompagne votre pratique spirituelle.',
    body: `La tenue de prière doit allier trois qualités essentielles : une couverture totale, un confort absolu et des tissus qui ne gênent pas la concentration. Un ensemble en jersey souple ou en crêpe fluide répond parfaitement à ces exigences.

Pensez aussi à la praticité : des coupes ajustées qui ne glissent pas pendant les mouvements de la salat, une matière qui ne froisse pas facilement pour les déplacements, et des teintes sobres qui vous mettent en paix.

Enfin, investissez dans la qualité. Une bonne tenue de prière se lave bien, dure des années et devient un repère rassurant de votre quotidien spirituel.`
  },
  {
    slug: 'mode-modeste-2026', key: 'b4', title: 'Pourquoi la mode modeste compte en 2026',
    excerpt: "Le mouvement de la mode modeste transforme l'industrie. Voici pourquoi il compte plus que jamais pour les femmes partout dans le monde.",
    body: `Loin d'être une tendance passagère, la mode modeste s'impose comme une force durable de l'industrie. Elle incarne une exigence : celle de proposer des vêtements qui respectent les valeurs, la dignité et la liberté de chacune.

Les femmes qui la portent ne se définissent pas par ce qu'elles cachent, mais par ce qu'elles expriment : une élégance choisie, une identité affirmée, une confiance inébranlable.

En 2026, le sujet dépasse la simple mode : c'est un dialogue entre diversité culturelle, éthique industrielle et autonomie des femmes.`
  },
  {
    slug: 'idees-tenues-aid', key: 'b6', title: "Idées de tenues pour l'Aïd : du matin aux célébrations en famille",
    excerpt: "Des tenues complètes pour l'Aïd, qui vous gardent élégante, confortable et couverte, de la première prière à la dernière réunion de famille.",
    body: `L'Aïd est un moment de joie et de partage, et votre tenue doit être à la hauteur. Pour la prière du matin, privilégiez une abaya fluide dans une teinte douce, accompagnée d'un hijab en soie qui ne glisse pas.

Pour les visites en famille, optez pour des pièces confortables comme un ensemble en jersey avec une ceinture fine, ou une abaya en velours pour les repas plus formels.

Complétez avec des accessoires discrets : une broche, un sac ton sur ton, de jolies chaussures plates. L'élégance de l'Aïd se résume souvent aux détails.`
  }
];
function generalPost(post) {
  const match = postDefaults.find(seed => seed.slug === post.slug && ['title', 'excerpt', 'body'].every(field => {
    const key = seed.key + field.charAt(0).toUpperCase() + field.slice(1);
    return normalized(post[field]) === normalized(seed[field]) || normalized(post[field]) === normalized(dict.fr[key]);
  }));
  if (!match) return post;
  const result = { ...post };
  for (const field of ['title', 'excerpt', 'body']) {
    const key = match.key + field.charAt(0).toUpperCase() + field.slice(1);
    result[field] = dict.fr[key];
    for (const lang of ['fr', 'en', 'ar']) result[field + '_' + lang] = dict[lang][key];
  }
  return result;
}
module.exports = { generalStory, generalDemo, generalPost };
