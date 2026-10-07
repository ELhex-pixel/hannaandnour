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
test('l’admin modernisé conserve les rubriques et isole les opérations sensibles', () => {
  const $ = cheerio.load(fs.readFileSync('public/admin.html', 'utf8'));
  assert.equal($('body.admin-page').length, 1);
  assert.equal($('.admin-sidebar nav[aria-label] .admin-tab').length, 14);
  assert.equal($('.admin-workspace > .admin-panel').length, 14);
  assert.equal($('#scanPrepare').parents('#panel-preparation').length, 1);
  assert.equal($('#inventoryForm').parents('#panel-inventory').length, 1);
  for (const id of ['resetStockBtn', 'resetAllBtn']) assert.equal($('#' + id).parents('details.admin-danger-zone').length, 1);
  assert($('#fileGallery').is('[multiple]'));
  assert.equal($('#autoDescribePhoto').is('[checked]'), false);
  assert.equal($('#productEditor').attr('role'), 'dialog');
  $('[data-editor-section]').each((_, node) => assert.equal($('#' + $(node).attr('data-editor-section')).parents('#productEditor').length, 1));
  assert($('#deleteProductBtn').text().includes('Archiver'));
  for (const id of ['filterProducts', 'filterCategory', 'filterProductVisibility']) assert($('#' + id).attr('aria-label'));
  for (const id of ['f-price', 'f-compare', 'f-image']) assert.equal($('label[for="' + id + '"]').length, 1);
  for (const id of ['activateSelectedProducts', 'archiveSelectedProducts', 'clearProductSelection']) {
    assert.equal($('#' + id).parents('.admin-bulk-bar').length, 1);
    assert($('#' + id).is('[disabled]'));
    assert.equal($('#' + id).attr('type'), 'button');
  }
});
test('l’admin occupe la largeur disponible sans marge extérieure', () => {
  const css = fs.readFileSync('public/css/styles.css', 'utf8');
  const shell = css.match(/\.admin-page \.admin-shell\s*\{([^}]+)\}/);
  assert(shell);
  assert.match(shell[1], /max-width:\s*none\s*;/);
  assert.match(shell[1], /margin:\s*0\s*;/);
});
test('le compte sépare les services et conserve les ancres, labels et identifiants uniques', () => {
  const $ = cheerio.load(fs.readFileSync('public/account.html', 'utf8'));
  const ids = new Set();
  $('[id]').each((_, node) => { const id = $(node).attr('id'); assert(!ids.has(id), id); ids.add(id); });
  $('.account-nav-link').each((_, node) => {
    const href = $(node).attr('href');
    assert(href.startsWith('account.html#'));
    const target = href.slice(href.indexOf('#'));
    assert.equal($(target).length, 1);
    assert($(node).is('[data-account-private]'));
  });
  assert.equal($('#accountServices').parents('#accountPanel').length, 0);
  assert.equal($('#accountServices > section.account-card').length, 2);
  assert($('#accountServices').is('[hidden]'));
  for (const id of ['loginEmail', 'loginPassword', 'signupName', 'signupEmail', 'signupPassword', 'forgotEmail', 'orderFilterFrom', 'orderFilterTo']) {
    assert.equal($('#' + id).parents('label').length, 1, id);
  }
  for (const id of ['orders', 'guest-orders', 'returns', 'wishlist']) {
    assert.equal($('#' + $('#' + id).attr('aria-labelledby')).length, 1, id);
  }
  const dict = require('../public/js/i18n');
  $('[data-i18n], [data-i18n-aria-label]').each((_, node) => {
    const key = $(node).attr('data-i18n') || $(node).attr('data-i18n-aria-label');
    for (const lang of ['fr', 'en', 'ar']) assert(dict[lang][key], lang + ': ' + key);
  });
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
