const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cheerio = require('cheerio');
const content = require('../public/js/content');
const { loadPublicContent, cleanPublicLinks, renderContent, staticMetadata } = require('../scripts/seo');
const { prepareLivePage } = require('../scripts/build');
const dict = require('../public/js/i18n');
const product = { slug: 'veste-test', sku: 'HN-TEST', name_fr: 'Veste test', name_en: 'Test jacket', name_ar: 'سترة اختبار', description_fr: 'Description vérifiée', description_en: 'Verified description', description_ar: 'وصف مسجل', image: 'images/hero.jpg', fit_fr: 'Du 36 au 46' };
const post = { slug: 'conseils-test', title: 'Conseils', excerpt: 'Un extrait', body: 'Premier paragraphe.\n\n<script>unsafe</script>', author: 'Équipe', image: 'images/hero.jpg', read_minutes: 3, published_at: '2026-10-09T12:00:00Z' };

test('les URLs par slug conservent la langue, les anciens liens et refusent les chemins dangereux', () => {
  for (const lang of ['fr', 'en', 'ar']) {
    assert.equal(content.path('product', product.slug, lang), '/' + lang + '/products/veste-test.html');
    assert.equal(content.slug({ pathname: content.path('post', post.slug, lang) }), post.slug);
    assert.equal(content.slug({ pathname: '/' + lang + '/products/veste-test' }), product.slug);
    assert.equal(content.slug({ search: '?slug=veste-test&review=1' }), product.slug);
  }
  for (const slug of ['../admin', 'bad/slug', '<script>', '']) assert.throws(() => content.path('product', slug, 'fr'));
  assert.equal(content.slug({ pathname: '/fr/products/%ZZ.html' }), '');
});
test('le pré-rendu produit est lisible sans JS, sans prix ni stock figé, avec un canonical propre', () => {
  for (const lang of ['fr', 'en', 'ar']) {
    const $ = cheerio.load(fs.readFileSync('public/product.html', 'utf8'));
    prepareLivePage($, 'product.html');
    const url = renderContent($, 'https://example.test', 'product', product, lang);
    assert.equal($('[data-seo-summary] h1').text(), product['name_' + lang]);
    assert.equal($('[data-seo-summary] p').first().text(), product['description_' + lang]);
    assert.equal($('#addToCartBtn').is('[disabled]'), true);
    assert.equal($('.product-price').text(), '');
    assert.equal($('link[rel=canonical]').attr('href'), url);
    assert.equal($('link[hreflang]').length, 4);
    assert.equal($('meta[property="og:title"]').attr('content'), product['name_' + lang] + ' | Hanna & Nour');
    assert.equal($('meta[name="twitter:card"]').attr('content'), 'summary_large_image');
    const schema = JSON.parse($('#product-jsonld').text());
    assert.equal(schema['@type'], 'Product'); assert.equal(schema.offers, undefined);
    assert.equal(schema.aggregateRating, undefined); assert.equal(schema.url, url);
    assert.equal($('script[src="js/product.js"]').length, 1);
  }
});
test('les articles sont pré-rendus avec leurs propres métadonnées et des commandes FR/EN/AR', () => {
  for (const lang of ['fr', 'en', 'ar']) {
    const $ = cheerio.load(fs.readFileSync('public/blog-post.html', 'utf8'));
    const url = renderContent($, 'https://example.test', 'post', post, lang);
    assert.equal($('.blog-post-title').text(), post.title);
    assert.equal($('#postContent script').length, 0);
    assert.equal($('.blog-post-body p').length, 2);
    assert($('.blog-post-meta').text().includes(dict[lang].minRead));
    assert($('.blog-post-meta').text().includes(content.date(post.published_at, lang)));
    assert.equal($('#postContent .btn-secondary').text(), dict[lang].backToBlog);
    assert.equal($('#postContent .btn-primary').text(), dict[lang].discoverCollection);
    const schema = JSON.parse($('#post-jsonld').text());
    assert.equal(schema['@type'], 'BlogPosting'); assert.equal(schema.mainEntityOfPage, url);
    assert.equal($('link[rel=canonical]').attr('href'), url);
  }
});
test('les liens du footer ne promettent plus de services absents et les vrais liens sociaux sont conservés', () => {
  for (const file of fs.readdirSync('public').filter(file => file.endsWith('.html'))) {
    const $ = cheerio.load(fs.readFileSync('public/' + file, 'utf8'));
    cleanPublicLinks($);
    assert.equal($('.footer-social a[href="#"]').length, 0, file);
    assert.equal($('.footer [data-i18n="linkLoyalty"], .footer [data-i18n="linkCareers"], .footer [data-i18n="linkFaqs"], .footer [data-i18n="linkSustainability"]').length, 0, file);
    $('.footer [data-i18n="linkSizeGuide"]').each((_, el) => assert.equal($(el).attr('href'), 'size-guide.html'));
  }
  const $ = cheerio.load('<footer class="footer"><div class="footer-social"><a href="https://instagram.com/example">Compte officiel</a><a href="#">Faux</a></div></footer>');
  cleanPublicLinks($); assert.equal($('.footer-social a').length, 1);
});
test('le catalogue SEO lit seulement des champs publics actifs avec une pagination complète', async () => {
  const reads = [];
  const sb = { from(table) {
    const read = { table }; reads.push(read);
    const query = {
      select(fields) { read.fields = fields; return this; },
      eq(key, value) { assert.equal(key, 'active'); assert.equal(value, true); return this; },
      order(key) { assert.equal(key, 'slug'); return this; },
      range(start, end) { read.start = start; assert.equal(end - start, 499); return this; },
      abortSignal() { return this; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'blog_posts' ? [post] : read.start === 0 ? Array.from({ length: 500 }, (_, i) => ({ ...product, slug: 'product-' + i })) : [product], error: null }).then(resolve, reject); }
    }; return query;
  } };
  const result = await loadPublicContent(sb);
  assert.equal(result.products.length, 501); assert.equal(result.posts.length, 1);
  assert(reads.some(read => read.start === 500));
  for (const read of reads) assert.doesNotMatch(read.fields, /\*|price|stock|cost|email|user_id/);
  assert.deepEqual(await loadPublicContent(null), { products: [], posts: [] });
});
test('un échec de lecture du catalogue bloque le pré-rendu au lieu de publier un faux sitemap complet', async () => {
  const query = { select() { return this; }, eq() { return this; }, order() { return this; }, range() { return this; }, abortSignal() { return this; }, then(resolve) { return Promise.resolve({ error: { code: '42501', message: 'private' }, status: 403 }).then(resolve); } };
  await assert.rejects(loadPublicContent({ from: () => query }), /temporarily unavailable/);
});
test('les cartes, descriptions générales et métadonnées sociales suivent la langue choisie', () => {
  for (const lang of ['fr', 'en', 'ar']) {
    const $ = cheerio.load(content.postCardHTML(post, lang, key => dict[lang][key]));
    assert.equal($('.blog-card-title a').attr('href'), content.path('post', post.slug, lang));
    assert($('.blog-card-meta').text().includes(dict[lang].minRead));
    const page = cheerio.load('<head><title>Shop</title><meta name="description" content="old"></head><body></body>');
    staticMetadata(page, 'https://example.test', 'shop.html', lang);
    assert.equal(page('meta[name="description"]').attr('content'), dict[lang].seoShopDescription);
    assert.equal(page('meta[property="og:description"]').attr('content'), dict[lang].seoShopDescription);
    assert.equal(page('meta[name="twitter:description"]').attr('content'), dict[lang].seoShopDescription);
  }
});
test('les nouvelles routes publiques précèdent le 404 et conservent un gabarit pour les nouveaux slugs', () => {
  const routes = fs.readFileSync('netlify.toml', 'utf8');
  for (const lang of ['fr', 'en', 'ar']) {
    for (const [directory, template] of [['products','product'], ['articles','blog-post']]) {
      const source = `from = "/${lang}/${directory}/*"`;
      assert(routes.indexOf(source) < routes.indexOf('from = "/*"'));
      assert(routes.includes(`to = "/${lang}/${template}.html"`));
    }
  }
  assert(routes.includes('from = "/api/blog"'));
});
