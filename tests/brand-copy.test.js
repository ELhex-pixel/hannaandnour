const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { generalStory, generalDemo, generalPost } = require('../netlify/functions/lib/brand-copy');
const dict = require('../public/js/i18n');

function seedPosts() {
  const sql = fs.readFileSync('supabase/migration_blog_story.sql', 'utf8');
  const quoted = "'((?:''|[^'])*)'";
  const pattern = new RegExp('\\(' + Array(8).fill(quoted).join(',\\s*') + ',\\s*\\d+,\\s*true\\)', 'g');
  return Array.from(sql.matchAll(pattern)).map(match => Object.fromEntries(['slug','title','category','image','excerpt','body','author','published_at'].map((key, i) => [key, match[i + 1].replace(/''/g, "'")])));
}
test('les anciens textes de démonstration sont adaptés sans réécrire un article personnalisé ni son URL', () => {
  const posts = seedPosts(); assert.equal(posts.length, 6);
  for (const [slug, key] of [['guide-tenues-priere','b3'], ['mode-modeste-2026','b4'], ['idees-tenues-aid','b6']]) {
    const original = posts.find(post => post.slug === slug), snapshot = JSON.stringify(original);
    const result = generalPost(original);
    assert.equal(result.title, dict.fr[key + 'Title']);
    assert.equal(result.body, dict.fr[key + 'Body']);
    assert.equal(result.slug, slug); assert.equal(result.image, original.image); assert.equal(result.author, original.author);
    for (const lang of ['fr','en','ar']) assert.equal(result['body_' + lang], dict[lang][key + 'Body']);
    assert.equal(JSON.stringify(original), snapshot);
    const edited = { ...original, body: original.body + '\nTexte ajouté dans l’admin.' };
    assert.equal(generalPost(edited), edited);
    assert.deepEqual(generalPost(result), result);
  }
});
test('Notre histoire conserve les images et les textes personnalisés, et traduit seulement les valeurs par défaut', () => {
  const original = { hero: { title: 'Là où la foi rencontre la mode', p1: 'Notre texte personnalisé.', image: 'images/custom-hero.jpg' }, craft: { title: 'Notre atelier', image: 'images/custom-craft.jpg' } };
  const result = generalStory(original);
  assert.equal(result.hero.title, dict.fr.whereFaithMeetsFashion);
  assert.equal(result.hero.text_keys.title, 'whereFaithMeetsFashion');
  assert.equal(result.hero.p1, original.hero.p1); assert.equal(result.hero.text_keys.p1, undefined);
  assert.equal(result.hero.image, original.hero.image); assert.equal(result.craft.image, original.craft.image);
  assert.equal(result.craft.title, original.craft.title);
  assert.equal(original.hero.title, 'Là où la foi rencontre la mode');
});
test('la normalisation des avis de démonstration ne touche jamais les vrais avis, même avec le même texte', async () => {
  const body = "La qualité est absolument magnifique. Je ne me suis jamais sentie aussi confiante et belle dans une tenue modeste. Hanna & Nour comprend vraiment ce que l'on recherche.";
  const review = { id: 'fixture-review', body, author_name: 'Client test', rating: 4, verified: false };
  const exports = {};
  const sb = { from(table) {
    const query = { select(){return this;}, eq(){return this;}, order(){return this;}, limit(){return this;}, single(){return this;},
      then(resolve, reject) { return Promise.resolve({ data: table === 'products' ? { id: 'fixture-product', slug: 'cape', rating: 4, review_count: 1 } : [review], error: null }).then(resolve, reject); }
    }; return query;
  } };
  vm.runInNewContext(fs.readFileSync('netlify/functions/reviews.js','utf8'), { exports, require: name => name === './shared' ? { json: (statusCode, data) => ({ statusCode, body: JSON.stringify(data) }), isConfigured: () => true, getSupabase: () => sb } : require('../netlify/functions/lib/brand-copy') });
  const real = await exports.handler({ httpMethod: 'GET', queryStringParameters: { product: 'cape' } });
  const demo = await exports.handler({ httpMethod: 'GET', queryStringParameters: { demo: 'true' } });
  assert.equal(JSON.parse(real.body).reviews[0].body, body);
  const display = JSON.parse(demo.body).reviews[0];
  assert.equal(display.body, dict.fr.t1); assert.equal(display.rating, 4); assert.equal(display.author_name, review.author_name); assert.equal(display.verified, false);
  assert.deepEqual(generalDemo(display), display); assert.equal(review.body, body);
});
