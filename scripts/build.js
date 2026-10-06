const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const cheerio = require('cheerio');
const sharp = require('sharp');
const translations = require('../public/js/i18n');
const { preflight } = require('./preflight');

async function build() {
  const preview = process.env.CONTEXT === 'deploy-preview' || process.env.CONTEXT === 'branch-deploy';
  if (preview && process.env.STAGING_MODE !== 'true') throw new Error('Preview désactivée : configurez un environnement staging isolé avant de déployer.');
  if ((preview || process.env.STAGING_MODE === 'true') && (!process.env.EXPECTED_STAGING_SUPABASE_URL || !process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL === process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL !== process.env.EXPECTED_STAGING_SUPABASE_URL || !String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'))) throw new Error('Le staging exige sa propre base Supabase, une PRODUCTION_SUPABASE_URL distincte et une clé Stripe test.');
  await preflight();
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
  if (process.env.SUPABASE_URL) headers = headers.replace(/img-src 'self' data: [^;]+;/, "img-src 'self' data: " + new URL(process.env.SUPABASE_URL).origin + ';');
  await fs.writeFile('dist/_headers', headers + '\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n');
  console.log('Build terminé : pages FR/EN/AR, assets versionnés et images WebP dans dist/.');
}
build().catch(error => { console.error(error.message); process.exitCode = 1; });
