const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

test('chaque onglet admin possède un panneau et chaque id est unique', () => {
  const $ = cheerio.load(fs.readFileSync('public/admin.html', 'utf8'));
  $('.admin-tab').each((_, node) => assert.equal($('#panel-' + $(node).attr('data-tab')).length, 1));
  const ids = new Set();
  $('[id]').each((_, node) => { const id = $(node).attr('id'); assert(!ids.has(id), id); ids.add(id); });
});
test('les scripts locaux existent et les dépendances admin sont ordonnées', () => {
  for (const file of fs.readdirSync('public').filter(file => file.endsWith('.html'))) {
    const $ = cheerio.load(fs.readFileSync(path.join('public', file), 'utf8'));
    $('script[src]').each((_, node) => { const src = $(node).attr('src'); assert(fs.existsSync(path.join('public', src.replace(/^\//, ''))), file + ': ' + src); });
  }
  const $ = cheerio.load(fs.readFileSync('public/admin.html', 'utf8'));
  const scripts = $('script[src]').map((_, node) => $(node).attr('src')).get();
  assert(scripts.indexOf('js/admin-api.js') < scripts.indexOf('js/admin.js'));
  assert(scripts.indexOf('js/admin.js') < scripts.indexOf('js/admin-features.js'));
});
test('le domaine et l’email de la boutique sont cohérents dans les sources publiées', () => {
  function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : /\.(html|js|xml|txt)$/.test(file) ? [file] : [];
    });
  }
  for (const file of [...['public', 'netlify/functions', 'scripts'].flatMap(files), '.env.example', 'SETUP.md']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /care@hannaandnour\.com|hannanour\.netlify\.app/, file);
  }
  const $ = cheerio.load(fs.readFileSync('public/contact.html', 'utf8'));
  const links = $('a[href^="mailto:"]').map((_, node) => $(node).attr('href')).get();
  assert(links.length > 0);
  assert(links.every(href => href === 'mailto:care@hannanour.com'));
  const dict = require('../public/js/i18n');
  for (const lang of ['fr', 'en', 'ar']) {
    assert.equal(dict[lang].footerWebsite, 'hannanour.com');
    assert(dict[lang].sgFooter.includes('care@hannanour.com'));
  }
  const home = cheerio.load(fs.readFileSync('public/index.html', 'utf8'));
  assert.equal(home('link[rel="canonical"]').attr('href'), 'https://hannanour.com/index.html');
  const data = JSON.parse(home('script[type="application/ld+json"]').first().html());
  assert.equal(data['@graph'][0].url, 'https://hannanour.com/');
  assert.equal(data['@graph'][1].url, 'https://hannanour.com/');
});
