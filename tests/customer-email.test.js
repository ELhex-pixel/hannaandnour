const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { message, orderLocale } = require('../netlify/functions/lib/customer-email');
const translations = require('../public/js/i18n');
const order = { id:'order-local', order_number:'HN-LOCAL', customer_name:'<img onerror="unsafe">', currency:'eur', subtotal_cents:2400, discount_cents:240, shipping_cents:699, tax_cents:432, total_cents:3291, address1:'<script>unsafe</script>', city:'Paris', country:'FR', shipping_method:'standard', cart_restore_token:'a'.repeat(48) };

test('tous les emails clients sont localisés FR/EN/AR, échappés et les valeurs techniques restent lisibles', () => {
  for (const lang of ['fr','en','ar']) for (const type of ['paid','shipped','review','cancel','refund','cart','pending','recovery','claim']) {
    const mail = message(type, lang, { order, items:[{ product_name:'<img onerror="unsafe">', product_slug:'veste', quantity:2, unit_price_cents:1200 }], siteUrl:'https://example.test', code:'123456', href:'https://project.example.test/verify?token=test&type=recovery', tracking:'TRACK-123', amount_cents:1200, currency:'eur', reason:'other', comment:'<img onerror="unsafe">' });
    const $ = cheerio.load(mail.html);
    assert.equal($('html').attr('lang'), lang);
    assert.equal($('html').attr('dir'), lang === 'ar' ? 'rtl' : 'ltr');
    assert.equal($('h1').text(), translations[lang].brandName);
    assert.equal($('script,[onerror]').length, 0);
    assert.match(mail.subject, lang === 'ar' ? /هناء و نور/ : /Hanna & Nour/);
    if (lang === 'ar') assert.doesNotMatch($('h2').text(), /[A-Za-z]/);
    if (type === 'review') assert.equal($('a').first().attr('href'), 'https://example.test/' + lang + '/review.html?slug=veste&order=HN-LOCAL');
    if (type === 'cart' || type === 'pending') assert.equal($('a').first().attr('href'), 'https://example.test/' + lang + '/cart.html?restore=' + order.cart_restore_token);
    if (type === 'recovery') assert.equal($('a').first().attr('href'), 'https://project.example.test/verify?token=test&type=recovery');
    if (type === 'refund') assert.match($('[dir="ltr"]').text(), /12.00 EUR/);
    if (type === 'paid') assert.match($('table').text(), /32.91 EUR/);
  }
});
test('la langue des emails vient uniquement de la bonne commande Stripe, les anciennes restent FR', async () => {
  const old = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'local-test-only';
  try {
    const session = lang => ({ metadata:{ order_id:order.id, lang } });
    assert.equal(await orderLocale(order, session('ar'), () => assert.fail('No read needed')), 'ar');
    assert.equal(await orderLocale(order), 'fr');
    let reads = 0;
    const stored = { ...order, stripe_session_id:'cs_local' };
    assert.equal(await orderLocale(stored, null, async id => { reads++; assert.equal(id,'cs_local'); return session('en'); }), 'en');
    assert.equal(reads, 1);
    assert.equal(await orderLocale(stored, null, async () => ({ metadata:{ order_id:'another-order', lang:'ar' } })), 'fr');
    assert.equal(await orderLocale(stored, null, async () => session('<script>')), 'fr');
    assert.equal(await orderLocale(stored, null, async () => ({})), 'fr');
  } finally { if (old === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = old; }
});
test('la marque arabe exacte est cohérente dans tous les textes de l’interface', () => {
  assert.equal(translations.ar.brandName, 'هناء و نور');
  for (const text of Object.values(translations.ar)) assert.doesNotMatch(text, /حنا ونور|هناء ونور|Hanna.*Nour/);
  assert.match(message('claim', '<script>', { code:'123456' }).subject, /Hanna & Nour/);
});
