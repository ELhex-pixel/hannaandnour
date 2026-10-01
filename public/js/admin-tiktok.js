(function () {
  'use strict';
  var call = window.HN_ADMIN.call;
  var xlsx = window.HN_TIKTOK_XLSX;
  var template = null, filename = '', metadata = {}, inputs = {}, revision = 0, fileRevision = 0, loadedProduct = '';
  var productSelect = document.getElementById('tiktokProduct');
  var save = document.getElementById('saveTiktokMetadata');
  var exportBtn = document.getElementById('exportTiktokProducts');
  var status = document.getElementById('tiktokStatus');
  var core = ['parcel_weight', 'parcel_length', 'parcel_width', 'parcel_height', 'manufacturer_ids', 'rp_ids'];
  function message(text) { status.textContent = text; }
  function categoryFields() {
    var container = document.getElementById('tiktokFields');
    container.textContent = ''; inputs = {};
    save.disabled = true;
    if (!template || !productSelect.value || loadedProduct !== productSelect.value) return;
    var category = metadata.category || template.categories[0];
    if (!template.categories.includes(category)) category = template.categories[0];
    function field(key, label, value, options, required) {
      var box = document.createElement('div'); box.className = 'field';
      var title = document.createElement('label'); title.textContent = label + (required ? ' *' : ''); title.htmlFor = 'tiktok-' + key.replace(/\//g, '-');
      var input = document.createElement(options ? 'select' : 'input'); input.id = title.htmlFor;
      if (options) {
        ['', ...options].forEach(function (option) { var node = document.createElement('option'); node.value = option; node.textContent = option || 'Choisir…'; input.appendChild(node); });
        if (value && !options.includes(value)) {
          var match = options.find(function (option) { return option.includes('(ID: ' + value + ')'); });
          if (match) value = match;
          else { var previous = document.createElement('option'); previous.value = value; previous.textContent = value + ' (à vérifier)'; input.appendChild(previous); }
        }
      }
      if (key.startsWith('parcel_')) { input.type = 'number'; input.min = '0.01'; input.step = 'any'; }
      input.value = value || ''; box.appendChild(title); box.appendChild(input); container.appendChild(box); inputs[key] = input;
    }
    field('category', 'Catégorie TikTok exacte', category, template.categories, true);
    var rules = template.rules[category];
    Object.entries(template.columns).forEach(function (entry) {
      var col = entry[0], key = entry[1];
      if (rules[col] === 'Forbid') return;
      if (!core.includes(key) && !/^(?:product_property\/\d+|qualification\/\d+|size_chart|sku_unit_count|brand)$/.test(key)) return;
      var rule = template.validations.find(function (item) { return item.getAttribute('type') === 'list' && item.getAttribute('sqref').match(/^([A-Z]+)/)?.[1] === col; });
      var options = rule ? xlsx.allowedValues(template, rule, category) : null;
      var value = core.includes(key) ? metadata[key] : key === 'product_property/102277' ? metadata.packaging_safety : (metadata.extra || {})[key];
      if (key === 'product_property/102277') options = ['Oui', 'Non'];
      field(key, template.labels[col] || key, value, options?.length ? options : null, rules[col] === 'Mandatory');
    });
    inputs.category.addEventListener('change', function () { metadata = collect(); categoryFields(); });
    save.disabled = false;
  }
  function collect() {
    var result = { category: inputs.category.value, extra: {} };
    Object.entries(inputs).forEach(function (entry) {
      var key = entry[0], value = entry[1].value.trim();
      if (key === 'category') return;
      if (core.includes(key)) result[key] = value;
      else if (key === 'product_property/102277') result.packaging_safety = value;
      else if (value) result.extra[key] = value;
    });
    return result;
  }
  async function loadMetadata() {
    var request = ++revision, id = productSelect.value;
    loadedProduct = ''; metadata = {}; document.getElementById('tiktokFields').textContent = ''; save.disabled = true;
    if (!id) return;
    try {
      var res = await call('getTiktokMetadata', { id: id });
      if (request !== revision) return;
      loadedProduct = id; metadata = res.metadata || {}; categoryFields();
      if (!template) message('Choisissez d’abord le modèle TikTok pour afficher les champs à compléter.');
    } catch (error) { if (request === revision) message(error.message); }
  }
  async function loadProducts() {
    var refresh = document.getElementById('refreshTiktokProducts'); refresh.disabled = true;
    try {
      var res = await call('listProducts'), list = document.getElementById('tiktokProducts'), selected = productSelect.value;
      list.textContent = ''; productSelect.textContent = '';
      var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choisir un produit'; productSelect.appendChild(empty);
      (res.products || []).forEach(function (product) {
        var label = product.name_fr || product.name_en || product.slug;
        var option = document.createElement('option'); option.value = product.id; option.textContent = label; productSelect.appendChild(option);
        var item = document.createElement('label'); item.className = 'check'; item.style.display = 'block';
        var check = document.createElement('input'); check.type = 'checkbox'; check.value = product.id; check.name = 'tiktok-export-product';
        item.appendChild(check); item.appendChild(document.createTextNode(' ' + label + (product.active === false ? ' (archivé : quantité 0)' : ''))); list.appendChild(item);
      });
      productSelect.value = selected; await loadMetadata();
    } catch (error) { message(error.message); }
    finally { refresh.disabled = false; }
  }
  document.querySelector('[data-tab="tiktok"]').addEventListener('click', loadProducts);
  document.getElementById('refreshTiktokProducts').addEventListener('click', loadProducts);
  productSelect.addEventListener('change', loadMetadata);
  document.getElementById('tiktokTemplate').addEventListener('change', async function () {
    var request = ++fileRevision, file = this.files[0]; template = null; exportBtn.disabled = true; save.disabled = true;
    document.getElementById('tiktokFields').textContent = '';
    var info = document.getElementById('tiktokTemplateInfo'); info.textContent = '';
    if (!file) return;
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > xlsx.maxFile) throw new Error('Choisissez un fichier .xlsx de 20 Mo maximum');
      message('Lecture du modèle TikTok…');
      var inspected = await xlsx.inspect(new Uint8Array(await file.arrayBuffer()));
      if (request !== fileRevision) return;
      template = inspected; filename = file.name;
      info.textContent = 'Catégorie(s) : ' + template.categories.join(', ') + '\nChamps obligatoires : ' + template.categories.map(function (category) {
        return Object.entries(template.columns).filter(function (entry) { return template.rules[category]?.[entry[0]] === 'Mandatory'; }).map(function (entry) { return template.labels[entry[0]] || entry[1]; }).join(', ');
      }).join('\n');
      categoryFields(); exportBtn.disabled = false; message('Modèle chargé. Complétez et enregistrez les informations TikTok de chaque produit avant l’export.');
    } catch (error) { if (request === fileRevision) message(error.message); }
  });
  save.addEventListener('click', async function () {
    if (!template || !productSelect.value || loadedProduct !== productSelect.value) return;
    var id = productSelect.value, request = revision, value = collect(); save.disabled = true;
    try {
      var res = await call('saveTiktokMetadata', { id: id, metadata: value });
      if (request === revision) { metadata = res.metadata; message('Informations TikTok enregistrées. La fiche et le stock du site n’ont pas été modifiés.'); }
    } catch (error) { message(error.message); }
    finally { if (request === revision) save.disabled = false; }
  });
  exportBtn.addEventListener('click', async function () {
    if (!template) return;
    var ids = Array.from(document.querySelectorAll('[name="tiktok-export-product"]:checked')).map(function (input) { return input.value; });
    if (!ids.length) { message('Sélectionnez au moins un produit à exporter.'); return; }
    if (!confirm('Exporter le stock actuel vers un fichier de création TikTok ?\nCe fichier ne met pas à jour les annonces existantes et ne réserve aucune pièce. Vérifiez les informations et les images avant publication.')) return;
    var current = template, name = filename; exportBtn.disabled = true;
    try {
      message('Lecture des prix TTC et du stock disponibles sur le serveur…');
      var res = await call('exportTiktokProducts', { ids: ids });
      message('Contrôle des obligations du modèle et génération du XLSX…');
      var blob = await xlsx.fill(current, res.rows), url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = name.replace(/\.xlsx$/i, '-hanna-nour.xlsx'); document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      message(res.rows.length + ' variantes exportées en EUR TTC (taux du site : ' + (Number(res.tax_rate) * 100).toFixed(2) + ' %). Stock relevé le ' + res.generated_at + '.\nVérifiez le fichier, puis importez-le dans TikTok Seller Center. TikTok peut encore refuser des images ou demander des justificatifs.');
    } catch (error) { message(error.message); }
    finally { exportBtn.disabled = !template; }
  });
})();
