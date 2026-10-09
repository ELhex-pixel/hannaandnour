const content = require('../public/js/content');
const translations = require('../public/js/i18n');
const { publicRead, queryResult } = require('../netlify/functions/lib/public-read');

// Explicit public fields only: no prices, stock, customer data or private costs.
const fields = {
  products: 'slug,sku,name_fr,name_en,name_ar,description_fr,description_en,description_ar,image,fit_fr,fit_en,fit_ar,measurements_fr,measurements_en,measurements_ar',
  blog_posts: 'slug,title,category,excerpt,body,image,author,read_minutes,published_at'
};

async function loadPublicContent(sb) {
  if (!sb) return { products: [], posts: [] };
  async function read(table) {
    const rows = [];
    for (let page = 0; page < 20; page++) {
      const response = await publicRead('seo_' + table, async signal => queryResult(await sb.from(table).select(fields[table]).eq('active', true).order('slug').range(page * 500, page * 500 + 499).abortSignal(signal)));
      const batch = response.data || [];
      for (const row of batch) {
        if (!content.validSlug(row.slug)) throw new Error('Un slug public ne peut pas être publié dans le sitemap.');
        rows.push(row);
      }
      if (batch.length < 500) return rows;
    }
    throw new Error('Catalogue trop volumineux pour le pré-rendu : aucune publication partielle.');
  }
  const [products, posts] = await Promise.all([read('products'), read('blog_posts')]);
  posts.sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0) || a.slug.localeCompare(b.slug));
  return { products, posts };
}

function cleanPublicLinks($) {
  $('.footer [data-i18n="linkLoyalty"], .footer [data-i18n="linkCareers"], .footer [data-i18n="linkSustainability"], .footer [data-i18n="linkFaqs"]').each((_, el) => {
    const node = $(el); if (node.parent().is('li')) node.parent().remove(); else node.remove();
  });
  $('.footer-social a[href="#"]').remove();
  $('.footer-social').each((_, el) => { if (!$(el).find('a').length) $(el).remove(); });
  $('.footer [data-i18n="linkSizeGuide"]').attr('href', 'size-guide.html');
  $('.footer [data-i18n="linkPress"]').attr('href', 'blog.html').attr('data-i18n', 'navBlog').text('Blog');
}

function metadata($, meta, kind) {
  $('title').text(meta.title);
  $('link[rel="canonical"], link[hreflang]').remove();
  $('<link rel="canonical">').attr('href', meta.url).appendTo('head');
  for (const entry of [...meta.alternates, { lang: 'x-default', url: meta.alternates[0].url }]) {
    $('<link rel="alternate">').attr({ hreflang: entry.lang, href: entry.url }).appendTo('head');
  }
  function set(attribute, key, value) {
    const selector = 'meta[' + attribute + '="' + key + '"]';
    let node = $(selector); if (!node.length) node = $('<meta>').attr(attribute, key).appendTo('head');
    node.attr('content', value);
  }
  set('name', 'description', meta.description);
  for (const key of ['title', 'description', 'url', 'image']) set('property', 'og:' + key, meta[key] || '');
  set('property', 'og:type', kind === 'post' ? 'article' : 'product');
  for (const key of ['title', 'description', 'image']) set('name', 'twitter:' + key, meta[key] || '');
  set('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary');
  const id = kind === 'product' ? 'product-jsonld' : 'post-jsonld';
  $('#' + id).remove();
  $('<script type="application/ld+json">').attr('id', id).text(JSON.stringify(meta.schema).replace(/</g, '\\u003c')).appendTo('head');
}

function staticMetadata($, origin, file, lang) {
  const descriptionKeys = { 'index.html': 'heroDesc', 'shop.html': 'seoShopDescription', 'blog.html': 'seoBlogDescription', 'size-guide.html': 'seoSizeDescription', 'product.html': 'seoProductDescription', 'blog-post.html': 'seoPostDescription' };
  if (descriptionKeys[file]) $('meta[name="description"]').attr('content', translations[lang][descriptionKeys[file]]);
  const values = { title: $('title').text(), description: $('meta[name="description"]').attr('content') || '', url: new URL('/' + lang + '/' + file, origin).href, type: 'website' };
  for (const [key, value] of Object.entries(values)) {
    let meta = $('meta[property="og:' + key + '"]');
    if (!meta.length) meta = $('<meta>').attr('property', 'og:' + key).appendTo('head');
    meta.attr('content', value);
  }
  for (const [key, value] of Object.entries({ card: 'summary', title: values.title, description: values.description })) {
    let meta = $('meta[name="twitter:' + key + '"]');
    if (!meta.length) meta = $('<meta>').attr('name', 'twitter:' + key).appendTo('head');
    meta.attr('content', value);
  }
}

function renderContent($, origin, kind, row, lang) {
  const meta = content.metadata(origin, kind, row, lang);
  $('body').attr({ 'data-content-slug': row.slug, 'data-content-kind': kind });
  if (kind === 'post') $('#postContent').html(content.postHTML(row, lang, key => translations[lang][key]));
  else {
    // Descriptions are readable without JS. Live prices/actions remain gated.
    const summary = $('<section class="section" data-seo-summary><div class="container blog-post-body"></div></section>');
    const box = summary.find('div');
    $('<h1>').text(content.localized(row, 'name', lang)).appendTo(box);
    $('<p>').text(content.localized(row, 'description', lang)).appendTo(box);
    for (const field of ['fit', 'measurements']) {
      const value = content.localized(row, field, lang);
      if (value) { $('<h2>').text(translations[lang][field === 'fit' ? 'productFit' : 'productMeasurements']).appendTo(box); $('<p>').text(value).appendTo(box); }
    }
    const photo = content.image(row.image);
    if (photo) $('<img decoding="async">').attr({ src: photo.startsWith('images/') ? '/' + photo : photo, alt: content.localized(row, 'name', lang) }).appendTo(box);
    $('main').prepend(summary);
  }
  metadata($, meta, kind);
  return meta.url;
}

module.exports = { loadPublicContent, cleanPublicLinks, renderContent, metadata, staticMetadata };
