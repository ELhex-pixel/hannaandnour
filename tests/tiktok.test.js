const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { cleanMetadata, productRows, adminTiktok } = require('../netlify/functions/lib/tiktok');
const xlsx = require('../public/js/tiktok-xlsx');
const commerce = require('../public/js/commerce');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
global.DOMParser = DOMParser;
global.XMLSerializer = XMLSerializer;
const id = '11111111-1111-4111-8111-111111111111';
const category = 'Hauts pour femmes/T-shirts';
const config = { currency: { code: 'eur' }, shipping: { ...commerce.defaults, tax_rate: 0.2 } };
const metadata = { category, parcel_weight: '250', parcel_length: '20', parcel_width: '15', parcel_height: '5', manufacturer_ids: 'manufacturer-id', rp_ids: 'responsible-id', packaging_safety: 'Non', extra: {} };
const product = { id, name_fr: 'T-shirt coton', description_fr: 'T-shirt avec manches courtes.', price_cents: 1999, image: 'https://example.com/photo.jpg', gallery: [], active: true, product_variants: [
  { id: 'a', color: 'Noir', size: 'M', barcode: 'HN0000001', stock: 3, active: true },
  { id: 'b', color: 'Noir', size: 'L', barcode: 'HN0000002', stock: 0, active: true },
  { id: 'c', color: 'Blanc', size: 'M', barcode: 'HN0000003', stock: 99, active: false }
] };

test('export TikTok : prix TTC issu des règles du checkout, sans port ni promo', () => {
  const rows = productRows(product, metadata, config);
  const quoted = commerce.calculate([{ price_cents: 1999, qty: 1 }], config.shipping, 'standard', 0);
  assert.equal(rows[0].price * 100, quoted.subtotal + quoted.tax);
  assert.equal(rows[0].price, 23.99);
  assert.equal(rows[0].parcel_weight, 250);
  assert.equal(rows[0]['product_property/102277'], 'Non');
});

test('export TikTok : une ligne par variante active, stock 0 conservé, SKU interne et aucun GTIN inventé', () => {
  const before = JSON.stringify(product);
  const rows = productRows(product, metadata, config);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.quantity), [3, 0]);
  assert.equal(rows[0].seller_sku, 'HN0000001');
  assert.equal(rows[0].gtin_code, undefined);
  assert.equal(rows[0].property_value_1, 'Noir');
  assert.equal(rows[0].property_value_2, 'M');
  assert.equal(JSON.stringify(product), before);
  assert(productRows({ ...product, active: false }, metadata, config).every(row => row.quantity === 0));
});

test('export TikTok : EUR obligatoire, stock illimité interdit, valeurs hors limites refusées', () => {
  assert.throws(() => productRows(product, metadata, { ...config, currency: { code: 'usd' } }), /EUR/);
  assert.throws(() => productRows({ ...product, product_variants: [] }, metadata, config), /Stock par variante/);
  assert.throws(() => productRows({ ...product, price_cents: 630000 }, metadata, config), /Prix TTC/);
  assert.throws(() => productRows({ ...product, product_variants: [{ ...product.product_variants[0], stock: 0.5 }] }, metadata, config), /Stock TikTok/);
  assert.throws(() => productRows({ ...product, image: 'https://example.com/photo.webp' }, metadata, config), /JPG ou PNG/);
  assert.throws(() => productRows({ ...product, image: 'https://user:password@example.com/photo.jpg' }, metadata, config), /HTTPS publique/);
  assert.throws(() => cleanMetadata({ ...metadata, parcel_weight: '-1' }), /Mesure/);
  assert.throws(() => cleanMetadata({ ...metadata, extra: { price: '0' } }), /Attribut/);
  assert.throws(() => cleanMetadata({ ...metadata, extra: { 'qualification/123': 'a'.repeat(4001) } }), /Attribut/);
});

function sbMock() {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = {
        select(value) { calls.push(['select', table, value]); return q; },
        in(key, values) { calls.push(['in', table, key, values]); return q; },
        eq(key, value) { calls.push(['eq', table, key, value]); return q; },
        maybeSingle() { return Promise.resolve({ data: { id } }); },
        upsert(value) { calls.push(['write', table, value]); return Promise.resolve({ error: null }); },
        then(resolve, reject) {
          const data = table === 'products' ? [product] : calls.some(c => c[0] === 'in' && c[1] === table && c[3][0] === 'shipping') ? [{ key: 'shipping', value: config.shipping }, { key: 'currency', value: config.currency }] : [{ key: 'tiktok:' + id, value: metadata }];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return q;
    }
  };
}

test('API TikTok : prix/stock relus en base, les valeurs du navigateur sont ignorées, aucune écriture', async () => {
  const sb = sbMock();
  const res = await adminTiktok(sb, 'exportTiktokProducts', { ids: [id], price: 0, quantity: 999999 });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.rows[0].price, 23.99);
  assert.equal(body.rows[0].quantity, 3);
  assert.equal(sb.calls.filter(c => c[0] === 'write').length, 0);
  assert(!res.body.includes('customer'));
});

test('API TikTok : informations privées dans settings, identifiants et attributs bornés', async () => {
  const sb = sbMock();
  assert.equal((await adminTiktok(sb, 'saveTiktokMetadata', { id, metadata })).statusCode, 200);
  assert.equal(sb.calls.find(c => c[0] === 'write')[2].key, 'tiktok:' + id);
  assert.equal((await adminTiktok(sb, 'saveTiktokMetadata', { id: 'bad', metadata })).statusCode, 400);
  assert.equal((await adminTiktok(sb, 'exportTiktokProducts', { ids: [id, id] })).statusCode, 400);
  assert.equal((await adminTiktok(sb, 'exportTiktokProducts', { ids: [] })).statusCode, 400);
});

test('les actions TikTok exigent une session admin et respectent la limite de débit avant toute lecture', async () => {
  for (const action of ['getTiktokMetadata', 'saveTiktokMetadata', 'exportTiktokProducts']) {
    for (const allowed of [false, true]) {
      const exports = {}, state = { accesses: 0, limited: 0 };
      const shared = {
        json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
        getSupabase: () => ({}), isConfigured: () => true, readBody: event => JSON.parse(event.body),
        requireAdmin: async () => ({ ok: allowed }), rateLimit: async () => { state.limited++; return { statusCode: 429 }; }
      };
      vm.runInNewContext(fs.readFileSync('netlify/functions/admin.js', 'utf8'), { exports, console, process: { env: {} }, require: name => {
        if (name === './shared') return shared;
        if (name === 'crypto') return crypto;
        if (name === 'stripe') return class Stripe {};
        if (name === './lib/tiktok') return { adminTiktok: async () => { state.accesses++; } };
        throw new Error('Unexpected require');
      } });
      const response = await exports.handler({ httpMethod: 'POST', body: JSON.stringify({ action }) });
      assert.equal(response.statusCode, allowed ? 429 : 401);
      assert.equal(state.accesses, 0);
      assert.equal(state.limited, allowed ? 1 : 0);
    }
  }
});

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const labels = { A: 'Catégorie', C: 'Nom du produit', D: 'Description', E: 'Image principale', N: 'Type GTIN', O: 'GTIN', P: 'Variante principale', Q: 'Option principale', S: 'Variante secondaire', T: 'Option secondaire', U: 'Poids', V: 'Longueur', W: 'Largeur', X: 'Hauteur', Z: 'Prix', AA: 'Quantité', AB: 'UGS', AG: 'Fabricant', AH: 'Responsable', AX: 'Sécurité', AS: 'Hauteur de la taille' };
const keys = { A: 'category', C: 'product_name', D: 'product_description', E: 'main_image', N: 'gtin_type', O: 'gtin_code', P: 'property_name_1', Q: 'property_value_1', S: 'property_name_2', T: 'property_value_2', U: 'parcel_weight', V: 'parcel_length', W: 'parcel_width', X: 'parcel_height', Z: 'price', AA: 'quantity', AB: 'seller_sku', AG: 'manufacturer_ids', AH: 'rp_ids', AX: 'product_property/102277', AS: 'product_property/100403' };
const required = Object.fromEntries(['C', 'D', 'E', 'U', 'V', 'W', 'X', 'Z', 'AA', 'AG', 'AH', 'AX'].map(col => [col, 'Mandatory']));
function esc(text) { return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function row(number, cells) { return '<row r="' + number + '">' + Object.entries(cells).map(([col, value]) => '<c r="' + col + number + '" t="inlineStr"><is><t>' + esc(value) + '</t></is></c>').join('') + '</row>'; }
function sheet(content, tail = '') { return '<worksheet xmlns="' + NS + '"><dimension ref="A1:AX5000"/><sheetData>' + content + '</sheetData>' + tail + '</worksheet>'; }
async function fixture(overrides = {}) {
  const names = ['Template', 'TemplateConfig', 'Category', 'HiddenStyle', 'HiddenAttr', 'Brand'];
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<workbook xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((name, i) => '<sheet name="' + name + '" sheetId="' + (i + 1) + '" r:id="r' + i + '"' + (i ? ' state="hidden"' : '') + '/>').join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((_, i) => '<Relationship Id="r' + i + '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>',
    'xl/worksheets/sheet1.xml': sheet(row(1, keys) + row(3, labels) + row(6, { C: 'Exemple TikTok' }) + '<row r="7"><c r="A7" s="2" t="inlineStr"><is><t>' + category + '</t></is></c><c r="Z7" s="3"/></row>', '<dataValidations count="4"><dataValidation type="whole" operator="between" sqref="AA7:AA5000"><formula1>0</formula1><formula2>999999</formula2></dataValidation><dataValidation type="decimal" operator="between" sqref="Z7:Z5000"><formula1>0.01</formula1><formula2>6300</formula2></dataValidation><dataValidation type="list" sqref="AG7:AG5000"><formula1>"Fabricant (ID: manufacturer-id)"</formula1></dataValidation><dataValidation type="list" sqref="AX7:AX5000"><formula1>OFFSET(HiddenAttr!$B$1,MATCH($A$7,HiddenAttr!$A$1:$A$2,0)-1,0,COUNTIF(HiddenAttr!$A:$A,$A$7))</formula1></dataValidation></dataValidations>'),
    'xl/worksheets/sheet2.xml': sheet(row(2, { B: 'create_product', C: 'metric' })),
    'xl/worksheets/sheet3.xml': sheet(row(1, { A: category, B: '601302' })),
    'xl/worksheets/sheet4.xml': sheet(row(1, { A: category, ...required, AS: 'Forbid' })),
    'xl/worksheets/sheet5.xml': sheet(row(1, { A: category, B: 'Oui' }) + row(2, { A: category, B: 'Non' })),
    'xl/worksheets/sheet6.xml': sheet(row(1, { A: 'Aucune marque' })),
    'xl/styles.xml': '<styleSheet xmlns="' + NS + '"/>',
    'xl/media/photo.png': 'untouched-binary'
  };
  Object.assign(files, overrides);
  const entries = Object.fromEntries(Object.entries(files).map(([name, text]) => {
    const bytes = new TextEncoder().encode(text);
    return [name, { name, method: 0, packed: bytes, size: bytes.length, crc: xlsx.crc(bytes) }];
  }));
  return new Uint8Array(await (await xlsx.writeZip(entries)).arrayBuffer());
}

test('XLSX : lecture des onglets cachés et obligations spécifiques, GTIN facultatif', async () => {
  const template = await xlsx.inspect(await fixture());
  assert.deepEqual(template.categories, [category]);
  assert.equal(template.rules[category].AG, 'Mandatory');
  assert.equal(template.rules[category].N, undefined);
  assert.equal(template.styles.Z, '3');
  const rows = xlsx.validateRows(template, productRows(product, metadata, config));
  assert.equal(rows[0].manufacturer_ids, 'Fabricant (ID: manufacturer-id)');
  assert.equal(rows[0].gtin_code, undefined);
});

test('XLSX : obligations manquantes, mauvaise catégorie, attribut interdit et doublon bloquent l’export', async () => {
  const template = await xlsx.inspect(await fixture()), rows = productRows(product, metadata, config);
  assert.throws(() => xlsx.validateRows(template, [{ ...rows[0], parcel_weight: undefined, manufacturer_ids: '' }]), /Poids obligatoire/);
  assert.throws(() => xlsx.validateRows(template, [{ ...rows[0], category: 'Hijabs' }]), /catégorie incompatible/);
  assert.throws(() => xlsx.validateRows(template, [{ ...rows[0], 'product_property/100403': 'Haute' }]), /interdit/);
  assert.throws(() => xlsx.validateRows(template, [rows[0], rows[0]]), /dupliquée/);
  assert.throws(() => xlsx.validateRows(template, [{ ...rows[0], quantity: -1 }]), /hors limites/);
  assert.throws(() => xlsx.validateRows(template, [{ ...rows[0], manufacturer_ids: 'inventé' }]), /liste TikTok/);
  assert.throws(() => xlsx.validateRows(template, [{ ...rows[0], 'product_property/102277': 'inconnu' }]), /liste TikTok/);
});

test('XLSX rempli : structure, métadonnées et validations préservées ; variantes, prix, quantité 0 et textes sûrs', async () => {
  const template = await xlsx.inspect(await fixture());
  const rows = productRows({ ...product, description_fr: '=HYPERLINK("https://example.com") & <texte>' }, metadata, config);
  const blob = await xlsx.fill(template, rows), bytes = new Uint8Array(await blob.arrayBuffer()), result = await xlsx.inspect(bytes);
  assert(blob.size < xlsx.maxFile);
  assert.equal(result.data.Template[7].AA, '3');
  assert.equal(result.data.Template[8].AA, '0');
  assert.equal(result.data.Template[7].Z, '23.99');
  assert.equal(result.data.Template[7].AB, 'HN0000001');
  assert.equal(result.data.Template[7].D, rows[0].product_description);
  assert.equal(result.data.Template[6].C, 'Exemple TikTok');
  assert.equal(result.docs.Template.getElementsByTagNameNS(NS, 'f').length, 0);
  assert.equal(result.docs.Template.getElementsByTagNameNS(NS, 'dataValidation').length, template.validations.length);
  for (const name of Object.keys(template.entries).filter(name => name !== template.sheets.Template)) {
    assert.deepEqual(result.entries[name].packed, template.entries[name].packed, name);
    assert.equal(result.entries[name].crc, template.entries[name].crc, name);
  }
  assert.equal(template.data.Template[8], undefined);
});

test('XLSX : fichier incorrect, ZIP chiffré, archives démesurées et corruption sont refusés', async () => {
  assert.throws(() => xlsx.readZip(new Uint8Array(xlsx.maxFile + 1)), /20 Mo/);
  assert.throws(() => xlsx.readZip(new Uint8Array(30)), /invalide/);
  const bytes = await fixture();
  const entries = xlsx.readZip(bytes);
  entries['xl/workbook.xml'].crc = 0;
  await assert.rejects(xlsx.entryBytes(entries['xl/workbook.xml']), /corrompu/);
  const modified = bytes.slice(), view = new DataView(modified.buffer);
  const end = modified.length - 22, start = view.getUint32(end + 16, true);
  view.setUint32(start + 24, 51 * 1024 * 1024, true);
  assert.throws(() => xlsx.readZip(modified), /50 Mo/);
  view.setUint32(start + 24, 1, true); view.setUint16(start + 8, 1, true);
  assert.throws(() => xlsx.readZip(modified), /invalide/);
});

test('XLSX : macros, traversée de chemin, liens externes, XML avec DTD et mauvais type de modèle refusés', async () => {
  await assert.rejects(xlsx.inspect(await fixture({ 'xl/vbaProject.bin': 'bad' })), /invalide/);
  assert.throws(() => xlsx.readZip(new Uint8Array()), /20 Mo/);
  await assert.rejects(xlsx.inspect(await fixture({ '../evil': 'bad' })), /invalide/);
  await assert.rejects(xlsx.inspect(await fixture({ 'xl/workbook.xml': '<!DOCTYPE workbook><workbook/>' })), /Déclarations XML/);
  await assert.rejects(xlsx.inspect(await fixture({ 'xl/worksheets/sheet2.xml': sheet(row(2, { B: 'edit_product', C: 'metric' })) })), /création/);
});
