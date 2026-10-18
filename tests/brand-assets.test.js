const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const cheerio = require('cheerio');
const { buildBrandAssets, brandIcons, LOGO } = require('../scripts/brand-assets');
const { staticMetadata } = require('../scripts/seo');

test('le logo 4K et les icônes sont générés depuis des tracés vectoriels autonomes', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hn-brand-'));
  try {
    await fs.mkdir(path.join(folder, 'images'));
    const vector = await fs.readFile('public/images/maison-hanna-nour-logo.svg', 'utf8');
    assert.match(vector, /Maison Hanna &amp; Nour/);
    assert.doesNotMatch(vector, /<text\b|<script\b|<image\b|@font-face|href=["']https?:/);
    await buildBrandAssets(folder);
    const full = await sharp(path.join(folder, 'images/maison-hanna-nour-logo-4k.png')).metadata();
    assert.equal(full.width, 4096); assert.equal(full.height, 4096); assert.equal(full.hasAlpha, true);
    for (const size of [96, 180, 192]) {
      const meta = await sharp(path.join(folder, 'images/maison-hanna-nour-icon-' + size + '.png')).metadata();
      assert.equal(meta.width, size); assert.equal(meta.height, size);
    }
    const ico = await fs.readFile(path.join(folder, 'favicon.ico'));
    assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 3);
    for (const [i, size] of [16, 32, 48].entries()) {
      const entry = 6 + i * 16;
      assert.equal(ico[entry], size);
      const png = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
      assert.equal((await sharp(png).metadata()).width, size);
    }
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('les icônes sont explicites et stables, sans doublon ni remplacement de l’icône Stock installée', () => {
  const $ = cheerio.load('<head><link rel="icon" type="image/svg+xml" href="/images/favicon.svg"><link rel="apple-touch-icon" href="/images/stock-icon-192.png"></head>');
  brandIcons($); brandIcons($);
  assert.equal($('link[rel=icon]').length, 3);
  assert.equal($('link[rel="shortcut icon"]').attr('href'), '/favicon.ico');
  assert.equal($('link[rel=icon][sizes="96x96"]').attr('href'), '/images/maison-hanna-nour-icon-96.png');
  assert.equal($('link[rel="apple-touch-icon"]').attr('href'), '/images/stock-icon-192.png');
  assert.equal($('link[rel="apple-touch-icon"]').length, 1);
  const other = cheerio.load('<head></head>'); brandIcons(other);
  assert.equal(other('link[rel="apple-touch-icon"]').attr('sizes'), '180x180');
});

test('le logo de l’organisation pointe vers le nouveau fichier sur chaque domaine et langue', () => {
  for (const lang of ['fr', 'en', 'ar']) {
    const $ = cheerio.load('<head><title>Accueil</title><script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":"old"},{"@type":"WebSite"}]}</script></head>');
    staticMetadata($, 'https://example.test', 'index.html', lang);
    assert.equal(JSON.parse($('script[type="application/ld+json"]').text())['@graph'][0].logo, 'https://example.test' + LOGO);
  }
});
