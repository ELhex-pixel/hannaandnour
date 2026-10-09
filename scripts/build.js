const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const sharp = require('sharp');
const translations = require('../public/js/i18n');
const { preflight } = require('./preflight');

function prepareNetlifyImages(source) {
  const section = source.match(/^\[images\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m);
  const match = section && section[1].match(/^\s*remote_images\s*=\s*(\[[^\r\n]*\])\s*$/m);
  if (!match) throw new Error('Configuration du CDN images absente');
  const remote_images = JSON.parse(match[1]);
  if (!Array.isArray(remote_images) || !remote_images.length || remote_images.some(pattern => typeof pattern !== 'string')) throw new Error('Configuration du CDN images invalide');
  remote_images.forEach(pattern => new RegExp(pattern));
  return { images: { remote_images } };
}

function prepareLivePage($, file) {
  if (!['index.html', 'shop.html', 'product.html', 'cart.html', 'checkout.html'].includes(file)) return;
  $('body').attr('data-live-page', file);
  $('body').attr('data-image-cdn', '');
  $('script[src="js/product-media.js"]').remove();
  $('script[src="js/store.js"]').before('<script src="js/product-media.js"></script>');
  const skeleton = (layout, count) => '<span class="live-status" role="status" data-i18n="liveLoading">Chargement…</span>' + Array.from({ length: count }, () => '<div class="live-skeleton-' + layout + '" aria-hidden="true"><div class="live-skeleton-image"></div><div class="live-skeleton-copy"><div class="live-skeleton-line"></div><div class="live-skeleton-line live-skeleton-short"></div></div></div>').join('');
  const placeholder = (selector, layout, count) => $(selector).attr('aria-busy', 'true').html(skeleton(layout, count));
  const amounts = selector => $(selector).removeAttr('data-i18n').html('<span class="live-amount" aria-hidden="true"></span>');
  if (file === 'index.html') {
    placeholder('[data-feed="bestsellers"]', 'card', 4);
    placeholder('[data-feed="collections"]', 'card', 3);
    $('#testimonialsSection').css('display', 'none');
    $('[data-feed="testimonials"]').empty();
  }
  if (file === 'shop.html') {
    placeholder('#productsGrid', 'card', 8);
    $('.shop-results').empty();
    $('.filter-count').empty();
    $('#loadMore').attr('hidden', '').attr('disabled', '');
  }
  if (file === 'cart.html') {
    placeholder('.cart-items', 'row', 1);
    amounts('[id^="cartSummary"]');
    $('.cart-checkout a').attr('aria-disabled', 'true').attr('tabindex', '-1').css('pointer-events', 'none');
    $('#applyPromo').attr('disabled', '');
  }
  if (file === 'checkout.html') {
    placeholder('.checkout-items', 'row', 1);
    amounts('[id^="checkoutSummary"], .payment-method[data-method] strong');
    $('#placeOrderBtn, #applyDiscount').attr('disabled', '');
  }
  if (file === 'product.html') {
    $('.product-detail').first().before('<div id="productLoading" class="product-loading" aria-busy="true">' + skeleton('card', 1) + '<div class="live-skeleton-copy" aria-hidden="true"><div class="live-skeleton-line"></div><div class="live-skeleton-line live-skeleton-short"></div><div class="live-skeleton-line"></div></div></div>');
    $('.product-detail').first().attr('data-product-content', '').attr('hidden', '').attr('inert', '');
    $('.product-tabs').attr('data-product-content', '').attr('hidden', '').attr('inert', '');
    $('.product-info [data-i18n]').filter((_, node) => ['catHijabs', 'silkHijab', 'reviews128'].includes($(node).attr('data-i18n'))).removeAttr('data-i18n').empty();
    $('.product-price, .product-short-desc, .product-rating .stars, .product-rating .rating-count, .color-options-detail, .size-options, #selectedSize, #selectedColor, .product-gallery-thumbnails').empty();
    $('#mainImage').removeAttr('src').attr('alt', '');
    $('#addToCartBtn, #buyNowBtn').attr('disabled', '');
    $('.page-header-breadcrumb a').last().text('').attr('href', 'shop.html');
    $('.page-header-breadcrumb span').last().empty();
    $('#tab-description p, #tab-description ul, #tab-fabric p, #tab-fabric ul').removeAttr('data-i18n').empty();
    $('.reviews-number, .reviews-total, #reviewsStars, .review-bar-count').empty();
    $('.review-bar-fill').css('width', '0%');
    $('#demoReviews').empty();
    $('title').text('Hanna & Nour');
    $('meta[name="description"]').attr('content', 'Hanna & Nour');
  }
}

async function build() {
  const preview = process.env.CONTEXT === 'deploy-preview' || process.env.CONTEXT === 'branch-deploy';
  if (preview && process.env.STAGING_MODE !== 'true') throw new Error('Preview désactivée : configurez un environnement staging isolé avant de déployer.');
  if ((preview || process.env.STAGING_MODE === 'true') && (!process.env.EXPECTED_STAGING_SUPABASE_URL || !process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL === process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL !== process.env.EXPECTED_STAGING_SUPABASE_URL || !String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'))) throw new Error('Le staging exige sa propre base Supabase, une PRODUCTION_SUPABASE_URL distincte et une clé Stripe test.');
  await preflight();
  const imageConfig = prepareNetlifyImages(await fs.readFile('netlify.toml', 'utf8'));
  await fs.mkdir('.netlify/v1', { recursive: true });
  await fs.writeFile('.netlify/v1/config.json', JSON.stringify(imageConfig));
  const origin = (preview ? process.env.DEPLOY_PRIME_URL : process.env.SITE_URL) || 'https://hannanour.com';
  await fs.mkdir('dist', { recursive: true });
  await fs.cp('public', 'dist', { recursive: true });
  await fs.mkdir('dist/assets', { recursive: true });
  const assets = {};
  for (const dir of ['js', 'css']) {
    const files = await fs.readdir(path.join('public', dir));
    for (const file of files.filter(file => /\.(js|css)$/.test(file))) {
      const content = await fs.readFile(path.join('public', dir, file));
      const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
      const name = file.replace(/\.(js|css)$/, '.' + hash + '.$1');
      assets['/' + dir + '/' + file] = '/assets/' + name;
      await fs.writeFile(path.join('dist/assets', name), content);
    }
  }
  const images = await fs.readdir('public/images');
  const optimized = {};
  for (const file of images.filter(file => /\.jpe?g$/i.test(file))) {
    const name = file.replace(/\.jpe?g$/i, '.webp');
    await sharp(path.join('public/images', file)).resize({ width: 1400, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join('dist/images', name));
    await sharp(path.join('public/images', file)).resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join('dist/images', file));
    optimized['/images/' + file] = '/images/' + name;
  }
  const files = (await fs.readdir('public')).filter(file => file.endsWith('.html'));
  const privatePages = new Set(['admin.html', 'print.html', 'account.html', 'cart.html', 'checkout.html', 'reset.html', 'review.html', 'success.html', '404.html']);
  const urls = [];
  for (const file of files) {
    const source = await fs.readFile(path.join('public', file), 'utf8');
    for (const lang of [null, 'fr', 'en', 'ar']) {
      const language = lang || 'fr';
      const $ = cheerio.load(source);
      prepareLivePage($, file);
      $('base').remove();
      $('head').prepend('<base href="/">');
      $('html').attr('lang', language).attr('dir', language === 'ar' ? 'rtl' : 'ltr');
      $('[data-i18n]').each((_, node) => { const key = $(node).attr('data-i18n'); if (translations[language][key]) $(node).text(translations[language][key]); });
      for (const attribute of ['placeholder', 'aria-label']) $('[data-i18n-' + attribute + ']').each((_, node) => { const key = $(node).attr('data-i18n-' + attribute); if (translations[language][key]) $(node).attr(attribute, translations[language][key]); });
      $('[src], [href]').each((_, node) => {
        for (const attribute of ['src', 'href']) {
          const raw = $(node).attr(attribute);
          if (!raw || /^(https?:|data:|mailto:|tel:|#)/.test(raw)) continue;
          const absolute = raw.startsWith('/') ? raw : '/' + raw;
          if (/^\/[a-z0-9-]+\.html(?:[?#]|$)/.test(absolute)) $(node).attr(attribute, (lang ? '/' + lang : '') + absolute);
          else $(node).attr(attribute, assets[absolute] || optimized[absolute] || absolute);
        }
      });
      $('img').attr('decoding', 'async');
      $('head link[rel="canonical"], head link[rel="alternate"][hreflang]').remove();
      $('head').append('<link rel="canonical" href="' + origin + '/' + language + '/' + file + '">');
      if (preview || process.env.STAGING_MODE === 'true' || privatePages.has(file)) $('meta[name="robots"]').remove(), $('head').append('<meta name="robots" content="noindex, nofollow">');
      else {
        for (const alternate of ['fr', 'en', 'ar']) $('head').append('<link rel="alternate" hreflang="' + alternate + '" href="' + origin + '/' + alternate + '/' + file + '">');
        $('head').append('<link rel="alternate" hreflang="x-default" href="' + origin + '/fr/' + file + '">');
        if (lang) urls.push(origin + '/' + lang + '/' + file);
      }
      const names = { en: 'Modest fashion', fr: 'Mode modeste', ar: 'أزياء محتشمة' };
      if (file === 'index.html') $('title').text('Hanna & Nour | ' + names[language]);
      const title = $('h1').first().text().trim();
      if (title && file !== 'index.html') $('title').text(title + ' | Hanna & Nour');
      $('meta[property="og:locale"]').attr('content', { fr: 'fr_FR', en: 'en_US', ar: 'ar_AR' }[language]);
      $('meta[property="og:url"]').attr('content', origin + '/' + language + '/' + file);
      $('meta[property="og:title"]').attr('content', $('title').text());
      const folder = path.join('dist', lang || '');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, file), $.html());
    }
  }
  await fs.writeFile('dist/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(url => '<url><loc>' + url + '</loc></url>').join('') + '</urlset>');
  await fs.writeFile('dist/robots.txt', preview || process.env.STAGING_MODE === 'true' ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml\n');
  let headers = await fs.readFile('public/_headers', 'utf8');
  if (process.env.SUPABASE_URL) headers = headers.replace(/img-src [^;]+;/, "img-src 'self' data: blob: " + new URL(process.env.SUPABASE_URL).origin + ';');
  await fs.writeFile('dist/_headers', headers + '\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  console.log('Build terminé : pages FR/EN/AR, assets versionnés et images WebP dans dist/.');
}
module.exports = { prepareLivePage, prepareNetlifyImages };
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
