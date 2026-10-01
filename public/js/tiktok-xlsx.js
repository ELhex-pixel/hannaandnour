(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_TIKTOK_XLSX = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var MAX_FILE = 20 * 1024 * 1024;
  var MAX_UNPACKED = 50 * 1024 * 1024;
  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var encoder = new TextEncoder();
  var decoder = new TextDecoder('utf-8', { fatal: true });
  var crcTable = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  function crc(bytes) {
    var value = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) value = crcTable[(value ^ bytes[i]) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
  function fail(message) { throw new Error(message || 'Modèle XLSX invalide ou non pris en charge'); }
  async function transform(bytes, compress, limit) {
    var stream;
    try { stream = compress ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'); }
    catch (error) { fail('Utilisez une version récente de Chrome, Edge ou Firefox pour traiter le fichier XLSX'); }
    var reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    var chunks = [], length = 0;
    try {
      for (;;) {
        var next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > limit) { await reader.cancel(); fail('Fichier XLSX trop volumineux après décompression'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    var output = new Uint8Array(length), offset = 0;
    chunks.forEach(function (chunk) { output.set(chunk, offset); offset += chunk.length; });
    return output;
  }
  function readZip(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE || bytes.length < 22) fail('Le fichier XLSX doit faire au maximum 20 Mo');
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var end = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail();
    var count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
    if (!count || count > 1000 || count !== view.getUint16(end + 8, true) || start + size !== end) fail();
    var entries = Object.create(null), pos = start, total = 0;
    for (i = 0; i < count; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail();
      var flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
      var packed = view.getUint32(pos + 20, true), unpacked = view.getUint32(pos + 24, true);
      var nameLength = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true);
      var local = view.getUint32(pos + 42, true);
      if (flags & 1 || ![0, 8].includes(method) || pos + 46 + nameLength + extra + comment > end || local + 30 > start || view.getUint16(pos + 34, true)) fail();
      var name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      if (!name || /(^\/|\\|(?:^|\/)\.\.(?:\/|$)|\x00)/.test(name) || entries[name] || /vbaProject|externalLinks/i.test(name)) fail();
      if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) & 1) fail();
      var localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
      var dataStart = local + 30 + localNameLength + localExtra;
      if (dataStart + packed > start || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) fail();
      total += unpacked;
      if (total > MAX_UNPACKED || unpacked > MAX_UNPACKED) fail('Le contenu décompressé du modèle dépasse 50 Mo');
      entries[name] = { name: name, method: method, crc: view.getUint32(pos + 16, true), size: unpacked, packed: bytes.slice(dataStart, dataStart + packed), time: view.getUint16(pos + 12, true), date: view.getUint16(pos + 14, true) };
      pos += 46 + nameLength + extra + comment;
    }
    if (pos !== end) fail();
    return entries;
  }
  async function entryBytes(entry) {
    if (!entry) fail('Onglet ou métadonnée manquante dans le modèle TikTok');
    var bytes = entry.method === 8 ? await transform(entry.packed, false, Math.min(entry.size, MAX_UNPACKED)) : entry.packed;
    if (bytes.length !== entry.size || crc(bytes) !== entry.crc) fail('Fichier XLSX corrompu');
    return bytes;
  }
  function xml(text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail('Déclarations XML interdites');
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) fail('XML du modèle invalide');
    return doc;
  }
  function nodes(element, name) { return Array.from(element.getElementsByTagNameNS(NS, name)); }
  function cellText(cell, strings) {
    var type = cell.getAttribute('t');
    if (type === 's') return strings[Number(nodes(cell, 'v')[0]?.textContent)] || '';
    if (type === 'inlineStr') return nodes(cell, 't').map(function (t) { return t.textContent; }).join('');
    return nodes(cell, 'v')[0]?.textContent || '';
  }
  function sheetRows(doc, strings) {
    var result = {};
    nodes(doc, 'row').forEach(function (row) {
      var cells = {};
      nodes(row, 'c').forEach(function (cell) { cells[cell.getAttribute('r').replace(/\d+$/, '')] = cellText(cell, strings); });
      result[Number(row.getAttribute('r'))] = cells;
    });
    return result;
  }
  async function inspect(bytes) {
    var entries = readZip(bytes);
    if (!entries['[Content_Types].xml']) fail();
    var strings = [];
    if (entries['xl/sharedStrings.xml']) strings = nodes(xml(decoder.decode(await entryBytes(entries['xl/sharedStrings.xml']))), 'si').map(function (si) { return nodes(si, 't').map(function (t) { return t.textContent; }).join(''); });
    var workbook = xml(decoder.decode(await entryBytes(entries['xl/workbook.xml'])));
    var rels = xml(decoder.decode(await entryBytes(entries['xl/_rels/workbook.xml.rels'])));
    var targets = {};
    Array.from(rels.getElementsByTagName('Relationship')).forEach(function (rel) {
      if (rel.getAttribute('TargetMode') === 'External') fail('Liens externes de classeur interdits');
      var target = rel.getAttribute('Target');
      if (/\.\.|\\/.test(target)) fail();
      targets[rel.getAttribute('Id')] = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    });
    var sheets = {};
    nodes(workbook, 'sheet').forEach(function (sheet) { sheets[sheet.getAttribute('name')] = targets[sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')]; });
    var docs = {}, data = {};
    for (var name of ['Template', 'TemplateConfig', 'Category', 'HiddenStyle', 'HiddenAttr', 'Brand']) {
      docs[name] = xml(decoder.decode(await entryBytes(entries[sheets[name]])));
      data[name] = sheetRows(docs[name], strings);
    }
    if (data.TemplateConfig[2]?.B !== 'create_product' || data.TemplateConfig[2]?.C !== 'metric') fail('Utilisez un modèle TikTok de création de produits en unités métriques');
    var columns = data.Template[1], labels = data.Template[3];
    if (!columns || columns.A !== 'category' || !Object.values(columns).includes('seller_sku') || !labels) fail('En-têtes TikTok non reconnus');
    var categories = Object.values(data.Category).map(function (row) { return row.A; }).filter(Boolean);
    if (!categories.length) fail('Aucune catégorie dans le modèle');
    var rules = {};
    Object.values(data.HiddenStyle).forEach(function (row) { if (row.A) rules[row.A] = row; });
    if (categories.some(function (category) { return !rules[category]; })) fail('Règles de catégorie manquantes dans le modèle TikTok');
    var styles = {};
    var initial = nodes(docs.Template, 'row').find(function (row) { return row.getAttribute('r') === '7'; });
    if (initial) nodes(initial, 'c').forEach(function (cell) { styles[cell.getAttribute('r').replace(/\d+$/, '')] = cell.getAttribute('s'); });
    var validations = nodes(docs.Template, 'dataValidation').filter(function (rule) { return /\b[A-Z]+7(?::|\b)/.test(rule.getAttribute('sqref')); });
    return { entries: entries, sheets: sheets, docs: docs, data: data, strings: strings, columns: columns, labels: labels, categories: categories, rules: rules, styles: styles, validations: validations };
  }
  function allowedValues(template, rule, category) {
    var formula = nodes(rule, 'formula1')[0]?.textContent || '';
    if (formula.startsWith('"') && formula.endsWith('"')) return formula.slice(1, -1).split(',');
    var range = formula.match(/^([A-Za-z]+)!\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)$/);
    if (range && template.data[range[1]]) return Object.entries(template.data[range[1]]).filter(function (entry) { return Number(entry[0]) >= Number(range[3]) && Number(entry[0]) <= Number(range[4]); }).map(function (entry) { return entry[1][range[2]]; }).filter(Boolean);
    var offset = formula.match(/^OFFSET\(HiddenAttr!\$([A-Z]+)\$1,MATCH\(\$A\$?7,HiddenAttr!\$([A-Z]+)\$/);
    if (offset) return Object.values(template.data.HiddenAttr).filter(function (row) { return row[offset[2]] === category; }).map(function (row) { return row[offset[1]]; }).filter(Boolean);
    return null;
  }
  function validateRows(template, rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 4994) fail('Sélectionnez entre 1 et 4 994 variantes');
    var errors = [], seen = new Set(), skus = new Set();
    var normalized = rows.map(function (source, index) {
      var row = Object.assign({}, source), prefix = 'Ligne ' + (index + 7) + ' (' + (row.seller_sku || '') + ') : ';
      function error(message) { if (errors.length < 30) errors.push(prefix + message); }
      if (!template.categories.includes(row.category) || !template.rules[row.category]) { error('catégorie incompatible avec le modèle'); return row; }
      var rules = template.rules[row.category];
      Object.entries(template.columns).forEach(function (entry) {
        var col = entry[0], key = entry[1], value = row[key], label = template.labels[col] || key;
        if (rules[col] === 'Mandatory' && (value === undefined || value === null || String(value).trim() === '')) error(label + ' obligatoire');
        if (rules[col] === 'Forbid' && value !== undefined && value !== '') error(label + ' interdit pour cette catégorie');
        if (String(value ?? '').length > 32000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(String(value ?? ''))) error(label + ' : texte invalide ou trop long');
      });
      for (var key of ['property_value_1', 'property_value_2']) if (row[key] && (!row[key.replace('value', 'name')] || String(row[key]).length > 50)) error('variante invalide');
      if (row.property_name_1 && !row.property_value_1 || row.property_name_2 && !row.property_value_2) error('option de variante manquante');
      var identity = JSON.stringify([row.product_name, row.property_value_1 || '', row.property_value_2 || '']);
      if (seen.has(identity)) error('variante dupliquée');
      seen.add(identity);
      if (!row.seller_sku || skus.has(row.seller_sku)) error('UGS vendeur manquante ou dupliquée');
      skus.add(row.seller_sku);
      template.validations.forEach(function (rule) {
        var col = rule.getAttribute('sqref').match(/^([A-Z]+)/)?.[1], field = template.columns[col], value = row[field];
        if (value === undefined || value === '') return;
        var type = rule.getAttribute('type'), f1 = nodes(rule, 'formula1')[0]?.textContent, f2 = nodes(rule, 'formula2')[0]?.textContent;
        if (type === 'list') {
          var allowed = allowedValues(template, rule, row.category);
          if (allowed?.length && !allowed.includes(String(value))) {
            var match = allowed.find(function (option) { return option.includes('(ID: ' + value + ')'); });
            if (match) row[field] = match;
            else error((template.labels[col] || field) + ' : valeur absente de la liste TikTok');
          }
        }
        if (type === 'decimal' || type === 'whole' || type === 'textLength') {
          var number = type === 'textLength' ? String(value).length : Number(value), operator = rule.getAttribute('operator');
          if (!Number.isFinite(number) || type === 'whole' && !Number.isInteger(number) || operator === 'between' && (number < Number(f1) || number > Number(f2)) || operator === 'greaterThan' && number <= Number(f1)) error((template.labels[col] || field) + ' hors limites TikTok');
        }
      });
      return row;
    });
    if (errors.length) fail(errors.join('\n'));
    return normalized;
  }
  async function writeZip(entries) {
    var values = Object.values(entries), parts = [], central = [], position = 0;
    for (var entry of values) {
      var name = encoder.encode(entry.name), local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true); lv.setUint16(8, entry.method, true);
      lv.setUint16(10, entry.time || 0, true); lv.setUint16(12, entry.date || 0, true); lv.setUint32(14, entry.crc, true);
      lv.setUint32(18, entry.packed.length, true); lv.setUint32(22, entry.size, true); lv.setUint16(26, name.length, true); local.set(name, 30);
      var header = new Uint8Array(46 + name.length), cv = new DataView(header.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(10, entry.method, true);
      cv.setUint16(12, entry.time || 0, true); cv.setUint16(14, entry.date || 0, true); cv.setUint32(16, entry.crc, true);
      cv.setUint32(20, entry.packed.length, true); cv.setUint32(24, entry.size, true); cv.setUint16(28, name.length, true); cv.setUint32(42, position, true); header.set(name, 46);
      parts.push(local, entry.packed); central.push(header); position += local.length + entry.packed.length;
    }
    var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, values.length, true); ev.setUint16(10, values.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, position, true);
    if (position + centralSize + 22 > MAX_FILE) fail('Le fichier exporté dépasse 20 Mo : réduisez la sélection');
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function fill(template, rows) {
    var normalized = validateRows(template, rows);
    var doc = xml(new XMLSerializer().serializeToString(template.docs.Template));
    var sheetData = nodes(doc, 'sheetData')[0];
    nodes(sheetData, 'row').filter(function (row) { return Number(row.getAttribute('r')) >= 7; }).forEach(function (row) { sheetData.removeChild(row); });
    normalized.forEach(function (values, index) {
      var row = doc.createElementNS(NS, 'row'), number = index + 7;
      row.setAttribute('r', number);
      Object.entries(template.columns).forEach(function (entry) {
        var col = entry[0], value = values[entry[1]];
        if (value === undefined || value === null || value === '') return;
        var cell = doc.createElementNS(NS, 'c'); cell.setAttribute('r', col + number);
        if (template.styles[col]) cell.setAttribute('s', template.styles[col]);
        if (typeof value === 'number') { var v = doc.createElementNS(NS, 'v'); v.textContent = String(value); cell.appendChild(v); }
        else {
          cell.setAttribute('t', 'inlineStr');
          var inline = doc.createElementNS(NS, 'is'), text = doc.createElementNS(NS, 't');
          text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve'); text.textContent = String(value); inline.appendChild(text); cell.appendChild(inline);
        }
        row.appendChild(cell);
      });
      sheetData.appendChild(row);
    });
    var dimension = nodes(doc, 'dimension')[0];
    if (dimension) dimension.setAttribute('ref', 'A1:' + Object.keys(template.columns).pop() + (normalized.length + 6));
    var bytes = encoder.encode(new XMLSerializer().serializeToString(doc)), entries = Object.assign(Object.create(null), template.entries);
    var unpacked = Object.values(entries).reduce(function (sum, entry) { return sum + (entry.name === template.sheets.Template ? 0 : entry.size); }, bytes.length);
    if (unpacked > MAX_UNPACKED) fail('Contenu XLSX trop volumineux : réduisez la sélection');
    entries[template.sheets.Template] = { name: template.sheets.Template, method: 8, packed: await transform(bytes, true, MAX_FILE), size: bytes.length, crc: crc(bytes) };
    return writeZip(entries);
  }
  return { inspect: inspect, fill: fill, validateRows: validateRows, allowedValues: allowedValues, readZip: readZip, entryBytes: entryBytes, writeZip: writeZip, crc: crc, maxFile: MAX_FILE };
});
