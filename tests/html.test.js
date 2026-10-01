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
