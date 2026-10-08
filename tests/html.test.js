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
  assert.equal($('#colorsAddHex').attr('type'), 'color');
  assert.equal($('#colorsCustomToggle').attr('type'), 'checkbox');
  assert.equal($('#colorsAddInput').attr('maxlength'), '80');
  assert($('#colorsAddHex').attr('aria-label'));
  assert.equal($('#returnPolicyDays').attr('min'), '0');
  assert.equal($('#returnPolicyDays').attr('value'), '0');
  assert($('#setReturns').is('[readonly]'));
  assert($('#deleteSelectedProducts').text().includes('Supprimer définitivement'));
  assert($('#clearProductSelection').text().includes('Désélectionner'));
  assert($('#inventoryMode').is('[required]'));
  assert.equal($('#inventoryMode option').first().attr('value'),'');
  assert.equal($('#inventoryPreview').attr('role'),'status');
  assert.equal($('#sizeChoice').length,0);
  assert.equal($('#f-sizes').attr('type'),'hidden');
  assert.equal($('#f-sizes').parents('#productStockSection').length,1);
  for(const id of ['sizeTags','sizeCustom','addCustomSize']) assert.equal($('#'+id).length,0);
});
test('la CSP autorise les images locales de compression sans ouvrir scripts ni connexions', () => {
  const headers=fs.readFileSync('public/_headers','utf8');
  const policy=headers.split('\n').find(line=>line.includes('Content-Security-Policy:'));
  const directives=policy.split(': ').slice(1).join(': ').split(';').map(value=>value.trim());
  assert(directives.includes("img-src 'self' data: blob: https://rqgoawbzbgzuvpxnzxsu.supabase.co"));
  assert(directives.includes("script-src 'self'"));
  assert(directives.includes("connect-src 'self'"));
  assert(directives.filter(value=>value.includes('blob:')).every(value=>value.startsWith('img-src ')));
  const build=fs.readFileSync('scripts/build.js','utf8');
  const replacement=build.split('\n').find(line=>line.includes('headers = headers.replace'));
  const generated=require('node:vm').runInNewContext('var headers='+JSON.stringify(headers)+';'+replacement+';headers',{ process:{env:{SUPABASE_URL:'https://images.example.test'}},URL });
  assert(generated.includes("img-src 'self' data: blob: https://images.example.test;"));
  assert(!generated.includes('rqgoawbzbgzuvpxnzxsu.supabase.co'));
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
test('le guide des tailles ne contient aucune mesure ni recommandation de démonstration et possède ses champs admin', () => {
  const $=cheerio.load(fs.readFileSync('public/product.html','utf8'));
  const guide=$('#sizeGuideModal');
  assert.equal(guide.find('table').length,0);
  assert.doesNotMatch(guide.text(),/180cm|70cm|200cm|75cm|220cm|90cm|Classic drape/);
  assert.equal($('#sizeGuideMeasurements').is('[hidden]'),true);
  const admin=cheerio.load(fs.readFileSync('public/admin.html','utf8'));
  assert.equal(admin('#productSizeGuideSection').length,1);
  for(const field of ['fit','measurements']) for(const lang of ['fr','en','ar']) {
    assert.equal(admin('#f-'+field+'_'+lang).attr('maxlength'),'2000');
    assert.equal(admin('label[for="f-'+field+'_'+lang+'"]').length,1);
  }
  const dict=require('../public/js/i18n');
  for(const lang of ['fr','en','ar']) assert(dict[lang].sgUnspecified);
});
test('les cinq pages publiées commencent par des blocs neutres sans fiches, panier ou prix démo', () => {
  const { prepareLivePage } = require('../scripts/build');
  for (const file of ['index.html','shop.html','product.html','cart.html','checkout.html']) {
    const $ = cheerio.load(fs.readFileSync('public/'+file,'utf8'));
    prepareLivePage($,file);
    assert.equal($('body').attr('data-live-page'),file);
    assert($('[aria-busy="true"]').length > 0,file);
    assert($('.live-skeleton-card, .live-skeleton-row').length > 0,file);
    assert.equal($('.product-card, .cart-item').length,0,file);
    assert.equal($('a[href*="slug=silk-hijab"], a[href*="slug=flowing-abaya"], a[href*="slug=prayer-set"]').length,0,file);
    if (file === 'shop.html') {
      assert.equal($('.shop-results').text(),'');
      assert($('#loadMore').is('[hidden][disabled]'));
      assert.equal($('.filter-count').text(),'');
    }
    if (file === 'cart.html' || file === 'checkout.html') {
      const prefix = file === 'cart.html' ? 'cart' : 'checkout';
      assert.equal($('[id^="'+prefix+'Summary"]').text(),'');
      assert.equal($('.cart-items img, .checkout-items img').length,0);
    }
    if (file === 'cart.html') assert.equal($('.cart-checkout a').attr('aria-disabled'),'true');
    if (file === 'checkout.html') {
      assert($('#placeOrderBtn').is('[disabled]'));
      assert.equal($('.payment-method[data-method] strong').text(),'');
    }
    if (file === 'product.html') {
      assert.equal($('[data-product-content][hidden][inert]').length,2);
      assert.equal($('#mainImage').attr('src'),undefined);
      assert.equal($('.product-price, .product-short-desc, #tab-description ul, #tab-fabric ul').text(),'');
      assert.equal($('.color-option, .size-option').length,0);
      assert.equal($('.product-title').attr('data-i18n'),undefined);
      assert.equal($('.product-category').attr('data-i18n'),undefined);
      assert($('#addToCartBtn, #buyNowBtn').toArray().every(node=>$(node).is('[disabled]')));
    }
    if (file === 'index.html') assert.equal($('#testimonialsSection').css('display'),'none');
  }
  const $ = cheerio.load(fs.readFileSync('public/admin.html','utf8'));
  const original = $.html(); prepareLivePage($,'admin.html'); assert.equal($.html(),original);
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
