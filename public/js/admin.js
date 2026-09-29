/**
 * Hanna & Nour - Admin dashboard (admin.html)
 * Products CRUD, per-variant stock, image upload (Supabase Storage),
 * order fulfillment (shipped/delivered + tracking) and shipping settings.
 */
(function () {
  'use strict';

  var API = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';
  var TOKEN_KEY = 'hn-admin-token';
  var COLORS = window.HN_COLORS || {
    list: [],
    hex: function () { return '#A67C00'; },
    has: function () { return false; },
    label: function (n) { return String(n == null ? '' : n); },
    norm: function (s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  };

  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function call(action, data, method) {
    return fetch(API + '/admin', {
      method: method || 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() },
      body: JSON.stringify(Object.assign({ action: action }, data || {}))
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          var e = new Error(body.error || 'Erreur serveur');
          if (body.detail) e.detail = body.detail;
          throw e;
        }
        return body;
      });
    });
  }

  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
    setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  function money(cents, currency) {
    var sym = '$';
    if (currency === 'eur') sym = '\u20AC';
    else if (currency === 'usd') sym = '$';
    else if (ADMIN_CURRENCY_SYMBOL) sym = ADMIN_CURRENCY_SYMBOL;
    return sym + ((parseInt(cents, 10) || 0) / 100).toFixed(2);
  }
  var ADMIN_CURRENCY_SYMBOL = '$';
  function dollars(cents) {
    return ((parseInt(cents, 10) || 0) / 100).toFixed(2);
  }
  function toCents(dollarsRaw) {
    return Math.round((parseFloat(dollarsRaw) || 0) * 100);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
  }

  /* ---------------- Auth ---------------- */

  function showApp(ok) {
    document.getElementById('loginView').style.display = ok ? 'none' : '';
    document.getElementById('appView').style.display = ok ? '' : 'none';
  }

  function logout() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    showApp(false);
  }

  // "Mot de passe oublié" : email -> code à 6 chiffres -> nouveau mot de passe.
  function wireForgot() {
    var form = document.getElementById('loginForm');
    var forgot = document.getElementById('forgotView');
    var el = function (id) { return document.getElementById(id); };
    var err = el('forgotErr'), ok = el('forgotOk');
    var set = function (elm, on) { elm.style.display = on ? '' : 'none'; };

    function msgError(text) {
      if (ok) ok.style.display = 'none';
      if (err) { err.textContent = text || ''; err.style.display = text ? 'block' : 'none'; }
    }
    function msgOk(text) {
      if (err) err.style.display = 'none';
      if (ok) { ok.textContent = text || ''; ok.style.display = text ? 'block' : 'none'; }
    }

    function showForgot() {
      set(form, false);
      set(forgot, true);
      set(el('forgotEmailWrap'), true);
      set(el('forgotResetWrap'), false);
      set(el('forgotStep1'), true);
      set(el('forgotStep2'), false);
      msgError('');
      msgOk('');
    }
    function back() {
      showForgot();
      set(forgot, false);
      set(form, true);
    }

    el('forgotToggle').addEventListener('click', function (e) {
      e.preventDefault();
      el('loginErr').style.display = 'none';
      showForgot();
    });

    el('forgotBack').addEventListener('click', function (e) {
      e.preventDefault();
      back();
    });

    el('forgotSendBtn').addEventListener('click', function (e) {
      e.preventDefault();
      msgError('');
      var email = el('forgotEmail').value.trim();
      if (!email) { msgError('Entrez votre adresse email.'); return; }
      var btn = el('forgotSendBtn');
      btn.disabled = true;
      call('forgotPassword', { email: email })
        .then(function () {
          btn.disabled = false;
          msgOk('Si cette adresse est valide, un code a \u00e9t\u00e9 envoy\u00e9 par email.');
          set(el('forgotEmailWrap'), false);
          set(el('forgotStep1'), false);
          set(el('forgotResetWrap'), true);
          set(el('forgotStep2'), true);
        })
        .catch(function (e2) {
          btn.disabled = false;
          msgError(e2.detail || e2.message || 'Erreur lors de l\'envoi du code.');
        });
    });

    [el('forgotCode'), el('forgotNewPw')].forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') el('forgotApplyBtn').click();
      });
    });

    el('forgotApplyBtn').addEventListener('click', function (e) {
      e.preventDefault();
      msgError('');
      var code = el('forgotCode').value.replace(/\D/g, '');
      var pw = el('forgotNewPw').value;
      if (code.length !== 6) { msgError('Le code comporte 6 chiffres.'); return; }
      if (pw.length < 6) { msgError('Le nouveau mot de passe doit contenir au moins 6 caract\u00e8res.'); return; }
      var btn = el('forgotApplyBtn');
      btn.disabled = true;
      call('applyReset', { otp: code, password: pw })
        .then(function () {
          btn.disabled = false;
          msgOk('Mot de passe r\u00e9initialis\u00e9 ! Connectez-vous avec votre nouveau mot de passe.');
          el('forgotCode').value = '';
          el('forgotNewPw').value = '';
          set(el('forgotResetWrap'), false);
          set(el('forgotStep2'), false);
          setTimeout(function () { back(); }, 900);
        })
        .catch(function (e2) {
          btn.disabled = false;
          msgError(e2.message || 'Code incorrect.');
        });
    });
  }

  function wireLogin() {
    function tryLogin() {
      var pw = document.getElementById('loginPassword').value;
      if (!pw) return;
      call('login', { password: pw })
        .then(function (res) {
          try { sessionStorage.setItem(TOKEN_KEY, res.token); } catch (e) {}
          document.getElementById('loginErr').style.display = 'none';
          document.getElementById('loginPassword').value = '';
          showApp(true);
          boot();
        })
        .catch(function (err) {
          document.getElementById('loginErr').style.display = 'block';
          toast(err.message || 'Erreur', 'err');
        });
    }
    document.getElementById('loginBtn').addEventListener('click', tryLogin);
    document.getElementById('loginPassword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') tryLogin();
    });
    var eyeBtn = document.getElementById('togglePassword');
    if (eyeBtn) {
      eyeBtn.addEventListener('click', function () {
        var input = document.getElementById('loginPassword');
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eyeBtn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
        eyeBtn.setAttribute('title', show ? 'Masquer' : 'Afficher');
      });
    }
    document.getElementById('logoutBtn').addEventListener('click', logout);
  }

  /* ---------------- Tabs ---------------- */

  function wireTabs() {
    document.querySelectorAll('.admin-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.admin-tab').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.admin-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        var id = 'panel-' + btn.getAttribute('data-tab');
        var panel = document.getElementById(id);
        panel.classList.add('active');
        if (id === 'panel-products') loadProducts();
        if (id === 'panel-orders') loadOrders();
        if (id === 'panel-sales') { loadSales(); focusScan(); prepLoadOrders(); }
        if (id === 'panel-reviews') loadReviews();
        if (id === 'panel-home') loadHome();
        if (id === 'panel-blog') loadBlog();
        if (id === 'panel-promos') loadPromos();
        if (id === 'panel-stats') loadStats();
        if (id === 'panel-messages') loadMessages();
        if (id === 'panel-settings') loadSettings();
      });
    });
  }

  /* ---------------- Products ---------------- */

  var productsAll = [];

  function productRow(p) {
    var cat = { hijab: 'Hijab', abaya: 'Abaya', prayer: 'Prayer', dress: 'Dress', accessory: 'Accessory' }[p.category] || p.category;
    var totalStock = (p.variants || []).reduce(function (n, v) { return n + (parseInt(v.stock, 10) || 0); }, 0);
    var managed = (p.variants || []).length > 0;
    return '<tr>' +
      '<td data-label=""><img class="thumb" src="' + esc(p.image || 'images/hero.jpg') + '" alt=""></td>' +
      '<td data-label="Produit"><strong>' + esc(p.name_en) + '</strong><br><small style="color:#8a7d66;">' + esc(p.slug) + '</small></td>' +
      '<td data-label="Prix">' + money(p.price_cents) + '</td>' +
      '<td data-label="Cat\u00e9gorie">' + esc(cat) + '</td>' +
      '<td data-label="Stock">' + (managed ? '<span class="badge badge-green">' + totalStock + ' en stock</span>' : '<span class="badge badge-gray">sans stock</span>') + '</td>' +
      (p.active ? '' : '<td data-label="Statut"><span class="badge badge-red">Inactif</span></td>') +
      '<td data-label=""><span style="white-space:nowrap;">' +
      '<button class="btn btn-secondary btn-small edit-product" data-id="' + p.id + '">Modifier</button> ' +
      '<button class="btn btn-secondary btn-small dup-product" title="Dupliquer" data-id="' + p.id + '">Dupliquer</button>' +
      '</span></td></tr>';
  }

  function loadProducts() {
    return call('listProducts').then(function (res) {
      productsAll = res.products || [];
      renderProducts();
    }).catch(function (e) {
      document.getElementById('productsList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function renderProducts() {
    var box = document.getElementById('productsList');
    var q = (document.getElementById('filterProducts').value || '').toLowerCase();
    var cat = document.getElementById('filterCategory').value;
    var list = productsAll.filter(function (p) {
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return (p.name_en + ' ' + p.slug + ' ' + (p.name_fr || '') + ' ' + (p.name_ar || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!list.length) { box.innerHTML = '<p class="empty">Aucun produit.</p>'; return; }
    box.innerHTML = '<table class="admin-table"><thead><tr><th></th><th>Produit</th><th>Prix</th><th>Cat&eacute;gorie</th><th>Stock</th><th></th><th></th></tr></thead><tbody>' +
      list.map(productRow).join('') + '</tbody></table>';
  }

  // Copie un produit (nouveau slug unique, copie créée DÉSACTIVÉE pour
  // relecture avant mise en ligne ; note/reviews remis à zéro).
  function duplicateProduct(id) {
    var src = productsAll.filter(function (p) { return p.id === id; })[0];
    if (!src) return;
    var baseSlug = (src.slug || '') + '-copie';
    var taken = {};
    productsAll.forEach(function (q) { taken[q.slug] = true; });
    var slug = baseSlug;
    for (var n = 2; taken[slug]; n++) slug = baseSlug + n;
    var payload = {
      slug: slug,
      sku: src.sku ? src.sku + '-copie' : '',
      name_en: src.name_en,
      name_fr: src.name_fr || '',
      name_ar: src.name_ar || '',
      description_en: src.description_en || '',
      description_fr: src.description_fr || '',
      description_ar: src.description_ar || '',
      features_en: src.features_en || [],
      features_fr: src.features_fr || [],
      features_ar: src.features_ar || [],
      care_en: src.care_en || [],
      care_fr: src.care_fr || [],
      care_ar: src.care_ar || [],
      fabrics: src.fabrics || [],
      occasions: src.occasions || [],
      colors: src.colors || [],
      sizes: src.sizes || [],
      fabric_comp_en: src.fabric_comp_en || '',
      fabric_comp_fr: src.fabric_comp_fr || '',
      fabric_comp_ar: src.fabric_comp_ar || '',
      price_cents: src.price_cents,
      compare_at_price_cents: src.compare_at_price_cents || null,
      category: src.category || 'hijab',
      badge: src.badge || null,
      rating: src.rating || 4.5,
      review_count: 0,
      image: src.image || 'images/hero.jpg',
      gallery: src.gallery || [],
      is_featured: !!src.is_featured,
      is_bestseller: !!src.is_bestseller,
      active: false,
      variants: (src.variants || []).map(function (v) {
        return { color: v.color || '', size: v.size || '', stock: parseInt(v.stock, 10) || 0 };
      })
    };
    call('saveProduct', payload)
      .then(function () {
        toast('Produit dupliqu\u00e9 (cr\u00e9\u00e9 d\u00e9sactiv\u00e9)', 'ok');
        return loadProducts();
      })
      .catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---- Product editor ---- */

  var editing = null;

  function openEditor(p) {
    editing = p || {
      name_en: '', name_fr: '', name_ar: '',
      description_en: '', description_fr: '', description_ar: '',
      features_en: [], features_fr: [], features_ar: [],
      care_en: [], care_fr: [], care_ar: [],
      fabrics: [], occasions: [], colors: [], sizes: [],
      fabric_comp_en: '', fabric_comp_fr: '', fabric_comp_ar: '',
      price_cents: '', compare_at_price_cents: '', category: 'hijab',
      badge: '', rating: 4.5, review_count: 0, image: 'images/hero.jpg', gallery: [],
      is_featured: false, is_bestseller: false, active: true, variants: []
    };

    document.getElementById('editorTitle').textContent = p ? 'Modifier : ' + (p.name_en || p.slug) : 'Nouveau produit';
    document.getElementById('f-id').value = p ? p.id : '';
    setVal('f-name_en', editing.name_en); setVal('f-name_fr', editing.name_fr); setVal('f-name_ar', editing.name_ar);
    setVal('f-desc_en', editing.description_en); setVal('f-desc_fr', editing.description_fr); setVal('f-desc_ar', editing.description_ar);
    setVal('f-slug', p ? editing.slug : '');
    setVal('f-sku', p ? editing.sku : '');
    setVal('f-price', editing.price_cents === '' ? '' : dollars(editing.price_cents));
    setVal('f-compare', editing.compare_at_price_cents ? dollars(editing.compare_at_price_cents) : '');
    setVal('f-category', editing.category);
    setVal('f-badge', editing.badge || '');
    setVal('f-colors', (editing.colors || []).join(', '));
    setVal('f-sizes', (editing.sizes || []).join(', '));
    setVal('f-fabrics', (editing.fabrics || []).join(', '));
    setVal('f-occasions', (editing.occasions || []).join(', '));
    setVal('f-features_en', (editing.features_en || []).join(', '));
    setVal('f-features_fr', (editing.features_fr || []).join(', '));
    setVal('f-features_ar', (editing.features_ar || []).join(', '));
    setVal('f-fabric_comp_en', editing.fabric_comp_en || '');
    setVal('f-fabric_comp_fr', editing.fabric_comp_fr || '');
    setVal('f-fabric_comp_ar', editing.fabric_comp_ar || '');
    setVal('f-care_en', (editing.care_en || []).join(', '));
    setVal('f-care_fr', (editing.care_fr || []).join(', '));
    setVal('f-care_ar', (editing.care_ar || []).join(', '));
    setVal('f-rating', editing.rating);
    setVal('f-image', editing.image || 'images/hero.jpg');
    setVal('f-gallery', (editing.gallery || []).join('\n'));
    renderGalleryGrid();
    document.getElementById('f-featured').checked = !!editing.is_featured;
    document.getElementById('f-bestseller').checked = !!editing.is_bestseller;
    document.getElementById('f-active').checked = editing.active !== false;
    document.getElementById('deleteProductBtn').style.display = p ? '' : 'none';

    buildVariantGrid();
    renderColorsPicker();
    document.getElementById('productEditor').classList.add('open');
  }

  function setVal(id, v) {
    var el = document.getElementById(id);
    el.value = (v == null ? '' : v);
    var ev = document.createEvent('Event');
    ev.initEvent('input', true, true);
    el.dispatchEvent(ev);
  }
  function getVal(id) {
    return document.getElementById(id).value.trim();
  }

  function strToList(val) {
    return val.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function colorCellHtml(color) {
    var hex = COLORS.hex(color);
    var unknown = !COLORS.has(color);
    return '<div class="v-color-cell">' +
      '<span class="swatch' + (unknown ? ' unknown" title="Couleur inconnue du site' : '') + '" style="background:' + esc(hex) + ';"></span>' +
      '<input type="text" class="v-color" value="' + esc(color) + '" readonly>' +
      '</div>';
  }

  function buildVariantGrid() {
    var colors = strToList(getVal('f-colors'));
    var sizes = strToList(getVal('f-sizes'));

    // Keep previously typed stock/barcode values when the lists change.
    var keep = {};
    (editing.variants || []).forEach(function (v) {
      keep[v.color + '||' + v.size] = { stock: v.stock, barcode: v.barcode || '' };
    });

    function stockFor(color, size) {
      var k = keep[color + '||' + size];
      return k ? k.stock : '';
    }
    function barcodeFor(color, size) {
      var k = keep[color + '||' + size];
      return k ? k.barcode : '';
    }

    var rows = [];
    if (!colors.length && !sizes.length) {
      rows.push({ color: '', size: '' });
    } else {
      var cList = colors.length ? colors : [''];
      var sList = sizes.length ? sizes : [''];
      cList.forEach(function (c) {
        sList.forEach(function (s) { rows.push({ color: c, size: s }); });
      });
    }

    var html = rows.map(function (r, i) {
      return '<div class="variant-row" data-i="' + i + '">' +
        (r.color ? colorCellHtml(r.color) : '<input type="text" class="v-color" value="" placeholder="Couleur">') +
        '<input type="text" class="v-size" value="' + esc(r.size) + '" placeholder="Taille" ' + (r.size ? 'readonly' : '') + '>' +
        '<input type="number" class="v-stock" min="0" step="1" value="' + (stockFor(r.color, r.size) === '' ? '' : stockFor(r.color, r.size)) + '" placeholder="0">' +
        '<span style="font-size:12px;color:#8a7d66;">stock</span>' +
        '<input type="text" class="v-barcode" value="' + esc(barcodeFor(r.color, r.size)) + '" placeholder="Code-barres (auto)">' +
        '</div>';
    }).join('');

    document.getElementById('variantGrid').innerHTML = html ||
      '<p class="empty">Ajoutez des couleurs/tailles pour cr&eacute;er des lignes de stock.</p>';
  }

  function collectVariants() {
    var rows = document.querySelectorAll('#variantGrid .variant-row');
    var out = [];
    rows.forEach(function (row) {
      var color = row.querySelector('.v-color').value.trim();
      var size = row.querySelector('.v-size').value.trim();
      var stockRaw = row.querySelector('.v-stock').value.trim();
      if (stockRaw === '' ) return; // untouched => unmanaged row
      var barcodeEl = row.querySelector('.v-barcode');
      out.push({
        color: color,
        size: size,
        stock: Math.max(0, parseInt(stockRaw, 10) || 0),
        barcode: barcodeEl ? barcodeEl.value.trim() : ''
      });
    });
    return out;
  }

  /* ---------------- Sélecteur de couleurs ---------------- */

  function normalizeColorName(s) {
    return COLORS.norm ? COLORS.norm(s) : String(s == null ? '' : s).trim().toLowerCase();
  }

  function pickerColors() {
    return strToList(getVal('f-colors'));
  }

  function setPickerColors(list) {
    setVal('f-colors', list.join(', '));
    renderColorsPicker();
  }

  function renderColorsPicker() {
    var tagsEl = document.getElementById('colorsTags');
    var listEl = document.getElementById('colorsList');
    if (!tagsEl || !listEl) return;
    var colors = pickerColors();
    var normals = colors.map(normalizeColorName);

    var tags = '';
    colors.forEach(function (c) {
      tags += '<span class="color-tag"><span class="dot" style="background:' + esc(COLORS.hex(c)) + ';"></span>' +
        esc(c) + '<span class="x" data-remove="' + esc(c) + '" title="Retirer">&times;</span></span>';
    });
    tagsEl.innerHTML = tags || '<span style="color:#9a8c75;font-size:13px;">Aucune couleur</span>';

    var checks = '';
    (COLORS.list || []).forEach(function (e) {
      var selected = normals.indexOf(normalizeColorName(e.fr)) >= 0;
      checks += '<label><input type="checkbox" class="c-cb" value="' + esc(e.fr) + '"' + (selected ? ' checked' : '') + '>' +
        '<span class="dot" style="background:' + esc(e.hex) + ';"></span> ' + esc(e.fr) + '</label>';
    });
    listEl.innerHTML = checks || '<p style="color:#9a8c75;font-size:13px;">Liste vide</p>';
  }

  function wireColorsPicker() {
    var btn = document.getElementById('colorsPickerBtn');
    var panel = document.getElementById('colorsPanel');
    var tagsEl = document.getElementById('colorsTags');
    var listEl = document.getElementById('colorsList');
    var input = document.getElementById('colorsAddInput');
    var addBtn = document.getElementById('colorsAddBtn');
    if (!btn || !panel || !tagsEl || !listEl) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('open');
    });

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t && t.closest && t.closest('#colorsPicker'))) panel.classList.remove('open');
    });

    panel.addEventListener('change', function (e) {
      var cb = e.target.closest('.c-cb');
      if (!cb) return;
      var colors = pickerColors();
      var norm = normalizeColorName(cb.value);
      var exists = colors.some(function (c) { return normalizeColorName(c) === norm; });
      if (cb.checked && !exists) colors.push(cb.value);
      if (!cb.checked && exists) colors = colors.filter(function (c) { return normalizeColorName(c) !== norm; });
      setPickerColors(colors);
    });

    tagsEl.addEventListener('click', function (e) {
      var x = e.target.closest('[data-remove]');
      if (!x) return;
      var norm = normalizeColorName(x.getAttribute('data-remove'));
      setPickerColors(pickerColors().filter(function (c) { return normalizeColorName(c) !== norm; }));
    });

    function addColor() {
      var v = (input.value || '').trim();
      if (!v) return;
      var norm = normalizeColorName(v);
      var colors = pickerColors();
      if (colors.some(function (c) { return normalizeColorName(c) === norm; })) {
        input.value = '';
        toast('Couleur d\u00e9j\u00e0 pr\u00e9sente', 'err');
        return;
      }
      colors.push(v);
      setPickerColors(colors);
      input.value = '';
      if (!COLORS.has(v)) toast('Couleur ajout\u00e9e (teinte par d\u00e9faut sur le site)', 'err');
    }
    if (addBtn) addBtn.addEventListener('click', addColor);
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') addColor(); });
  }

  function collectProduct() {
    var priceRaw = getVal('f-price');
    var p = {
      id: getVal('f-id'),
      slug: getVal('f-slug'),
      sku: getVal('f-sku'),
      name_en: getVal('f-name_en'),
      name_fr: getVal('f-name_fr'),
      name_ar: getVal('f-name_ar'),
      description_en: getVal('f-desc_en'),
      description_fr: getVal('f-desc_fr'),
      description_ar: getVal('f-desc_ar'),
      features_en: strToList(getVal('f-features_en')),
      features_fr: strToList(getVal('f-features_fr')),
      features_ar: strToList(getVal('f-features_ar')),
      care_en: strToList(getVal('f-care_en')),
      care_fr: strToList(getVal('f-care_fr')),
      care_ar: strToList(getVal('f-care_ar')),
      fabrics: strToList(getVal('f-fabrics')),
      occasions: strToList(getVal('f-occasions')),
      colors: strToList(getVal('f-colors')),
      sizes: strToList(getVal('f-sizes')),
      fabric_comp_en: getVal('f-fabric_comp_en'),
      fabric_comp_fr: getVal('f-fabric_comp_fr'),
      fabric_comp_ar: getVal('f-fabric_comp_ar'),
      price_cents: toCents(priceRaw),
      compare_at_price_cents: getVal('f-compare') ? toCents(getVal('f-compare')) : null,
      category: getVal('f-category'),
      badge: getVal('f-badge') || null,
      rating: parseFloat(getVal('f-rating')) || 4.5,
      image: getVal('f-image') || 'images/hero.jpg',
      gallery: getVal('f-gallery').split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
      is_featured: document.getElementById('f-featured').checked,
      is_bestseller: document.getElementById('f-bestseller').checked,
      active: document.getElementById('f-active').checked,
      variants: collectVariants()
    };
    if (!p.name_en || !p.price_cents) throw new Error('Nom (EN) et prix sont obligatoires');
    return p;
  }

  /* ---------------- Galerie visuelle ---------------- */

  function galleryLines() {
    return String(getVal('f-gallery') || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function saveGalleryLines(lines) {
    setVal('f-gallery', lines.join('\n'));
    renderGalleryGrid();
  }

  function renderGalleryGrid() {
    var box = document.getElementById('galleryGrid');
    if (!box) return;
    var lines = galleryLines();
    if (!lines.length) {
      box.innerHTML = '<p class="empty">Aucune image &mdash; ajoutez-en via upload ou URL.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="gallery-item" data-i="' + i + '">' +
        '<img src="' + esc(lines[i]) + '" alt="Image ' + (i + 1) + '" onerror="this.classList.add(\'err\');">' +
        '<div class="g-actions">' +
        '<button type="button" class="btn btn-secondary btn-small g-up" title="Monter"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
        '<button type="button" class="btn btn-secondary btn-small g-down" title="Descendre"' + (i === lines.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        '<button type="button" class="btn btn-danger btn-small g-del" title="Supprimer">&times;</button>' +
        '</div></div>';
    }
    box.innerHTML = html;
  }

  function moveGallery(i, dir) {
    var lines = galleryLines();
    var j = i + dir;
    if (j < 0 || j >= lines.length) return;
    var tmp = lines[i]; lines[i] = lines[j]; lines[j] = tmp;
    saveGalleryLines(lines);
  }

  function deleteGallery(i) {
    var lines = galleryLines();
    lines.splice(i, 1);
    saveGalleryLines(lines);
  }

  function addGalleryUrl() {
    var input = document.getElementById('galleryUrl');
    if (!input) return;
    var v = (input.value || '').trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v) && v.indexOf('images/') !== 0) { toast('URL invalide (http(s) ou images/…)', 'err'); return; }
    var lines = galleryLines();
    if (lines.indexOf(v) >= 0) { input.value = ''; toast('Déjà présente', 'err'); return; }
    lines.push(v);
    saveGalleryLines(lines);
    input.value = '';
  }

  function wireEditor() {
    document.getElementById('closeEditorBtn').addEventListener('click', function () {
      document.getElementById('productEditor').classList.remove('open');
    });
    // Close by clicking the dark backdrop around the editor.
    document.getElementById('productEditor').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
      var up = e.target.closest('.g-up');
      if (up) { moveGallery(parseInt(up.closest('.gallery-item').getAttribute('data-i'), 10), -1); return; }
      var down = e.target.closest('.g-down');
      if (down) { moveGallery(parseInt(down.closest('.gallery-item').getAttribute('data-i'), 10), 1); return; }
      var del = e.target.closest('.g-del');
      if (del) { deleteGallery(parseInt(del.closest('.gallery-item').getAttribute('data-i'), 10)); return; }
      if (e.target.closest('#galleryUrlAdd')) { addGalleryUrl(); return; }
    });
    document.getElementById('newProductBtn').addEventListener('click', function () { openEditor(null); });
    document.getElementById('f-colors').addEventListener('input', buildVariantGrid);
    document.getElementById('f-sizes').addEventListener('input', buildVariantGrid);
    wireColorsPicker();
    var galleryUrlInput = document.getElementById('galleryUrl');
    if (galleryUrlInput) galleryUrlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addGalleryUrl();
    });

    document.getElementById('saveProductBtn').addEventListener('click', function () {
      var btn = this;
      var payload;
      try { payload = collectProduct(); } catch (e) { toast(e.message, 'err'); return; }
      btn.disabled = true;
      call('saveProduct', payload)
        .then(function () {
          toast(payload.id ? 'Produit mis à jour' : 'Produit créé', 'ok');
          document.getElementById('productEditor').classList.remove('open');
          return loadProducts();
        })
        .catch(function (e) { toast(e.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    });

    document.getElementById('deleteProductBtn').addEventListener('click', function () {
      var id = document.getElementById('f-id').value;
      if (!id) return;
      if (!confirm('Supprimer d\u00e9finitivement ce produit ?')) return;
      call('deleteProduct', { id: id })
        .then(function () {
          toast('Produit supprim\u00e9', 'ok');
          document.getElementById('productEditor').classList.remove('open');
          return loadProducts();
        })
        .catch(function (e) { toast(e.message, 'err'); });
    });

    wireUploads();
  }

  function wireUploads() {
    function bind(btnId, inputId, onUrl, label) {
      var btn = document.getElementById(btnId);
      var input = document.getElementById(inputId);
      label = label || (btnId.indexOf('Gallery') >= 0 ? 'Ajouter au galerie' : 'Uploader une photo');
      btn.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          btn.disabled = true; btn.textContent = 'Upload...';
          call('uploadImage', {
            name: file.name,
            mime: file.type,
            data_base64: String(reader.result).split(',')[1] || reader.result
          })
            .then(function (res) { onUrl(res.url); toast('Image upload\u00e9e', 'ok'); })
            .catch(function (e) { toast(e.message, 'err'); })
            .finally(function () { btn.disabled = false; btn.textContent = label; });
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    }
    function wirePreview(inputId, imgId) {
      var input = document.getElementById(inputId);
      var img = document.getElementById(imgId);
      if (!input || !img) return;
      function show() {
        var v = (input.value || '').trim();
        if (v) { img.src = v; img.style.display = ''; } else { img.style.display = 'none'; }
      }
      show();
      input.addEventListener('input', show);
      input.addEventListener('change', show);
    }
    bind('uploadMainBtn', 'fileMain', function (url) { setVal('f-image', url); });
    bind('uploadGalleryBtn', 'fileGallery', function (url) {
      var lines = galleryLines();
      if (lines.indexOf(url) < 0) lines.push(url);
      saveGalleryLines(lines);
    });
    bind('uploadPostBtn', 'filePost', function (url) { setVal('b-image', url); }, 'Uploader une image');
    bind('uploadHeroBtn', 'fileHero', function (url) { setVal('s-hero-image', url); }, 'Uploader une image');
    bind('uploadCraftBtn', 'fileCraft', function (url) { setVal('s-craft-image', url); }, 'Uploader une image');
    bind('uploadCollBtn', 'fileColl', function (url) { setVal('c-image', url); }, 'Uploader une image');
    wirePreview('b-image', 'previewPost');
    wirePreview('s-hero-image', 'previewHero');
    wirePreview('s-craft-image', 'previewCraft');
    wirePreview('c-image', 'previewColl');
  }

  /* ---------------- Orders ---------------- */

  function statusLabel(s) {
    return { pending: 'En attente', paid: 'Pay&eacute;e', abandoned: 'Abandonn&eacute;e', refunded: 'Rembours&eacute;e', cancelled: 'Annul&eacute;e' }[s] || s;
  }
  function shipLabel(s) {
    return { new: '&Agrave; exp&eacute;dier', shipped: 'expédiée', delivered: 'Livr&eacute;e' }[s] || s;
  }
  function shipClass(s) {
    return s === 'shipped' ? 'badge badge-green' : s === 'delivered' ? 'badge badge-green' : 'badge badge-gray';
  }
  function payClass(s) {
    return s === 'paid' ? 'badge badge-green' : s === 'pending' ? 'badge badge-gray' : 'badge badge-red';
  }

  var ordersAll = [];

  function loadOrders() {
    var status = document.getElementById('filterOrderStatus').value;
    var ship = document.getElementById('filterShippingStatus').value;
    var data = {};
    if (status) data.status = status;
    if (ship) data.shipping_status = ship;
    return call('listOrders', data).then(function (res) {
      ordersAll = res.orders || [];
      renderOrders();
    }).catch(function (e) {
      document.getElementById('ordersList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function orderRow(o) {
    var count = (o.order_items || []).reduce(function (n, it) { return n + (parseInt(it.quantity, 10) || 0); }, 0);
    return '<tr>' +
      '<td data-label="Commande"><strong>' + esc(o.order_number) + '</strong><br><small style="color:#8a7d66;">' + fmtDate(o.created_at) + '</small></td>' +
      '<td data-label="Client">' + esc(o.customer_name) + '<br><small style="color:#8a7d66;">' + esc(o.email) + '</small></td>' +
      '<td data-label="Articles">' + count + '</td>' +
      '<td data-label="Total">' + money(o.total_cents, o.currency) + '</td>' +
      '<td data-label="Paiement"><span class="' + payClass(o.status) + '">' + statusLabel(o.status) + '</span></td>' +
      '<td data-label="Exp\u00e9dition"><span class="badge ' + shipClass(o.shipping_status) + '">' + shipLabel(o.shipping_status) + '</span>' +
      (o.tracking_number ? '<br><small style="color:#8a7d66;">' + esc(o.tracking_number) + '</small>' : '') + '</td>' +
      '<td data-label=""><span style="white-space:nowrap;"><button class="btn btn-secondary btn-small view-order" data-id="' + o.id + '">Voir</button> ' +
      '<button class="btn btn-danger btn-small del-order" data-id="' + o.id + '" data-number="' + esc(o.order_number) + '">Supprimer</button></span></td>' +
      '</tr>';
  }

  function renderOrders() {
    var box = document.getElementById('ordersList');
    if (!ordersAll.length) { box.innerHTML = '<p class="empty">Aucune commande.</p>'; return; }
    box.innerHTML = '<table class="admin-table"><thead><tr>' +
      '<th>Commande</th><th>Client</th><th>Articles</th><th>Total</th><th>Paiement</th><th>Exp&eacute;dition</th><th></th>' +
      '</tr></thead><tbody>' + ordersAll.map(orderRow).join('') + '</tbody></table>';
  }

  function returnedByItem(o) {
    var m = {};
    (o.returns || []).forEach(function (r) {
      m[r.order_item_id] = (m[r.order_item_id] || 0) + (parseInt(r.quantity, 10) || 0);
    });
    return m;
  }

  function itemRows(o, ret) {
    var canReturn = o.status === 'paid';
    return (o.order_items || []).map(function (it) {
      var qty = parseInt(it.quantity, 10) || 1;
      var returned = ret[it.id] || 0;
      var remaining = Math.max(0, qty - returned);
      var retInfo = returned > 0 ? '<br><span class="badge badge-gray">Retourn\u00e9 : ' + returned + '/' + qty + '</span>' : '';
      var btn = canReturn && remaining > 0
        ? '<button class="btn btn-secondary btn-small return-line" data-item="' + esc(it.id) + '" data-remaining="' + remaining + '" data-name="' + esc(it.product_name) + '">Retour</button>'
        : (canReturn ? '<span style="color:#8a7d66;font-size:12px;">\u2014</span>' : '');
      return '<tr>' +
        '<td data-label="Article">' + esc(it.product_name) + (it.variant ? '<br><small style="color:#8a7d66;">' + esc(it.variant) + '</small>' : '') + retInfo + '</td>' +
        '<td data-label="Qt\u00e9">' + returned + ' / ' + qty + '</td>' +
        '<td data-label="Total">' + money(it.unit_price_cents * qty, o.currency) + '</td>' +
        (canReturn ? '<td data-label="Retour">' + btn + '</td>' : '') +
        '</tr>';
    }).join('');
  }

  function returnFormHtml() {
    return '<div id="returnRow" style="display:none; margin-top:12px; border-top:1px solid #eee; padding-top:10px;">' +
      '<strong style="font-size:13px;">Enregistrer un retour</strong>' +
      '<input type="hidden" id="returnItemId">' +
      '<div style="display:grid; grid-template-columns:110px 1fr; gap:10px; margin-top:8px; align-items:center; font-size:12px; color:#5c5548;">' +
      '<label>Quantit\u00e9</label><input type="number" id="returnQty" min="1" value="1" style="width:90px; padding:8px; border:1px solid #ddd5c4; border-radius:8px;">' +
      '<label>Motif</label>' +
      '<select id="returnReason" style="width:100%; padding:8px; border:1px solid #ddd5c4; border-radius:8px;">' +
      '<option value="retour_client">Retour client</option>' +
      '<option value="defective">D\u00e9fectueux</option>' +
      '<option value="exchange">\u00c9change / taille</option>' +
      '<option value="other">Autre</option></select></div>' +
      '<button class="btn btn-primary btn-small" id="confirmReturnBtn" style="margin-top:8px;">Confirmer le retour (restock auto)</button></div>';
  }

  function openOrder(o) {
    document.getElementById('orderModalTitle').textContent = 'Commande ' + o.order_number;
    var addressBlock = o.delivery_type === 'pickup'
      ? '<p><strong>Retrait :</strong> ' + esc(o.pickup_point || '-') + '</p>'
      : '<p>' + esc(o.address1) + (o.address2 ? ' ' + esc(o.address2) : '') + '<br>' +
        esc(o.city) + (o.state ? ' ' + esc(o.state) : '') + ' ' + esc(o.postal_code) + '<br>' + esc(o.country) + '</p>';

    var canReturn = o.status === 'paid';
    var ret = returnedByItem(o);

    document.getElementById('orderModalBody').innerHTML =
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:13px;">' +
      '<div><strong>Client</strong><br>' + esc(o.customer_name) + '<br>' + esc(o.email) + (o.phone ? '<br>' + esc(o.phone) : '') + '</div>' +
      '<div><strong>Livraison</strong><br>' + esc(o.shipping_method || 'standard') + '<br>' + addressBlock +
      (o.tracking_number ? '<br><strong>Suivi :</strong> ' + esc(o.tracking_number) : '') + '</div>' +
      '</div>' +
      '<table class="admin-table"><thead><tr><th>Article</th><th>Qt&eacute;</th><th>Total</th>' + (canReturn ? '<th>Retour</th>' : '') + '</tr></thead><tbody>' + itemRows(o, ret) + '</tbody></table>' +
      '<table class="admin-totals" style="margin-top:10px;"><tr><td>Sous-total</td><td>' + money(o.subtotal_cents, o.currency) + '</td></tr>' +
      (o.discount_cents > 0 ? '<tr><td>Remise</td><td>-' + money(o.discount_cents, o.currency) + '</td></tr>' : '') +
      '<tr><td>Livraison</td><td>' + money(o.shipping_cents, o.currency) + '</td></tr>' +
      (o.tax_cents > 0 ? '<tr><td>Taxe</td><td>' + money(o.tax_cents, o.currency) + '</td></tr>' : '') +
      '<tr><td><strong>Total</strong></td><td><strong>' + money(o.total_cents, o.currency) + '</strong></td></tr></table>' +
      (canReturn ? returnFormHtml() : '') +
      (o.status === 'paid' ? '<div class="order-actions">' +
        '<button class="btn btn-secondary btn-small" data-act="markShipped">Marquer expédiée</button>' +
        '<button class="btn btn-secondary btn-small" data-act="markDelivered">Marquer livr&eacute;e</button>' +
        '<button class="btn btn-secondary btn-small" data-act="revert">R&eacute;initialiser</button>' +
        '<button class="btn btn-danger btn-small" data-act="refund">Rembourser (complet)</button>' +
        '<button class="btn btn-danger btn-small" data-act="deleteOrder">Supprimer la commande</button>' +
        '<button class="btn btn-danger btn-small" data-act="cancelOrder">Annuler la commande</button>' +
        '<button class="btn btn-secondary btn-small" data-act="printInvoice">Facture</button>' +
        '<button class="btn btn-secondary btn-small" data-act="printPacking">Bon de livraison</button>' +
        '<button class="btn btn-secondary btn-small" data-act="printLabel">&Eacute;tiquette</button>' +
        '</div>' : '') +
      '<div id="trackingRow" style="display:none; margin-top:12px;">' +
      '<label style="font-size:12px; color:#5c5548;">Num&eacute;ro de suivi (facultatif)</label>' +
      '<input type="text" id="trackingInput" style="width:100%; padding:8px; border:1px solid #ddd5c4; border-radius:8px;">' +
      '<button class="btn btn-primary btn-small" id="confirmShipBtn" style="margin-top:8px;">Confirmer l&rsquo;exp&eacute;dition</button></div>' +
      '<div id="cancelRow" style="display:none; margin-top:12px;">' +
      '<label style="font-size:12px; color:#5c5548;">Motif de l&rsquo;annulation (envoy&eacute; au client)</label>' +
      '<select id="cancelReason" style="width:100%; padding:8px; border:1px solid #ddd5c4; border-radius:8px; margin:6px 0 8px;">' +
      '<option value="out_of_stock">Article en rupture de stock</option>' +
      '<option value="defective">Article d&eacute;fectueux</option>' +
      '<option value="other">Autre motif</option></select>' +
      '<textarea id="cancelNote" placeholder="Pr&eacute;cision (utilis&eacute;e si motif \u00ab autre \u00bb)" style="width:100%; padding:8px; border:1px solid #ddd5c4; border-radius:8px;"></textarea>' +
      '<button class="btn btn-danger btn-small" id="confirmCancelBtn" style="margin-top:8px;">Confirmer l&rsquo;annulation + envoyer l&rsquo;email</button></div>';
    document.getElementById('orderModal').classList.add('open');
    wireOrderActions(o);
  }

  function wireOrderActions(o) {
    var body = document.getElementById('orderModalBody');
    body.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        if (act === 'refund') {
          if (!confirm('Rembourser intégralement cette commande ?\nLe stock sera ré-augmenté et le client notifié par email.')) return;
          call('refundOrder', { id: o.id })
            .then(function () { return afterUpdate(o.id, 'Commande remboursée'); })
            .catch(function (e) { toast(e.message, 'err'); });
          return;
        }
        if (act === 'deleteOrder') {
          deleteOrder(o.id, o.order_number);
          return;
        }
        if (act === 'cancelOrder') {
          if (!confirm('Annuler la commande ' + o.order_number + ' ?\nLe client recevra automatiquement un email avec le motif.')) return;
          document.getElementById('cancelRow').style.display = 'block';
          return;
        }
        if (act === 'printInvoice' || act === 'printPacking' || act === 'printLabel') {
          window.open('print.html?doc=' + (act === 'printInvoice' ? 'invoice' : act === 'printPacking' ? 'packing' : 'label') + '&order=' + o.id, '_blank');
          return;
        }
        if (act === 'markShipped') {
          document.getElementById('trackingRow').style.display = 'block';
          return;
        }
        if (act === 'confirmShip') {
          call('updateOrder', {
            id: o.id,
            shipping_status: 'shipped',
            tracking_number: document.getElementById('trackingInput').value.trim()
          }).then(function () { return afterUpdate(o.id, 'Marqu\u00e9e exp\u00e9di\u00e9e'); });
          return;
        }
        if (act === 'markDelivered') {
          call('updateOrder', { id: o.id, shipping_status: 'delivered' })
            .then(function () { return afterUpdate(o.id, 'Marqu\u00e9e livr\u00e9e'); });
          return;
        }
        if (act === 'revert') {
          call('updateOrder', { id: o.id, shipping_status: 'new', delivery_type: o.delivery_type, pickup_point: o.pickup_point || undefined })
            .then(function () { return afterUpdate(o.id, 'Statut r\u00e9initialis\u00e9'); });
        }
      });
    });
    var shipBtn = document.getElementById('confirmShipBtn');
    if (shipBtn) shipBtn.addEventListener('click', function () {
      call('updateOrder', {
        id: o.id,
        shipping_status: 'shipped',
        tracking_number: document.getElementById('trackingInput').value.trim()
      }).then(function () { return afterUpdate(o.id, 'Marqu\u00e9e exp\u00e9di\u00e9e'); });
    });
    var cancelBtn = document.getElementById('confirmCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      call('cancelOrder', {
        id: o.id,
        reason: document.getElementById('cancelReason').value,
        comment: document.getElementById('cancelNote').value
      }).then(function (res) {
        return afterUpdate(o.id, res && res.refunded
          ? 'Commande annul\u00e9e, remboursement + email envoy\u00e9s'
          : 'Commande annul\u00e9e, email envoy\u00e9 (remboursement manuel requis)');
      });
    });
    body.querySelectorAll('.return-line').forEach(function (b) {
      b.addEventListener('click', function () {
        var remaining = parseInt(b.getAttribute('data-remaining'), 10) || 1;
        document.getElementById('returnItemId').value = b.getAttribute('data-item') || '';
        var q = document.getElementById('returnQty');
        q.max = remaining;
        q.value = remaining;
        document.getElementById('returnReason').value = 'retour_client';
        document.getElementById('returnRow').style.display = 'block';
      });
    });
    var confirmReturn = document.getElementById('confirmReturnBtn');
    if (confirmReturn) confirmReturn.addEventListener('click', function () {
      var itemId = document.getElementById('returnItemId').value;
      var qty = parseInt(document.getElementById('returnQty').value, 10);
      if (!itemId || !(qty >= 1)) { toast('S\u00e9lectionnez une ligne et une quantit\u00e9 valide', 'err'); return; }
      call('recordReturn', {
        order_id: o.id,
        order_item_id: itemId,
        quantity: qty,
        reason: document.getElementById('returnReason').value,
        return_ref: o.id + ':' + itemId + ':' + Date.now()
      }).then(function (res) {
        toast('Retour enregistr\u00e9' + (res && res.refundCents ? ' (' + money(res.refundCents, o.currency) + ')' : '') + ' \u2014 stock r\u00e9-augment\u00e9', 'ok');
        call('getOrder', { id: o.id }).then(function (r2) {
          if (r2.order) openOrder(r2.order);
        }).catch(function (e) { toast(e.message, 'err'); });
      }).catch(function (e) { toast(e.message, 'err'); });
    });
  }

  function afterUpdate(id, msg) {
    toast(msg, 'ok');
    document.getElementById('orderModal').classList.remove('open');
    return loadOrders();
  }

  function deleteOrder(id, label) {
    if (!confirm('Supprimer d\u00e9finitivement la commande ' + (label || '') + ' ?\nCette action est irr\u00e9versible.')) return;
    call('deleteOrder', { id: id })
      .then(function () {
        document.getElementById('orderModal').classList.remove('open');
        toast('Commande supprim\u00e9e', 'ok');
        return loadOrders();
      })
      .catch(function (e) { toast(e.message, 'err'); });
  }

  function wireOrders() {
    document.getElementById('refreshOrdersBtn').addEventListener('click', loadOrders);
    document.getElementById('filterOrderStatus').addEventListener('change', loadOrders);
    document.getElementById('filterShippingStatus').addEventListener('change', loadOrders);
    document.getElementById('closeOrderBtn').addEventListener('click', function () {
      document.getElementById('orderModal').classList.remove('open');
    });
    // Close by clicking the dark backdrop around the modal.
    document.getElementById('orderModal').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.addEventListener('click', function (e) {
      var dupBtn = e.target.closest('.dup-product');
      if (dupBtn) {
        duplicateProduct(dupBtn.getAttribute('data-id'));
        return;
      }
      var delBtn = e.target.closest('.del-order');
      if (delBtn) {
        deleteOrder(delBtn.getAttribute('data-id'), delBtn.getAttribute('data-number') || '');
        return;
      }
      var viewBtn = e.target.closest('.view-order');
      if (viewBtn) {
        var id = viewBtn.getAttribute('data-id');
        call('getOrder', { id: id }).then(function (res) {
          if (res.order) openOrder(res.order);
        }).catch(function (err) { toast(err.message, 'err'); });
      }
      var editBtn = e.target.closest('.edit-product');
      if (editBtn) {
        var pid = editBtn.getAttribute('data-id');
        var prod = productsAll.filter(function (p) { return p.id === pid; })[0];
        if (prod) openEditor(prod);
      }
    });
  }

  /* ---------------- Ventes & Stock ---------------- */

  var salesAll = null;
  var salesThreshold = 5;

  function periodLabel(p) {
    return { d30: '30 derniers jours', d90: '90 derniers jours', y1: '1 an', all: 'tout' }[p] || p;
  }

  function fmtMonth(key) {
    var m = String(key || '').split('-');
    if (m.length !== 2) return key || '';
    var names = ['janv.', 'f\u00e9vr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'ao\u00fbt', 'sept.', 'oct.', 'nov.', 'd\u00e9c.'];
    return names[parseInt(m[1], 10) - 1] || m[1];
  }

  function loadSales() {
    var period = document.getElementById('salesPeriod').value || 'd30';
    var th = parseInt(document.getElementById('salesThreshold').value, 10);
    salesThreshold = isNaN(th) ? 5 : th;
    return call('saleStats', { period: period, threshold: salesThreshold }).then(function (res) {
      salesAll = res || null;
      renderSales();
    }).catch(function (e) {
      document.getElementById('salesList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function salesKpis(t, cur) {
    var lowWarn = t.lowStock > 0 ? ' style="border-color:#E6B0A2;"' : '';
    return '<div class="stat-cards">' +
      '<div class="stat-card"><strong>' + money(t.netRevenueCents, cur) + '</strong><span>CA net (p\u00e9riode)</span></div>' +
      '<div class="stat-card"><strong>' + t.netUnits + '</strong><span>Unit\u00e9s vendues (net)</span></div>' +
      '<div class="stat-card"><strong>' + t.returnedUnits + '</strong><span>Retours (unit\u00e9s)</span></div>' +
      '<div class="stat-card"><strong>' + t.stockTotal + '</strong><span>Stock disponible</span></div>' +
      '<div class="stat-card"><strong>' + t.orders + '</strong><span>Commandes pay\u00e9es</span></div>' +
      '<div class="stat-card"' + lowWarn + '><strong>' + t.lowStock + '</strong><span>Stock faible (&le; ' + salesThreshold + ')</span></div>' +
      '</div>';
  }

  function salesChart(monthly, cur) {
    var W = 720, H = 200, padB = 24, padT = 10;
    var max = 1;
    monthly.forEach(function (m) { max = Math.max(max, m.revenueCents || 0); });
    var bw = W / Math.max(1, monthly.length);
    var bars = monthly.map(function (m, i) {
      var hh = max > 0 ? Math.round(((m.revenueCents || 0) / max) * (H - padB - padT)) : 0;
      var x = i * bw + bw * 0.18;
      var tip = m.label + ' : ' + money(m.revenueCents, cur) +
        (m.returnedCents > 0 ? ' (retours -' + money(m.returnedCents, cur) + ')' : '') +
        ' \u00b7 ' + m.unitsSold + ' unit\u00e9s vendues' +
        (m.returnedUnits > 0 ? ', ' + m.returnedUnits + ' retourn\u00e9es' : '');
      return '<rect class="bar" x="' + x.toFixed(1) + '" y="' + (H - padB - hh).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + hh + '" rx="3">' +
        '<title>' + esc(tip) + '</title></rect>' +
        '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(fmtMonth(m.key)) + '</text>';
    }).join('');
    return '<svg class="sales-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Chiffre d\u2019affaires mensuel net">' +
      '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="currentColor" stroke-opacity="0.15"/>' +
      bars + '</svg>';
  }

  function salesProductsTable(rows, cur) {
    if (!rows || !rows.length) return '<p class="empty">Aucun produit.</p>';
    return '<table class="admin-table"><thead><tr>' +
      '<th>Produit</th><th>Stock dispo</th><th>Vendu</th><th>Retourn\u00e9</th><th>Net vendu</th><th>CA net</th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        var stock = r.stock == null ? '\u2014' :
          (r.low ? '<span class="badge badge-warn" title="Stock faible">' + r.stock + '</span>' : r.stock);
        return '<tr>' +
          '<td data-label="Produit">' + (r.image ? '<img src="' + esc(r.image) + '" style="width:34px;height:38px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:8px;" alt="">' : '') +
          '<strong>' + esc(r.name) + '</strong><br><small style="color:#8a7d66;">' + esc(r.slug) + '</small></td>' +
          '<td data-label="Stock dispo">' + stock + '</td>' +
          '<td data-label="Vendu">' + r.sold + '</td>' +
          '<td data-label="Retourn\u00e9">' + (r.returned > 0 ? r.returned : '\u2014') + '</td>' +
          '<td data-label="Net vendu">' + (r.sold - r.returned) + '</td>' +
          '<td data-label="CA net">' + money(r.revenueCents - r.returnedCents, cur) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }

  function renderSales() {
    var box = document.getElementById('salesList');
    if (!box) return;
    if (!salesAll) { box.innerHTML = '<p class="empty">Aucune donn\u00e9e.</p>'; return; }
    var t = salesAll.totals || {};
    var cur = (salesAll.currency && salesAll.currency.code) || 'usd';
    var html = salesKpis(t, cur);
    html += '<h3 style="margin:16px 0 6px;">Chiffre d\u2019affaires net \u2014 12 derniers mois</h3>' +
      salesChart(salesAll.monthly || [], cur);
    html += '<h3 style="margin:20px 0 8px;">Produits (' + periodLabel(salesAll.period) + ')</h3>' +
      salesProductsTable(salesAll.products || [], cur);
    box.innerHTML = html;
  }

  function wireSales() {
    var btn = document.getElementById('refreshSalesBtn');
    if (btn) btn.addEventListener('click', loadSales);
    var period = document.getElementById('salesPeriod');
    if (period) period.addEventListener('change', loadSales);
    var th = document.getElementById('salesThreshold');
    if (th) th.addEventListener('change', loadSales);
    var resetBtn = document.getElementById('resetStockBtn');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      if (!confirm('Remettre le stock de TOUS les produits à 0 ?\n\nLes commandes existantes ne sont pas modifiées, mais toute nouvelle vente sera bloquée tant que tu n\u2019auras pas remis du stock. Action irréversible.')) return;
      resetBtn.disabled = true;
      call('resetStock').then(function () {
        toast('Stock remis à zéro', 'ok');
        loadSales();
      }).catch(function (err) {
        toast(err.message, 'err');
        resetBtn.disabled = false;
      });
    });
    var genBtn = document.getElementById('genBarcodesBtn');
    if (genBtn) genBtn.addEventListener('click', function () {
      genBtn.disabled = true;
      call('ensureBarcodes').then(function (res) {
        var n = res.generated || 0;
        toast(n === 0 ? 'Toutes les variantes ont déjà un code' : n + ' code(s) généré(s)', 'ok');
        loadSales();
      }).catch(function (err) {
        toast(err.message, 'err');
      }).then(function () {
        genBtn.disabled = false;
      });
    });
    var printBtn = document.getElementById('printLabelsBtn');
    if (printBtn) printBtn.addEventListener('click', printLabels);
  }

  /* ---- Étiquettes code-barres (feuille A4 à imprimer) ---- */

  function printLabels() {
    call('listProducts').then(function (res) {
      var labels = [];
      (res.products || []).forEach(function (p) {
        (p.variants || []).forEach(function (v) {
          var code = String(v.barcode || '').trim();
          if (!code || v.active === false) return;
          labels.push({
            name: p.name_fr || p.name_en || p.slug,
            variant: [v.color, v.size].filter(Boolean).join(' x '),
            code: code
          });
        });
      });
      if (!labels.length) {
        toast('Aucun code-barres : lancez d\u2019abord \u00ab G\u00e9n\u00e9rer les codes manquants \u00bb', 'err');
        return;
      }
      var w = window.open('', '_blank', 'width=900,height=700');
      if (!w) { toast('Autorisez les fen\u00eatres pop-up pour imprimer', 'err'); return; }
      var printCss =
        '@page { size: A4; margin: 8mm; }' +
        '* { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { font-family: Arial, Helvetica, sans-serif; }' +
        '.labels { display: flex; flex-wrap: wrap; gap: 6mm; }' +
        '.label { width: 60mm; border: 1px dashed #ccc; border-radius: 2mm; padding: 3mm; text-align: center; page-break-inside: avoid; }' +
        '.label .nm { font-weight: bold; font-size: 11px; margin-bottom: 1mm; }' +
        '.label .vt { color: #666; font-size: 10px; margin-bottom: 2mm; }' +
        '.label svg { max-width: 100%; height: auto; }' +
        '@media print { .label { border-color: #aaa; } }';
      var items = labels.map(function (l) {
        return '<div class="label"><div class="nm">' + esc(l.name) + '</div>' +
          '<div class="vt">' + esc(l.variant) + '</div>' +
          '<svg class="bc" data-code="' + esc(l.code) + '"></svg></div>';
      }).join('');
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>\u00c9tiquettes Hanna &amp; Nour</title>' +
        '<script src="vendor/jsbarcode.min.js"><\/script>' +
        '<style>' + printCss + '</style></head><body><div class="labels">' + items + '</div>' +
        '<script>' +
        'function draw(){' +
        '  var els=document.querySelectorAll(".bc");' +
        '  if(!window.JsBarcode){ window.setTimeout(draw,150); return; }' +
        '  for(var i=0;i<els.length;i++){' +
        '    window.JsBarcode(els[i], els[i].getAttribute("data-code"),' +
        '      { format:"CODE128", width:1.6, height:40, displayValue:true, font:"monospace", fontSize:13, margin:0 });' +
        '  }' +
        '  window.setTimeout(function(){ window.print(); }, 200);' +
        '}' +
        'window.setTimeout(draw, 100);' +
        '<\/script></body></html>';
      w.document.open();
      w.document.write(html);
      w.document.close();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------------- Scanner (Ventes & Stock) ---------------- */

  var scanCurrency = { code: 'usd', symbol: '$' };
  var scanTaxRate = 0;
  var scanCart = [];
  var scanLast = null;
  var prepCurrent = null;
  var prepOrders = [];

  function sMoney(cents) {
    return (scanCurrency.symbol || '$') + ((parseInt(cents, 10) || 0) / 100).toFixed(2);
  }

  function setScanStatus(msg, type) {
    var el = document.getElementById('scanStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'scan-status' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
  }

  function focusScan() {
    var panel = document.getElementById('panel-sales');
    var el = document.getElementById('scanInput');
    if (el && panel && panel.classList.contains('active')) {
      try { el.focus(); } catch (e) { /* ignore */ }
    }
  }

  function handleScan(value) {
    var code = String(value || '').trim();
    if (!code) return;
    var rcp = document.getElementById('scanReceipt');
    if (rcp) rcp.innerHTML = '';
    if (prepCurrent) { prepScan(code); return; }
    call('scanLookup', { barcode: code }).then(function (res) {
      scanLast = res;
      scanCurrency = res.currency || scanCurrency;
      renderScanResult();
      setScanStatus('');
    }).catch(function (err) {
      scanLast = null;
      renderScanResult();
      setScanStatus(err.message === 'Article introuvable' ? 'Article introuvable : v\u00e9rifiez le code scann\u00e9.' : err.message, 'err');
    });
  }

  function renderScanResult() {
    var box = document.getElementById('scanResult');
    if (!box) return;
    if (!scanLast) { box.innerHTML = ''; return; }
    var v = scanLast.variant, p = scanLast.product || {}, s = scanLast.stats || {};
    var subTxt = [p.name_fr || p.name_en || 'Article', [v.color, v.size].filter(Boolean).join(' x ')].filter(Boolean).join(' \u2014 ');
    var pills = '';
    pills += '<span class="badge badge-gray">Stock ' + (v.stock || 0) + '</span>';
    pills += '<span class="badge badge-gray">Vendus ' + (s.sold || 0) + '</span>';
    pills += '<span class="badge badge-warn">CA ' + sMoney(s.revenueCents || 0) + '</span>';
    if (s.returned > 0) pills += '<span class="badge badge-red">Retours ' + s.returned + '</span>';
    if (!v.stock) pills += '<span class="badge badge-red">Rupture</span>';
    if (v.active === false) pills += '<span class="badge badge-red">Variante inactive</span>';
    var pendingHtml = '';
    if (scanLast.pending && scanLast.pending.length) {
      pendingHtml = '<div style="flex-basis:100%;font-size:12px;color:#8a7d66;">Commandes en attente : ' +
        scanLast.pending.map(function (x) {
          return '<b>' + esc(x.order_number) + '</b> (x' + x.quantity + ')';
        }).join('&nbsp;|&nbsp;') + '</div>';
    }
    var img = p.image ? '<img class="scan-img" src="' + esc(p.image) + '" alt="">' : '<div class="scan-img"></div>';
    box.innerHTML =
      '<div class="scan-item">' + img +
        '<div class="scan-info">' +
          '<div class="scan-name">' + esc(p.name_fr || p.name_en || v.barcode) + '</div>' +
          '<div class="scan-sub">' + esc(subTxt) + ' &middot; ' + esc(v.barcode) + ' &middot; ' + sMoney(p.price_cents || 0) + '</div>' +
        '</div>' +
        '<div class="scan-pills">' + pills + '</div>' +
        '<div class="scan-actions">' +
          '<button class="btn btn-secondary btn-small" data-scan="inv">Inventaire</button>' +
          '<button class="btn btn-primary btn-small" data-scan="cartAdd" data-vid="' + esc(v.id) + '">Ajouter \u00e0 la caisse</button>' +
        '</div>' +
        '<div class="scan-inv" id="scanInv">' +
          '<input type="number" id="scanInvQty" min="0" step="1" value="' + (v.stock || 0) + '">' +
          '<button class="btn btn-primary btn-small" data-scan="invSave">Enregistrer le comptage</button>' +
          '<span class="scan-hint">Remplace le stock par la quantit\u00e9 r\u00e9elle trouv\u00e9e.</span>' +
        '</div>' +
        pendingHtml +
      '</div>';
  }

  function toggleScanInv(open) {
    var inv = document.getElementById('scanInv');
    if (!inv) return;
    var show = typeof open === 'boolean' ? open : !inv.classList.contains('open');
    inv.classList.toggle('open', show);
    var qty = document.getElementById('scanInvQty');
    if (qty && scanLast) qty.value = scanLast.variant.stock || 0;
  }

  function invSave() {
    if (!scanLast) return;
    var qty = parseInt(document.getElementById('scanInvQty').value, 10);
    if (isNaN(qty) || qty < 0) { setScanStatus('Quantit\u00e9 invalide', 'err'); return; }
    call('scanSetStock', { variant_id: scanLast.variant.id, qty: qty }).then(function () {
      setScanStatus('Stock mis \u00e0 jour', 'ok');
      return call('scanLookup', { barcode: scanLast.variant.barcode });
    }).then(function (res) {
      scanLast = res;
      scanCurrency = res.currency || scanCurrency;
      renderScanResult();
      toggleScanInv(true);
      focusScan();
    }).catch(function (err) {
      setScanStatus(err.message, 'err');
    });
  }

  /* ---- Caisse ---- */

  function cartIndex(vid) {
    for (var i = 0; i < scanCart.length; i++) if (scanCart[i].variant_id === vid) return i;
    return -1;
  }

  function cartAdd() {
    if (!scanLast) return;
    var v = scanLast.variant, p = scanLast.product || {};
    var i = cartIndex(v.id);
    if (i >= 0) { scanCart[i].qty++; }
    else {
      scanCart.push({
        variant_id: v.id,
        name: p.name_fr || p.name_en || 'Article',
        sub: [v.color, v.size].filter(Boolean).join(' x '),
        price_cents: p.price_cents || 0,
        qty: 1
      });
    }
    renderScanCart();
    setScanStatus('Ajout\u00e9 \u00e0 la caisse', 'ok');
    focusScan();
  }

  function cartQty(vid, delta) {
    var i = cartIndex(vid);
    if (i < 0) return;
    scanCart[i].qty = Math.max(1, scanCart[i].qty + delta);
    renderScanCart();
    focusScan();
  }

  function cartDel(vid) {
    var i = cartIndex(vid);
    if (i >= 0) scanCart.splice(i, 1);
    renderScanCart();
    focusScan();
  }

  function scanCartSubtotal() {
    var t = 0;
    scanCart.forEach(function (l) { t += l.price_cents * l.qty; });
    return t;
  }

  function scanCartTotal() {
    var sub = scanCartSubtotal();
    return sub + Math.round(sub * scanTaxRate);
  }

  function renderScanCart() {
    var box = document.getElementById('scanCart');
    if (!box) return;
    var has = scanCart.length > 0;
    box.style.display = has ? 'block' : 'none';
    if (!has) { box.innerHTML = ''; return; }
    var rows = scanCart.map(function (l) {
      return '<div class="cart-row">' +
        '<span class="cart-name">' + esc(l.name) + (l.sub ? '<small>' + esc(l.sub) + '</small>' : '') + '</span>' +
        '<span class="c-ctrl">' +
          '<button data-scan="cartMinus" data-vid="' + esc(l.variant_id) + '" title="Retirer un">&#8722;</button>' +
          '<span class="cqty">' + l.qty + '</span>' +
          '<button data-scan="cartPlus" data-vid="' + esc(l.variant_id) + '" title="Ajouter un">+</button>' +
        '</span>' +
        '<span class="c-line">' + sMoney(l.price_cents * l.qty) + '</span>' +
        '<button class="c-del" data-scan="cartDel" data-vid="' + esc(l.variant_id) + '" title="Retirer la ligne">&times;</button>' +
        '</div>';
    }).join('');
    var sub = scanCartSubtotal();
    var tax = Math.round(sub * scanTaxRate);
    var total = sub + tax;
    box.innerHTML =
      '<div class="cart-head"><b>Vente en cours</b>' +
        '<span style="color:#8a7d66;font-size:12px;">' + scanCart.length + ' ligne(s)</span>' +
        '<button class="btn btn-secondary btn-small" data-scan="cartClear">Vider</button></div>' +
      rows +
      '<div class="cart-totals">' +
        '<div><span>Sous-total</span><b>' + sMoney(sub) + '</b></div>' +
        '<div><span>Taxe</span><b>' + sMoney(tax) + '</b></div>' +
        '<div class="tot"><span>Total \u00e0 encaisser</span><b>' + sMoney(total) + '</b></div>' +
      '</div>' +
      '<input class="cart-cust" id="cartCustomer" placeholder="Nom du client (optionnel)" autocomplete="off">' +
      '<button class="btn btn-primary" id="cartCashBtn">Encaisser &mdash; ' + sMoney(total) + '</button>';
    document.getElementById('cartCashBtn').addEventListener('click', cartCash);
  }

  function cartCash() {
    if (!scanCart.length) return;
    if (!confirm('Encaisser ' + sMoney(scanCartTotal()) + ' (' + scanCart.length + ' ligne(s)) ?\nLe stock sera d\u00e9cr\u00e9ment\u00e9 et la vente enregistr\u00e9e (remise en main propre).')) return;
    var customer = document.getElementById('cartCustomer') ? document.getElementById('cartCustomer').value.trim() : '';
    var items = scanCart.map(function (l) { return { variant_id: l.variant_id, qty: l.qty }; });
    call('scanSale', { items: items, customer_name: customer }).then(function (res) {
      scanCart = [];
      renderScanCart();
      setScanStatus('Vente encaiss\u00e9e \u2014 commande ' + res.order_number, 'ok');
      var rcp = document.getElementById('scanReceipt');
      if (rcp) rcp.innerHTML = '<div class="scan-receipt">' +
        '<div class="ttl">Encaiss\u00e9 \u2014 ' + esc(res.order_number) + '</div>' +
        '<div>Total ' + (res.symbol || scanCurrency.symbol) + ((res.total_cents || 0) / 100).toFixed(2) + '</div>' +
        '</div>';
      if (scanLast) {
        call('scanLookup', { barcode: scanLast.variant.barcode }).then(function (r) {
          scanLast = r;
          scanCurrency = r.currency || scanCurrency;
          renderScanResult();
        }).catch(function () { /* ignore */ });
      }
      focusScan();
    }).catch(function (err) {
      setScanStatus(err.message, 'err');
    });
  }

  /* ---- Pr\u00e9paration de commande ---- */

  function prepLoadOrders(keepSel) {
    var prev = '';
    var sel = document.getElementById('prepOrderSel');
    if (sel) prev = sel.value;
    call('listOrders', { status: 'paid' }).then(function (res) {
      prepOrders = (res.orders || []).filter(function (o) {
        return o.shipping_status !== 'shipped' && o.shipping_status !== 'delivered';
      });
      renderPrep(prev);
    }).catch(function (err) { setScanStatus(err.message, 'err'); });
  }

  function renderPrep(selVal) {
    var box = document.getElementById('scanPrepare');
    if (!box) return;
    var opts = prepOrders.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(o.order_number) + ' \u2014 ' + esc(o.customer_name) + '</option>';
    }).join('');
    var head = '<div class="prep-head"><b>Pr\u00e9parer une commande</b>' +
      '<select id="prepOrderSel">' + (opts || '<option value="">Aucune commande en attente</option>') + '</select>' +
      '<button class="btn btn-secondary btn-small" data-scan="prepLoad">Charger</button></div>';
    var body = '';
    if (prepCurrent) {
      var checked = 0;
      prepCurrent.items.forEach(function (it) { if (it.checked) checked++; });
      var rows = prepCurrent.items.map(function (it) {
        return '<div class="prep-row' + (it.checked ? ' checked' : '') + '">' +
          '<span class="p-check">' + (it.checked ? '\u2713' : '\u25A1') + '</span>' +
          '<span class="p-name">' + esc(it.label) + '<small>x' + it.qty + '</small></span>' +
          '</div>';
      }).join('');
      var all = checked === prepCurrent.items.length && prepCurrent.items.length > 0;
      body = rows +
        '<div class="prep-foot">' +
          '<span id="prepProgress">' + checked + '/' + prepCurrent.items.length + ' v\u00e9rifi\u00e9(s)' + (all ? ' \u2014 complet \u2713' : '') + '</span>' +
          '<button class="btn btn-primary" id="prepShipBtn"' + (all ? '' : ' disabled') + '>Marquer exp\u00e9di\u00e9e</button>' +
          '<button class="btn btn-secondary btn-small" data-scan="prepClose">Fermer la pr\u00e9paration</button>' +
        '</div>';
    } else {
      body = '<div class="scan-hint" style="padding:4px 0;">Scannez chaque article pour le cocher, puis \u00ab Marquer exp\u00e9di\u00e9e \u00bb. Le stock doit \u00eatre suffisant pour l\u2019emballage.</div>';
    }
    box.style.display = 'block';
    box.innerHTML = head + body;
    var sel2 = document.getElementById('prepOrderSel');
    if (sel2 && selVal) sel2.value = selVal;
    var shipBtn = document.getElementById('prepShipBtn');
    if (shipBtn) shipBtn.addEventListener('click', prepShip);
  }

  function prepLoad() {
    var sel = document.getElementById('prepOrderSel');
    if (!sel || !sel.value) { setScanStatus('Choisissez une commande', 'err'); return; }
    call('getOrder', { id: sel.value }).then(function (res) {
      var o = res.order;
      if (!o) { setScanStatus('Commande introuvable', 'err'); return; }
      prepCurrent = {
        id: o.id,
        order_number: o.order_number,
        items: (o.order_items || []).map(function (it) {
          return {
            variant_id: it.variant_id,
            label: it.product_name + (it.variant ? ' (' + it.variant + ')' : ''),
            qty: it.quantity,
            checked: false
          };
        })
      };
      renderPrep(sel.value);
      setScanStatus('Mode pr\u00e9paration : scannez les articles de ' + o.order_number + '.', 'ok');
    }).catch(function (err) { setScanStatus(err.message, 'err'); });
  }

  function prepScan(code) {
    if (!prepCurrent) return;
    call('scanLookup', { barcode: code }).then(function (res) {
      var vid = res.variant && res.variant.id;
      var stock = res.variant ? res.variant.stock : 0;
      var name = res.product ? (res.product.name_fr || res.product.name_en) : '';
      var found = false;
      prepCurrent.items.forEach(function (it) {
        if (it.variant_id === vid) {
          found = true;
          if (stock >= it.qty) {
            it.checked = true;
            setScanStatus('\u2713 ' + (name || 'Article') + ' \u2014 v\u00e9rifi\u00e9', 'ok');
          } else {
            setScanStatus('Stock insuffisant pour ' + (name || 'Article') + ' (' + stock + ' en stock, ' + it.qty + ' command\u00e9).', 'err');
          }
        }
      });
      if (!found) setScanStatus('Cet article ne fait pas partie de la commande.', 'err');
      renderPrep();
      focusScan();
    }).catch(function (err) {
      setScanStatus(err.message === 'Article introuvable' ? 'Code inconnu.' : err.message, 'err');
    });
  }

  function prepShip() {
    if (!prepCurrent) return;
    var done = prepCurrent.items.length > 0 && prepCurrent.items.every(function (it) { return it.checked; });
    if (!done) { setScanStatus('Tous les articles ne sont pas v\u00e9rifi\u00e9s.', 'err'); return; }
    call('updateOrder', { id: prepCurrent.id, shipping_status: 'shipped' }).then(function () {
      setScanStatus('Commande ' + prepCurrent.order_number + ' marqu\u00e9e exp\u00e9di\u00e9e', 'ok');
      prepCurrent = null;
      renderPrep();
      prepLoadOrders();
      focusScan();
    }).catch(function (err) { setScanStatus(err.message, 'err'); });
  }

  function prepClose() {
    prepCurrent = null;
    renderPrep();
    setScanStatus('');
    focusScan();
  }

  function wireScan() {
    var input = document.getElementById('scanInput');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault();
          handleScan(input.value);
          input.value = '';
        }
      });
    }
    var clearBtn = document.getElementById('scanClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      scanLast = null;
      renderScanResult();
      setScanStatus('');
      focusScan();
    });
    // Le scanner tape dans le champ actif : on garde le focus sur la barre de
    // scan tant que le panneau Ventes & Stock est ouvert (sauf champs de saisie).
    document.addEventListener('click', function (e) {
      var t = e.target;
      var interactive = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (!interactive) focusScan();
      var btn = t && t.closest ? t.closest('[data-scan]') : null;
      if (!btn) return;
      var act = btn.getAttribute('data-scan');
      var vid = btn.getAttribute('data-vid');
      if (act === 'cartAdd') cartAdd();
      else if (act === 'inv') toggleScanInv();
      else if (act === 'invSave') invSave();
      else if (act === 'cartPlus') cartQty(vid, 1);
      else if (act === 'cartMinus') cartQty(vid, -1);
      else if (act === 'cartDel') cartDel(vid);
      else if (act === 'cartClear') { scanCart = []; renderScanCart(); focusScan(); }
      else if (act === 'prepLoad') prepLoad();
      else if (act === 'prepClose') prepClose();
    });
    // Même taux de taxe que le serveur (réglages admin) pour le panier.
    call('getSettings').then(function (res) {
      scanTaxRate = parseFloat(res.settings && res.settings.tax_rate) || 0;
    }).catch(function () { /* defaults */ });
  }

  /* ---------------- Settings ---------------- */

  function loadSettings() {
    return call('getSettings').then(function (res) {
      var s = res.settings || {};
      setVal('setStd', dollars(s.standard_cents));
      setVal('setExpr', dollars(s.express_cents));
      setVal('setNext', dollars(s.nextday_cents));
      setVal('setPickup', dollars(s.pickup_cents));
      setVal('setFree', dollars(s.free_threshold_cents));
      setVal('setTax', (parseFloat(s.tax_rate) || 0) * 100);
      setVal('setReturns', parseInt(s.returns_days, 10) || 30);
      document.getElementById('setPickupEnabled').checked = s.pickup_enabled !== false;
      var cur = res.currency || {};
      ADMIN_CURRENCY_SYMBOL = cur.symbol || (cur.code === 'eur' ? '\u20AC' : '$');
      if (cur.code === 'usd' || cur.code === 'eur') {
        document.getElementById('setCurrency').value = cur.code;
      }
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function wireSettings() {
    document.getElementById('saveSettingsBtn').addEventListener('click', function () {
      call('saveSettings', {
        shipping: {
          standard_cents: toCents(getVal('setStd')),
          express_cents: toCents(getVal('setExpr')),
          nextday_cents: toCents(getVal('setNext')),
          pickup_cents: toCents(getVal('setPickup')),
          free_threshold_cents: toCents(getVal('setFree')),
          tax_rate: (parseFloat(getVal('setTax')) || 0) / 100,
          returns_days: parseInt(getVal('setReturns'), 10) || 30,
          pickup_enabled: document.getElementById('setPickupEnabled').checked
        },
        currency: { code: document.getElementById('setCurrency').value }
      }).then(function (res) {
        if (res && res.currency) ADMIN_CURRENCY_SYMBOL = res.currency.symbol || ADMIN_CURRENCY_SYMBOL;
        toast('Paramètres enregistrés', 'ok');
      })
        .catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ---------------- Messages (contact form inbox) ---------------- */

  function loadMessages() {
    return call('listMessages').then(function (res) {
      renderMessages(res.messages || []);
    }).catch(function (e) {
      document.getElementById('messagesList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function renderMessages(list) {
    var box = document.getElementById('messagesList');
    if (!box) return;
    if (!list.length) { box.innerHTML = '<p class="empty">Aucun message.</p>'; return; }
    box.innerHTML = list.map(function (m) {
      return '<div class="card" style="margin-bottom:10px; ' + (m.read ? 'opacity:.65;' : '') + '">' +
        '<div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
        '<div><strong>' + esc(m.name) + '</strong> &lt;<a href="mailto:' + esc(m.email) + '">' + esc(m.email) + '</a>&gt;' +
        (m.subject ? '<br><em>' + esc(m.subject) + '</em>' : '') + '</div>' +
        '<div style="text-align:right; color:#8a7d66; font-size:12px;">' + fmtDate(m.created_at) + '<br>' +
        '<button class="btn btn-secondary btn-small msg-read" data-id="' + m.id + '" data-read="' + (m.read ? 1 : 0) + '">' + (m.read ? 'Non lu' : 'Marquer lu') + '</button> ' +
        '<button class="btn btn-secondary btn-small msg-del" data-id="' + m.id + '">Supprimer</button></div>' +
        '</div>' +
        '<p style="margin:10px 0 0; white-space:pre-wrap;">' + esc(m.message) + '</p>' +
        '</div>';
    }).join('');
  }

  function wireMessages() {
    document.getElementById('refreshMessagesBtn').addEventListener('click', loadMessages);
    document.addEventListener('click', function (e) {
      var del = e.target.closest('.msg-del');
      if (del) {
        if (!confirm('Supprimer ce message ?')) return;
        call('deleteMessage', { id: del.getAttribute('data-id') })
          .then(loadMessages)
          .catch(function (err) { toast(err.message, 'err'); });
        return;
      }
      var read = e.target.closest('.msg-read');
      if (read) {
        var id = read.getAttribute('data-id');
        var markRead = read.getAttribute('data-read') !== '1';
        call('updateMessage', { id: id, read: markRead })
          .then(loadMessages)
          .catch(function (err) { toast(err.message, 'err'); });
        return;
      }
    });
  }

  /* ---------------- Reviews (moderation) ---------------- */

  function stars(rating) {
    var n = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
    return '\u2605'.repeat(n) + '\u2606'.repeat(5 - n);
  }

  function loadReviews() {
    return Promise.all([call('listReviews'), call('getSettings')])
      .then(function (res) {
        renderReviews(res[0].reviews || []);
        var cb = document.getElementById('f-demo_reviews');
        if (cb && res[1] && res[1].reviews) {
          cb.checked = !!res[1].reviews.show_demo;
        }
        return loadDemoReviews();
      })
      .catch(function (e) {
        document.getElementById('reviewsList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
      });
  }

  function renderReviews(list) {
    var box = document.getElementById('reviewsList');
    if (!box) return;
    if (!list.length) { box.innerHTML = '<p class="empty">Aucun avis.</p>'; return; }
    box.innerHTML = list.map(function (r) {
      var prod = r.product || {};
      var approved = r.status === 'approved';
      return '<div class="card" style="margin-bottom:10px; ' + (approved ? 'opacity:.8;' : 'border-color:#d9b98a;') + '">' +
        '<div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
        '<div><strong>' + esc(r.author_name) + '</strong> <span style="color:#b8860b;">' + stars(r.rating) + '</span> ' +
        '<span style="color:#8a7d66;">' + r.rating + '/5</span>' +
        (prod.slug ? '<br><small style="color:#8a7d66;">Produit : <strong>' + esc(prod.name_en || prod.slug) + '</strong> (' + esc(prod.slug) + ')</small>' : '') +
        '</div>' +
        '<div style="text-align:right; color:#8a7d66; font-size:12px;">' + fmtDate(r.created_at) + '<br>' +
        '<span class="badge ' + (approved ? 'badge-green' : 'badge-gray') + '">' + (approved ? 'Publié' : 'En attente') + '</span></div>' +
        '</div>' +
        '<p style="margin:10px 0 0; white-space:pre-wrap;">' + esc(r.body) + '</p>' +
        '<div style="margin-top:10px;">' +
        (!approved ? '<button class="btn btn-primary btn-small rev-approve" data-id="' + r.id + '">Approuver</button> ' : '') +
        '<button class="btn btn-danger btn-small rev-del" data-id="' + r.id + '">Supprimer</button>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  function wireReviews() {
    document.getElementById('refreshReviewsBtn').addEventListener('click', loadReviews);
    var demoCb = document.getElementById('f-demo_reviews');
    if (demoCb) demoCb.addEventListener('change', function () {
      call('saveSettings', { reviews: { show_demo: demoCb.checked } })
        .then(function () { toast('Avis de démonstration ' + (demoCb.checked ? 'affichés' : 'masqués'), 'ok'); })
        .catch(function (err) { toast(err.message, 'err'); demoCb.checked = !demoCb.checked; });
    });
    document.addEventListener('click', function (e) {
      var approve = e.target.closest('.rev-approve');
      if (approve) {
        call('approveReview', { id: approve.getAttribute('data-id') })
          .then(function () { toast('Avis publié', 'ok'); return loadReviews(); })
          .catch(function (err) { toast(err.message, 'err'); });
        return;
      }
      var del = e.target.closest('.rev-del');
      if (del) {
        if (!confirm('Supprimer cet avis ?')) return;
        call('deleteReview', { id: del.getAttribute('data-id') })
          .then(function () { toast('Avis supprimé', 'ok'); return loadReviews(); })
          .catch(function (err) { toast(err.message, 'err'); });
      }
    });
  }

  /* ---------------- Demo reviews (admin-managed) ---------------- */

  var demoAll = [];

  function loadDemoReviews() {
    return call('listDemoReviews').then(function (res) {
      demoAll = res.reviews || [];
      var box = document.getElementById('demoReviewsList');
      if (!box) return;
      if (!demoAll.length) { box.innerHTML = '<p class="empty">Aucun avis de d\u00e9monstration.</p>'; return; }
      box.innerHTML = demoAll.map(function (r) {
        var isActive = r.active !== false;
        return '<div class="card" style="margin-bottom:10px; ' + (isActive ? '' : 'opacity:.6;') + '">' +
          '<div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
          '<div><strong>' + esc(r.author_name) + '</strong> <span style="color:#b8860b;">' + stars(r.rating) + '</span> ' +
          '<span style="color:#8a7d66;">' + r.rating + '/5</span>' +
          (r.location ? ' <small style="color:#8a7d66;">&mdash; ' + esc(r.location) + '</small>' : '') + '</div>' +
          '<div style="text-align:right; color:#8a7d66; font-size:12px;">Pos. ' + (parseInt(r.sort_order, 10) || 0) + '<br>' +
          (isActive ? '<span class="badge badge-green">Affich&eacute;</span>' : '<span class="badge badge-red">Masqu&eacute;</span>') + ' ' +
          (r.verified ? '<span class="badge badge-green">V&eacute;rifi&eacute;</span>' : '') +
          '</div></div>' +
          '<p style="margin:8px 0 0; white-space:pre-wrap; color:#5c5346; font-size:13px;">' + esc(r.body) + '</p>' +
          '<div style="margin-top:8px;">' +
          '<button class="btn btn-secondary btn-small demo-edit" data-id="' + esc(r.id) + '">Modifier</button> ' +
          '<button class="btn btn-danger btn-small demo-del" data-id="' + esc(r.id) + '">Supprimer</button>' +
          '</div></div>';
      }).join('');
    }).catch(function (e) {
      var box = document.getElementById('demoReviewsList');
      if (box) box.innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  var editingDemo = null;

  function openDemoReviewEditor(r) {
    editingDemo = r || {};
    document.getElementById('demoReviewEditorTitle').textContent = r ? 'Modifier l\'avis d\u00e9mo' : 'Nouvel avis d\u00e9mo';
    setVal('d-id', r ? r.id : '');
    setVal('d-author', r ? r.author_name : '');
    document.getElementById('d-rating').value = r ? String(r.rating) : '5';
    setVal('d-body', r ? r.body : '');
    setVal('d-location', r ? r.location : '');
    setVal('d-sort', r ? (parseInt(r.sort_order, 10) || 0) : 0);
    document.getElementById('d-verified').checked = r ? r.verified !== false : true;
    document.getElementById('d-active').checked = r ? r.active !== false : true;
    document.getElementById('deleteDemoReviewBtn').style.display = r ? '' : 'none';
    document.getElementById('demoReviewEditor').classList.add('open');
  }

  function wireDemoReviews() {
    document.getElementById('newDemoReviewBtn').addEventListener('click', function () { openDemoReviewEditor(null); });
    document.getElementById('closeDemoReviewBtn').addEventListener('click', function () {
      document.getElementById('demoReviewEditor').classList.remove('open');
    });
    document.getElementById('demoReviewEditor').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.getElementById('saveDemoReviewBtn').addEventListener('click', function () {
      var author = getVal('d-author');
      var rating = parseInt(getVal('d-rating'), 10);
      var body = getVal('d-body');
      if (!author) { toast('Auteur requis', 'err'); return; }
      if (!(rating >= 1 && rating <= 5)) { toast('Note invalide', 'err'); return; }
      if (!body) { toast('Texte requis', 'err'); return; }
      var btn = this;
      btn.disabled = true;
      call('saveDemoReview', {
        id: editingDemo && editingDemo.id ? editingDemo.id : '',
        author_name: author,
        rating: rating,
        body: body,
        location: getVal('d-location'),
        verified: document.getElementById('d-verified').checked,
        active: document.getElementById('d-active').checked,
        sort_order: parseInt(getVal('d-sort'), 10) || 0
      })
        .then(function () {
          toast('Avis d\u00e9mo enregistr\u00e9', 'ok');
          document.getElementById('demoReviewEditor').classList.remove('open');
          return loadDemoReviews();
        })
        .catch(function (e2) { toast(e2.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    });
    document.getElementById('deleteDemoReviewBtn').addEventListener('click', function () {
      if (!editingDemo || !editingDemo.id) return;
      if (!confirm('Supprimer cet avis d\u00e9mo ?')) return;
      call('deleteDemoReview', { id: editingDemo.id })
        .then(function () {
          toast('Avis d\u00e9mo supprim\u00e9', 'ok');
          document.getElementById('demoReviewEditor').classList.remove('open');
          return loadDemoReviews();
        })
        .catch(function (e) { toast(e.message, 'err'); });
    });
    document.addEventListener('click', function (e) {
      var edit = e.target.closest('.demo-edit');
      if (edit) {
        var id = edit.getAttribute('data-id');
        var found = demoAll.filter(function (r) { return r.id === id; })[0];
        if (found) openDemoReviewEditor(found);
        return;
      }
      var del = e.target.closest('.demo-del');
      if (del) {
        if (!confirm('Supprimer cet avis d\u00e9mo ?')) return;
        call('deleteDemoReview', { id: del.getAttribute('data-id') })
          .then(function () { toast('Avis d\u00e9mo supprim\u00e9', 'ok'); return loadDemoReviews(); })
          .catch(function (err) { toast(err.message, 'err'); });
      }
    });
  }

  /* ---------------- Home (accueil curation) ---------------- */

  var homeState = { bestsellers: [], bestsellers_count: 4, collections: [] };

  function prodLabel(slug) {
    for (var i = 0; i < productsAll.length; i++) {
      if (productsAll[i].slug === slug) return productsAll[i].name_en || slug;
    }
    return slug;
  }

  function prodImage(slug) {
    for (var i = 0; i < productsAll.length; i++) {
      if (productsAll[i].slug === slug) return productsAll[i].image || '';
    }
    return '';
  }

  function moveItem(arr, i, d) {
    var j = i + d;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }

  function loadHome() {
    return Promise.all([call('getSettings'), call('listProducts')]).then(function (res) {
      productsAll = res[1].products || [];
      var h = res[0].home || null;
      homeState.bestsellers = (h && Array.isArray(h.bestsellers) ? h.bestsellers : []).slice();
      homeState.bestsellers_count = Math.max(1, parseInt(h && h.bestsellers_count, 10) || 4);
      homeState.collections = (h && Array.isArray(h.collections) ? h.collections : []).slice();
      renderHome();
    }).catch(function (e) {
      toast(e.message, 'err');
    });
  }

  function renderHome() {
    setVal('homeBestCount', homeState.bestsellers_count);
    var bb = document.getElementById('homeBestList');
    if (bb) {
      if (!homeState.bestsellers.length) {
        bb.innerHTML = '<p class="empty">Aucun produit s\u00e9lectionn\u00e9. Ajoutez-en ci-dessous.</p>';
      } else {
        bb.innerHTML = homeState.bestsellers.map(function (slug, i) {
          return '<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #eee;">' +
            '<span style="min-width:22px; color:#8a7d66;">' + (i + 1) + '.</span>' +
            '<img src="' + esc(prodImage(slug) || 'images/hero.jpg') + '" style="width:46px; height:34px; object-fit:cover; border-radius:6px;" alt="">' +
            '<span style="flex:1;"><strong>' + esc(prodLabel(slug)) + '</strong> <small style="color:#8a7d66;">' + esc(slug) + '</small></span>' +
            '<button class="btn btn-secondary btn-small b-up" data-idx="' + i + '" ' + (i === 0 ? 'disabled' : '') + '>Monter</button>' +
            '<button class="btn btn-secondary btn-small b-down" data-idx="' + i + '" ' + (i === homeState.bestsellers.length - 1 ? 'disabled' : '') + '>Descendre</button>' +
            '<button class="btn btn-danger btn-small b-del" data-idx="' + i + '">Retirer</button>' +
            '</div>';
        }).join('');
      }
    }
    var sel = document.getElementById('homeBestAdd');
    if (sel) {
      var opts = productsAll.filter(function (p) { return homeState.bestsellers.indexOf(p.slug) < 0; });
      if (!opts.length) {
        sel.innerHTML = '<option value="">(tous les produits sont s\u00e9lectionn\u00e9s)</option>';
      } else {
        sel.innerHTML = '<option value="">&mdash; Choisir un produit &mdash;</option>' + opts.map(function (p) {
          return '<option value="' + esc(p.slug) + '">' + esc(p.name_en || p.slug) + '</option>';
        }).join('');
      }
    }
    var cl = document.getElementById('homeColList');
    if (cl) {
      if (!homeState.collections.length) {
        cl.innerHTML = '<p class="empty">Aucune carte collection.</p>';
      } else {
        cl.innerHTML = homeState.collections.map(function (c, i) {
          return '<div style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #eee;">' +
            '<img src="' + esc(c.image || 'images/hero.jpg') + '" style="width:46px; height:34px; object-fit:cover; border-radius:6px;" alt="">' +
            '<span style="flex:1;"><strong>' + esc(c.title || '') + '</strong>' +
            (c.subtitle ? ' <small style="color:#8a7d66;">&mdash; ' + esc(c.subtitle) + '</small>' : '') +
            '<br><small style="color:#8a7d66;">' + esc(c.url || '') + '</small></span>' +
            '<button class="btn btn-secondary btn-small col-up" data-idx="' + i + '" ' + (i === 0 ? 'disabled' : '') + '>Monter</button>' +
            '<button class="btn btn-secondary btn-small col-down" data-idx="' + i + '" ' + (i === homeState.collections.length - 1 ? 'disabled' : '') + '>Descendre</button>' +
            '<button class="btn btn-secondary btn-small col-edit" data-idx="' + i + '">Modifier</button>' +
            '<button class="btn btn-danger btn-small col-del" data-idx="' + i + '">Supprimer</button>' +
            '</div>';
        }).join('');
      }
    }
  }

  var editingColIdx = -1;

  function openCollectionEditor(idx) {
    editingColIdx = idx;
    var c = idx >= 0 && homeState.collections[idx] ? homeState.collections[idx] : { title: '', subtitle: '', image: 'images/hero.jpg', url: 'collections.html' };
    setVal('c-index', idx);
    setVal('c-title', c.title || '');
    setVal('c-subtitle', c.subtitle || '');
    setVal('c-image', c.image || '');
    setVal('c-url', c.url || '');
    document.getElementById('deleteCollectionBtn').style.display = idx >= 0 ? '' : 'none';
    document.getElementById('collectionEditor').classList.add('open');
  }

  function saveCollection() {
    var c = {
      title: getVal('c-title'),
      subtitle: getVal('c-subtitle'),
      image: getVal('c-image') || 'images/hero.jpg',
      url: getVal('c-url') || 'collections.html'
    };
    if (!c.title) { toast('Titre requis', 'err'); return; }
    if (editingColIdx >= 0) homeState.collections[editingColIdx] = c;
    else homeState.collections.push(c);
    document.getElementById('collectionEditor').classList.remove('open');
    renderHome();
  }

  function wireHome() {
    document.getElementById('refreshHomeBtn').addEventListener('click', loadHome);
    document.getElementById('saveHomeBtn').addEventListener('click', function () {
      var n = Math.max(1, Math.min(12, parseInt(getVal('homeBestCount'), 10) || 4));
      homeState.bestsellers_count = n;
      call('saveSettings', { home: { bestsellers: homeState.bestsellers, bestsellers_count: n, collections: homeState.collections } })
        .then(function () { toast('Accueil enregistr\u00e9', 'ok'); })
        .catch(function (e2) { toast(e2.message, 'err'); });
    });
    document.getElementById('homeBestAddBtn').addEventListener('click', function () {
      var slug = document.getElementById('homeBestAdd').value;
      if (!slug) { toast('Choisissez un produit', 'err'); return; }
      if (homeState.bestsellers.indexOf(slug) >= 0) return;
      homeState.bestsellers.push(slug);
      renderHome();
    });
    document.getElementById('homeColAddBtn').addEventListener('click', function () { openCollectionEditor(-1); });
    document.getElementById('closeCollectionBtn').addEventListener('click', function () {
      document.getElementById('collectionEditor').classList.remove('open');
    });
    document.getElementById('collectionEditor').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.getElementById('saveCollectionBtn').addEventListener('click', saveCollection);
    document.getElementById('deleteCollectionBtn').addEventListener('click', function () {
      if (editingColIdx < 0) return;
      if (!confirm('Supprimer cette carte collection ?')) return;
      homeState.collections.splice(editingColIdx, 1);
      document.getElementById('collectionEditor').classList.remove('open');
      renderHome();
    });
    document.addEventListener('click', function (e) {
      var bup = e.target.closest('.b-up');
      if (bup) { moveItem(homeState.bestsellers, parseInt(bup.getAttribute('data-idx'), 10), -1); renderHome(); return; }
      var bdown = e.target.closest('.b-down');
      if (bdown) { moveItem(homeState.bestsellers, parseInt(bdown.getAttribute('data-idx'), 10), 1); renderHome(); return; }
      var bdel = e.target.closest('.b-del');
      if (bdel) {
        homeState.bestsellers.splice(parseInt(bdel.getAttribute('data-idx'), 10), 1);
        renderHome();
        return;
      }
      var cup = e.target.closest('.col-up');
      if (cup) { moveItem(homeState.collections, parseInt(cup.getAttribute('data-idx'), 10), -1); renderHome(); return; }
      var cdown = e.target.closest('.col-down');
      if (cdown) { moveItem(homeState.collections, parseInt(cdown.getAttribute('data-idx'), 10), 1); renderHome(); return; }
      var cedit = e.target.closest('.col-edit');
      if (cedit) { openCollectionEditor(parseInt(cedit.getAttribute('data-idx'), 10)); return; }
      var cdel = e.target.closest('.col-del');
      if (cdel) {
        if (!confirm('Supprimer cette carte collection ?')) return;
        homeState.collections.splice(parseInt(cdel.getAttribute('data-idx'), 10), 1);
        renderHome();
      }
    });
  }

  /* ---------------- Promos (admin CRUD) ---------------- */

  var promosAll = [];

  function loadPromos() {
    return call('listPromos').then(function (res) {
      promosAll = res.promos || [];
      renderPromos();
    }).catch(function (e) {
      document.getElementById('promosList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function renderPromos() {
    var box = document.getElementById('promosList');
    if (!box) return;
    if (!promosAll.length) { box.innerHTML = '<p class="empty">Aucun code promo. Créez le premier !</p>'; return; }
    box.innerHTML = '<table class="admin-table"><thead><tr><th>Code</th><th>Réduction</th><th>Expiration</th><th>Statut</th><th></th></tr></thead><tbody>' +
      promosAll.map(function (p) {
        return '<tr>' +
          '<td data-label="Code"><strong>' + esc(p.code) + '</strong></td>' +
          '<td data-label="R\u00e9duction">' + (parseInt(p.percent_off, 10) || 0) + ' %</td>' +
          '<td data-label="Expiration">' + (p.expires_at ? fmtDate(p.expires_at) : '\u2014') + '</td>' +
          '<td data-label="Statut"><span class="badge ' + (p.active ? 'badge-green' : 'badge-red') + '">' + (p.active ? 'Actif' : 'Inactif') + '</span></td>' +
          '<td data-label=""><span style="white-space:nowrap;">' +
          '<button class="btn btn-secondary btn-small edit-promo" data-code="' + esc(p.code) + '">Modifier</button> ' +
          '<button class="btn btn-danger btn-small del-promo" data-code="' + esc(p.code) + '">Supprimer</button>' +
          '</span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------------- Blog (posts + Notre histoire) ---------------- */

  var postsAll = [];
  var storyState = null;

  function postDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
  }

  function loadBlog() {
    return Promise.all([call('listPosts'), call('getSettings')]).then(function (res) {
      postsAll = res[0].posts || [];
      storyState = res[1].story || null;
      renderPosts();
      renderStoryForm();
    }).catch(function (e) {
      var box = document.getElementById('postsList');
      if (box) box.innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
      toast(e.message, 'err');
    });
  }

  function renderPosts() {
    var box = document.getElementById('postsList');
    if (!box) return;
    if (!postsAll.length) { box.innerHTML = '<p class="empty">Aucun article. Créez le premier !</p>'; return; }
    box.innerHTML = postsAll.map(function (p) {
      return '<div class="card" style="margin-bottom:10px; ' + (p.active === false ? 'opacity:.6;' : '') + '">' +
        '<div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
        '<div style="display:flex; align-items:center; gap:10px;">' +
        '<img src="' + esc(p.image || 'images/hero.jpg') + '" style="width:64px; height:44px; object-fit:cover; border-radius:6px;" alt="">' +
        '<div><strong>' + esc(p.title) + '</strong>' +
        '<br><small style="color:#8a7d66;">' + esc(p.category || '') + ' &mdash; ' + esc(p.author || '') + ' &mdash; ' + postDate(p.published_at) + ' &mdash; ' + (parseInt(p.read_minutes, 10) || 5) + ' min</small>' +
        '</div></div>' +
        '<div style="text-align:right; color:#8a7d66; font-size:12px; white-space:nowrap;">' +
        (p.active === false ? '<span class="badge badge-red">Caché</span> ' : '<span class="badge badge-green">Publié</span> ') +
        '<small>blog-post.html?slug=' + esc(p.slug) + '</small>' +
        '</div></div>' +
        '<div style="display:flex; gap:8px; margin-top:8px;">' +
        '<button class="btn btn-secondary btn-small edit-post" data-id="' + esc(p.id) + '">Modifier</button>' +
        '<button class="btn btn-danger btn-small del-post" data-id="' + esc(p.id) + '">Supprimer</button>' +
        '</div></div>';
    }).join('');
  }

  function renderStoryForm() {
    var s = storyState || {};
    var hero = s.hero || {};
    var craft = s.craft || {};
    setVal('s-hero-subtitle', hero.subtitle || '');
    setVal('s-hero-title', hero.title || '');
    setVal('s-hero-p1', hero.p1 || '');
    setVal('s-hero-p2', hero.p2 || '');
    setVal('s-hero-image', hero.image || '');
    setVal('s-craft-subtitle', craft.subtitle || '');
    setVal('s-craft-title', craft.title || '');
    setVal('s-craft-p1', craft.p1 || '');
    setVal('s-craft-p2', craft.p2 || '');
    setVal('s-craft-image', craft.image || '');
  }

  var editingPost = null;

  function openPostEditor(p) {
    editingPost = p || null;
    document.getElementById('postEditorTitle').textContent = p ? 'Modifier l\'article' : 'Nouvel article';
    setVal('b-id', p ? p.id : '');
    setVal('b-title', p ? p.title : '');
    setVal('b-category', p ? p.category : '');
    setVal('b-slug', p ? p.slug : '');
    setVal('b-image', p ? p.image : '');
    setVal('b-excerpt', p ? p.excerpt : '');
    setVal('b-body', p ? p.body : '');
    setVal('b-author', p ? p.author : '');
    setVal('b-read', p ? (parseInt(p.read_minutes, 10) || 5) : 5);
    setVal('b-date', p && p.published_at ? String(p.published_at).slice(0, 10) : '');
    document.getElementById('b-active').checked = p ? p.active !== false : true;
    document.getElementById('deletePostBtn').style.display = p ? '' : 'none';
    document.getElementById('postEditor').classList.add('open');
  }

  function wireBlog() {
    document.getElementById('refreshBlogBtn').addEventListener('click', loadBlog);
    document.getElementById('newPostBtn').addEventListener('click', function () { openPostEditor(null); });
    document.getElementById('closePostBtn').addEventListener('click', function () {
      document.getElementById('postEditor').classList.remove('open');
    });
    document.getElementById('postEditor').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.getElementById('savePostBtn').addEventListener('click', function () {
      var title = getVal('b-title');
      if (!title) { toast('Titre requis', 'err'); return; }
      var btn = this;
      btn.disabled = true;
      call('savePost', {
        id: editingPost ? editingPost.id : '',
        title: title,
        slug: getVal('b-slug'),
        category: getVal('b-category'),
        image: getVal('b-image'),
        excerpt: getVal('b-excerpt'),
        body: getVal('b-body'),
        author: getVal('b-author'),
        read_minutes: parseInt(getVal('b-read'), 10) || 5,
        published_at: getVal('b-date'),
        active: document.getElementById('b-active').checked
      })
        .then(function () {
          toast('Article enregistré', 'ok');
          document.getElementById('postEditor').classList.remove('open');
          return loadBlog();
        })
        .catch(function (e2) { toast(e2.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    });
    document.getElementById('deletePostBtn').addEventListener('click', function () {
      if (!editingPost || !editingPost.id) return;
      if (!confirm('Supprimer cet article ?')) return;
      call('deletePost', { id: editingPost.id })
        .then(function () {
          toast('Article supprimé', 'ok');
          document.getElementById('postEditor').classList.remove('open');
          return loadBlog();
        })
        .catch(function (e) { toast(e.message, 'err'); });
    });
    document.getElementById('saveStoryBtn').addEventListener('click', function () {
      var story = {
        hero: {
          subtitle: getVal('s-hero-subtitle'),
          title: getVal('s-hero-title'),
          p1: getVal('s-hero-p1'),
          p2: getVal('s-hero-p2'),
          image: getVal('s-hero-image') || 'images/hero.jpg'
        },
        craft: {
          subtitle: getVal('s-craft-subtitle'),
          title: getVal('s-craft-title'),
          p1: getVal('s-craft-p1'),
          p2: getVal('s-craft-p2'),
          image: getVal('s-craft-image') || 'images/craftsmanship.jpg'
        }
      };
      call('saveSettings', { story: story })
        .then(function () {
          toast('Notre histoire enregistrée', 'ok');
          storyState = story;
        })
        .catch(function (e2) { toast(e2.message, 'err'); });
    });
    document.addEventListener('click', function (e) {
      var edit = e.target.closest('.edit-post');
      if (edit) {
        var id = edit.getAttribute('data-id');
        var found = postsAll.filter(function (p) { return p.id === id; })[0];
        if (found) openPostEditor(found);
        return;
      }
      var del = e.target.closest('.del-post');
      if (del) {
        if (!confirm('Supprimer cet article ?')) return;
        call('deletePost', { id: del.getAttribute('data-id') })
          .then(function () { toast('Article supprimé', 'ok'); return loadBlog(); })
          .catch(function (err) { toast(err.message, 'err'); });
      }
    });
  }

  var editingPromo = null;

  function openPromoEditor(p) {
    editingPromo = p || { code: '', percent_off: '', expires_at: '', active: true };
    document.getElementById('promoEditorTitle').textContent = p ? 'Modifier : ' + p.code : 'Nouveau code promo';
    setVal('p-code', editingPromo.code);
    setVal('p-percent', editingPromo.percent_off === '' ? '' : editingPromo.percent_off);
    setVal('p-expires', editingPromo.expires_at ? String(editingPromo.expires_at).slice(0, 10) : '');
    document.getElementById('p-active').checked = editingPromo.active !== false;
    document.getElementById('deletePromoBtn').style.display = p ? '' : 'none';
    document.getElementById('promoEditor').classList.add('open');
  }

  function wirePromos() {
    document.getElementById('newPromoBtn').addEventListener('click', function () { openPromoEditor(null); });
    document.getElementById('closePromoBtn').addEventListener('click', function () {
      document.getElementById('promoEditor').classList.remove('open');
    });
    document.getElementById('promoEditor').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });

    document.getElementById('savePromoBtn').addEventListener('click', function () {
      var btn = this;
      var code = getVal('p-code').toUpperCase();
      var percent = parseInt(getVal('p-percent'), 10);
      if (!code) { toast('Code requis', 'err'); return; }
      if (!(percent >= 1 && percent <= 100)) { toast('Pourcentage invalide (1-100)', 'err'); return; }
      var expires = getVal('p-expires');
      btn.disabled = true;
      call('savePromo', {
        code: code,
        original_code: editingPromo && editingPromo.code ? editingPromo.code : null,
        percent_off: percent,
        active: document.getElementById('p-active').checked,
        expires_at: expires ? new Date(expires + 'T23:59:59').toISOString() : null
      })
        .then(function () {
          toast('Code promo enregistré', 'ok');
          document.getElementById('promoEditor').classList.remove('open');
          return loadPromos();
        })
        .catch(function (e) { toast(e.message, 'err'); })
        .finally(function () { btn.disabled = false; });
    });

    document.getElementById('deletePromoBtn').addEventListener('click', function () {
      if (!editingPromo || !editingPromo.code) return;
      if (!confirm('Supprimer le code ' + editingPromo.code + ' ?')) return;
      call('deletePromo', { code: editingPromo.code })
        .then(function () {
          toast('Code supprimé', 'ok');
          document.getElementById('promoEditor').classList.remove('open');
          return loadPromos();
        })
        .catch(function (e) { toast(e.message, 'err'); });
    });

    document.addEventListener('click', function (e) {
      var edit = e.target.closest('.edit-promo');
      if (edit) {
        var code = edit.getAttribute('data-code');
        var found = promosAll.filter(function (p) { return p.code === code; })[0];
        if (found) openPromoEditor(found);
        return;
      }
      var del = e.target.closest('.del-promo');
      if (del) {
        var delCode = del.getAttribute('data-code');
        if (!confirm('Supprimer le code ' + delCode + ' ?')) return;
        call('deletePromo', { code: delCode })
          .then(function () { toast('Code supprimé', 'ok'); return loadPromos(); })
          .catch(function (err) { toast(err.message, 'err'); });
      }
    });
  }

  /* ---------------- Stats (in-house analytics) ---------------- */

  var statsAll = null;

  function loadStats() {
    return call('analyticsSummary').then(function (res) {
      statsAll = res.summary || null;
      renderStats();
    }).catch(function (e) {
      document.getElementById('statsList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function prodName(slug) {
    for (var i = 0; i < productsAll.length; i++) {
      if (productsAll[i].slug === slug) return productsAll[i].name_en || productsAll[i].name || slug;
    }
    return slug;
  }

  function renderStats() {
    var box = document.getElementById('statsList');
    if (!box) return;
    if (!statsAll) { box.innerHTML = '<p class="empty">Aucune donnée.</p>'; return; }

    var periods = [
      { key: 'all', label: 'Total' },
      { key: 'd30', label: '30 jours' },
      { key: 'd7', label: '7 jours' }
    ];

    function cards(key) {
      var s = statsAll[key];
      if (!s || !s.counts) return '';
      var c = s.counts;
      var conv = c.add_to_cart > 0 ? Math.round((c.purchase / c.add_to_cart) * 100) : 0;
      var convPv = c.pageview > 0 ? Math.round((c.purchase / c.pageview) * 100) : 0;
      return '<div class="stat-cards">' +
        '<div class="stat-card"><strong>' + c.pageview + '</strong><span>Pages vues</span></div>' +
        '<div class="stat-card"><strong>' + c.product_view + '</strong><span>Vues produit</span></div>' +
        '<div class="stat-card"><strong>' + c.add_to_cart + '</strong><span>Ajouts panier</span></div>' +
        '<div class="stat-card"><strong>' + c.checkout_attempt + '</strong><span>Checkouts</span></div>' +
        '<div class="stat-card"><strong>' + c.purchase + '</strong><span>Ventes</span></div>' +
        '<div class="stat-card"><strong>' + conv + '&nbsp;%</strong><span>Taux panier&rarr;vente</span></div>' +
        '<div class="stat-card"><strong>' + convPv + '&nbsp;%</strong><span>Taux page&rarr;vente</span></div>' +
        '</div>';
    }

    function topTable(rows, emptyText) {
      if (!rows || !rows.length) return '<p class="empty">' + emptyText + '</p>';
      return '<table class="admin-table"><thead><tr><th>Vue</th><th>Nombre</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var label = r.slug ? esc(prodName(r.slug)) : r.path ? esc(r.path).replace(/\?.*$/, '') : esc(String(r.path || r.slug));
          var n = r.views != null ? r.views : r.count;
          return '<tr><td data-label="Vue">' + label + '</td><td data-label="Nombre">' + n + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    var html = periods.map(function (p) {
      return '<h3 style="margin:14px 0 8px;">' + p.label + '</h3>' + cards(p.key);
    }).join('');

    html += '<h3 style="margin:20px 0 8px;">Produits les plus vus (30 jours)</h3>' +
      topTable(statsAll.d30 && statsAll.d30.topProducts, 'Aucune vue produit.');
    html += '<h3 style="margin:20px 0 8px;">Pages les plus visitées (30 jours)</h3>' +
      topTable(statsAll.d30 && statsAll.d30.topPaths, 'Aucune page.');

    box.innerHTML = html;
  }

  function wireStats() {
    var btn = document.getElementById('refreshStatsBtn');
    if (btn) btn.addEventListener('click', loadStats);
    var reset = document.getElementById('resetStatsBtn');
    if (reset) reset.addEventListener('click', function () {
      if (!confirm('Remettre les statistiques \u00e0 z\u00e9ro ?\nToutes les donn\u00e9es d\u2019analyse seront d\u00e9finitivement supprim\u00e9es.')) return;
      call('resetStats', { confirm: true })
        .then(function () {
          toast('Statistiques remises \u00e0 z\u00e9ro', 'ok');
          return loadStats();
        })
        .catch(function (e) { toast(e.message, 'err'); });
    });
  }

  /* ---------------- Filters ---------------- */

  function wireFilters() {
    document.getElementById('filterProducts').addEventListener('input', renderProducts);
    document.getElementById('filterCategory').addEventListener('change', renderProducts);
  }

  /* ---------------- Boot ---------------- */

  function boot() {
    loadProducts();
  }

  wireLogin();
  wireForgot();
  wireTabs();
  wireEditor();
  wireOrders();
  wireSales();
  wireScan();
  wireReviews();
  wireDemoReviews();
  wireHome();
  wireBlog();
  wirePromos();
  wireStats();
  wireMessages();
  wireSettings();
  wireFilters();

  if (token()) {
    call('listProducts').then(function () {
      showApp(true);
      boot();
    }).catch(function () {
      logout();
    });
  }

  document.getElementById('loginErr').style.display = 'none';
})();