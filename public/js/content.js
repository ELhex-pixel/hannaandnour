/* Public content rendering and URLs, shared by the browser and the SEO build. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_CONTENT = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var languages = ['fr', 'en', 'ar'];
  function language(value) { return languages.indexOf(value) >= 0 ? value : 'fr'; }
  function validSlug(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(value); }
  function path(kind, slug, lang) {
    if (!validSlug(slug) || ['product', 'post'].indexOf(kind) < 0) throw new Error('Invalid public content URL');
    return '/' + language(lang) + '/' + (kind === 'product' ? 'products' : 'articles') + '/' + encodeURIComponent(slug) + '.html';
  }
  function slug(location) {
    var query = new URLSearchParams(location.search || '').get('slug');
    if (query !== null) return validSlug(query) ? query : '';
    var match = String(location.pathname || '').match(/^\/(?:fr|en|ar)\/(?:products|articles)\/([^/]+?)(?:\.html)?\/?$/);
    var value = '';
    try { value = match ? decodeURIComponent(match[1]) : ''; } catch (error) { return ''; }
    return validSlug(value) ? value : '';
  }
  function esc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function localized(row, field, lang) { return row[field + '_' + language(lang)] || row[field + '_en'] || row[field + '_fr'] || row[field + '_ar'] || row[field] || ''; }
  function image(value) {
    var raw = String(value || '');
    return /^(?:https:\/\/|\/?images\/)/.test(raw) && !/[\s<>"\\]/.test(raw) ? raw : '';
  }
  function date(value, lang, short) {
    var d = new Date(value);
    return value && !isNaN(d.getTime()) ? d.toLocaleDateString({ fr: 'fr-FR', en: 'en-GB', ar: 'ar' }[language(lang)], { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' }) : '';
  }
  function postHTML(post, lang, t) {
    var title = localized(post, 'title', lang), body = localized(post, 'body', lang);
    var photo = image(post.image), blog = '/' + language(lang) + '/blog.html';
    return '<article><header class="blog-post-header">' +
      '<a href="' + blog + '" class="blog-card-category">' + esc(post.category || 'Blog') + '</a>' +
      '<h1 class="blog-post-title">' + esc(title) + '</h1><div class="blog-post-meta">' +
      '<span>' + esc(post.author || '') + '</span><span>' + esc(date(post.published_at, lang)) + '</span>' +
      '<span>' + (parseInt(post.read_minutes, 10) || 5) + ' ' + esc(t('minRead')) + '</span></div></header>' +
      (photo ? '<figure class="blog-post-figure"><img src="' + esc(photo) + '" alt="' + esc(title) + '"></figure>' : '') +
      '<div class="blog-post-body" style="margin-top:var(--spacing-xl);">' + String(body).split(/\n\s*\n/).map(function (p) { return p.trim() ? '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>' : ''; }).join('') + '</div>' +
      '<div class="text-center" style="margin-top:var(--spacing-2xl);"><a href="' + blog + '" class="btn btn-secondary">' + esc(t('backToBlog')) + '</a> ' +
      '<a href="/' + language(lang) + '/shop.html" class="btn btn-primary">' + esc(t('discoverCollection')) + '</a></div></article>';
  }
  function postCardHTML(post, lang, t, localFile) {
    var title = localized(post, 'title', lang), author = post.author || '', photo = image(post.image);
    var url = localFile ? 'blog-post.html?slug=' + encodeURIComponent(post.slug) : path('post', post.slug, lang);
    return '<article class="blog-card">' + (photo ? '<a href="' + esc(url) + '" class="blog-card-image"><img src="' + esc(photo) + '" alt="' + esc(title) + '" loading="lazy" decoding="async"></a>' : '') +
      '<div class="blog-card-content">' + (post.category ? '<span class="blog-card-category">' + esc(post.category) + '</span>' : '') +
      '<h2 class="blog-card-title"><a href="' + esc(url) + '">' + esc(title) + '</a></h2><p class="blog-card-excerpt">' + esc(localized(post, 'excerpt', lang)) + '</p>' +
      '<div class="blog-card-meta"><div class="blog-card-author"><span class="blog-author-avatar">' + esc(author.charAt(0).toUpperCase()) + '</span><span>' + esc(author) + '</span></div>' +
      '<span>' + esc(date(post.published_at, lang, true)) + ' &bull; ' + (parseInt(post.read_minutes, 10) || 5) + ' ' + esc(t('minRead')) + '</span></div></div></article>';
  }
  function metadata(origin, kind, row, lang) {
    origin = new URL(origin).origin;
    var title = localized(row, kind === 'product' ? 'name' : 'title', lang);
    var description = String(localized(row, kind === 'product' ? 'description' : 'excerpt', lang) || title).replace(/\s+/g, ' ').trim().slice(0, 160);
    var url = origin + path(kind, row.slug, lang), photo = image(row.image);
    var schema = { '@context': 'https://schema.org', '@type': kind === 'product' ? 'Product' : 'BlogPosting', name: title, description: description, url: url };
    if (photo) schema.image = [new URL(photo, origin + '/').href];
    if (kind === 'product') { schema.sku = row.sku || row.slug; schema.brand = { '@type': 'Brand', name: 'Hanna & Nour' }; }
    else {
      schema.headline = title;
      schema.mainEntityOfPage = url;
      schema.publisher = { '@type': 'Organization', name: 'Hanna & Nour', url: origin };
      if (row.author) schema.author = { '@type': 'Person', name: row.author };
      if (row.published_at && !isNaN(new Date(row.published_at).getTime())) schema.datePublished = new Date(row.published_at).toISOString();
    }
    return { title: title + ' | Hanna & Nour', description: description, url: url, image: schema.image ? schema.image[0] : '', schema: schema,
      alternates: languages.map(function (value) { return { lang: value, url: origin + path(kind, row.slug, value) }; }) };
  }
  function applyMetadata(doc, meta, kind) {
    doc.title = meta.title;
    function set(selector, attrs) {
      var el = doc.querySelector(selector);
      if (!el) { el = doc.createElement(selector.indexOf('link') === 0 ? 'link' : 'meta'); doc.head.appendChild(el); }
      Object.keys(attrs).forEach(function (name) { el.setAttribute(name, attrs[name]); });
    }
    set('link[rel="canonical"]', { rel: 'canonical', href: meta.url });
    set('meta[name="description"]', { name: 'description', content: meta.description });
    ['title', 'description', 'url', 'image'].forEach(function (name) { set('meta[property="og:' + name + '"]', { property: 'og:' + name, content: meta[name] || '' }); });
    set('meta[property="og:type"]', { property: 'og:type', content: kind === 'post' ? 'article' : 'product' });
    ['title', 'description', 'image'].forEach(function (name) { set('meta[name="twitter:' + name + '"]', { name: 'twitter:' + name, content: meta[name] || '' }); });
    set('meta[name="twitter:card"]', { name: 'twitter:card', content: meta.image ? 'summary_large_image' : 'summary' });
    meta.alternates.concat([{ lang: 'x-default', url: meta.alternates[0].url }]).forEach(function (entry) {
      set('link[hreflang="' + entry.lang + '"]', { rel: 'alternate', hreflang: entry.lang, href: entry.url });
    });
    var id = kind === 'post' ? 'post-jsonld' : 'product-jsonld', script = doc.getElementById(id);
    if (!script) { script = doc.createElement('script'); script.id = id; script.type = 'application/ld+json'; doc.head.appendChild(script); }
    script.textContent = JSON.stringify(meta.schema).replace(/</g, '\\u003c');
  }
  return { language: language, path: path, slug: slug, validSlug: validSlug, esc: esc, localized: localized, image: image, date: date, postHTML: postHTML, postCardHTML: postCardHTML, metadata: metadata, applyMetadata: applyMetadata };
});
