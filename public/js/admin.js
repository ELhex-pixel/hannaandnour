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

  var token = window.HN_ADMIN.token;
  var call = window.HN_ADMIN.call;

  function toast(msg, type) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
    setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  function money(cents, currency) {
    var sym = ADMIN_CURRENCY_SYMBOL;
    if (currency === 'eur') sym = '\u20AC';
    else if (currency === 'usd') sym = '$';
    else if (ADMIN_CURRENCY_SYMBOL) sym = ADMIN_CURRENCY_SYMBOL;
    return sym + ((parseInt(cents, 10) || 0) / 100).toFixed(2);
  }
  var ADMIN_CURRENCY_SYMBOL = '';
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
    closeProductEditor();
    productSelection = {};
    productsAll = [];
    productRequest++;
    document.getElementById('productsList').textContent = '';
    document.getElementById('productStats').textContent = '';
    prepRevision++;
    prepListRequest++;
    prepBusy = false;
    prepCurrent = null;
    prepOrders = [];
    document.getElementById('scanPrepare').textContent = '';
    document.getElementById('prepStatus').textContent = '';
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
    document.dispatchEvent(new CustomEvent('hn:admin-logout'));
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
      if (pw.length < 8 || pw.length > 256) { msgError('Le nouveau mot de passe doit contenir 8 à 256 caractères.'); return; }
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
    var descriptions = {
      products: 'Gérez vos fiches, vos photos et leur visibilité.',
      orders: 'Retrouvez les achats et suivez les étapes de chaque commande.',
      returns: 'Consultez les demandes liées aux comptes clients et décidez de leur traitement.',
      tiktok: 'Préparez un fichier officiel sans modifier le stock du site.',
      sales: 'Comprenez les ventes, le stock disponible et la préparation.',
      inventory: 'Suivez les quantités disponibles par taille et coloris, les arrivages et les ajustements.',
      preparation: 'Vérifiez les articles payés et préparez les colis sans modifier le stock.',
      reviews: 'Consultez et modérez les avis de la boutique.',
      home: 'Organisez les contenus et les visuels de la page d’accueil.',
      blog: 'Gérez les articles du journal de la boutique.',
      promos: 'Gérez vos codes et leurs conditions d’utilisation.',
      stats: 'Consultez les visites et les étapes du parcours d’achat.',
      messages: 'Retrouvez les messages reçus depuis le site.',
      settings: 'Vérifiez vos paramètres de livraison, devise et services.'
    };
    document.querySelectorAll('.admin-tab').forEach(function (btn, index) {
      btn.setAttribute('data-index', ('0' + (index + 1)).slice(-2));
      btn.setAttribute('aria-controls', 'panel-' + btn.getAttribute('data-tab'));
      btn.setAttribute('aria-current', btn.classList.contains('active') ? 'page' : 'false');
      btn.addEventListener('click', function () {
        document.querySelectorAll('.admin-tab').forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-current', 'false'); });
        document.querySelectorAll('.admin-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
        document.getElementById('adminSectionTitle').textContent = btn.textContent;
        document.getElementById('adminSectionDescription').textContent = descriptions[btn.getAttribute('data-tab')] || '';
        var id = 'panel-' + btn.getAttribute('data-tab');
        var panel = document.getElementById(id);
        panel.classList.add('active');
        if (id === 'panel-products') loadProducts();
        if (id === 'panel-orders') loadOrders();
        if (id === 'panel-sales') { loadSales(); focusScan(); }
        if (id === 'panel-preparation') prepLoadOrders();
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
  var productSelection = {};
  var productRequest = 0;
  var archiveBusy = false;

  function updateProductSelection() {
    var count = Object.keys(productSelection).length;
    document.getElementById('productSelectionCount').textContent = count ? count + ' produit(s) sélectionné(s), y compris hors filtre' : 'Aucun produit sélectionné';
    document.getElementById('archiveSelectedProducts').disabled = !count || archiveBusy;
    document.getElementById('clearProductSelection').disabled = !count || archiveBusy;
  }

  function productRow(p) {
    var cat = { hijab: 'Hijab', abaya: 'Abaya', prayer: 'Tenue de prière', dress: 'Robe', accessory: 'Accessoire', knitwear: 'Pull / maille', jacket: 'Veste', skirt: 'Jupe', top: 'Haut', trousers: 'Pantalon' }[p.category] || p.category;
    var totalStock = (p.variants || []).reduce(function (n, v) { return n + (v.active === false ? 0 : (parseInt(v.stock, 10) || 0)); }, 0);
    var managed = (p.variants || []).length > 0;
    return '<tr>' +
      '<td data-label="Sélection"><input type="checkbox" class="select-product" data-id="' + esc(p.id) + '" aria-label="Sélectionner ' + esc(p.name_fr || p.name_en) + '"' + (productSelection[p.id] ? ' checked' : '') + (archiveBusy ? ' disabled' : '') + '></td>' +
      '<td data-label=""><img class="thumb" src="' + esc(p.image || 'images/hero.jpg') + '" alt=""></td>' +
      '<td data-label="Produit"><strong>' + esc(p.name_fr || p.name_en) + '</strong><br><small>' + esc(p.sku || p.slug) + '</small></td>' +
      '<td data-label="Prix">' + money(p.price_cents) + '</td>' +
      '<td data-label="Cat\u00e9gorie">' + esc(cat) + '</td>' +
      '<td data-label="Stock">' + (managed ? '<span class="badge ' + (totalStock ? 'badge-green' : 'badge-red') + '">' + (totalStock ? totalStock + ' disponibles' : 'Épuisé') + '</span>' : '<span class="badge badge-warn">Stock non configuré</span>') + '</td>' +
      '<td data-label="Visibilité"><span class="badge ' + (p.active ? 'badge-green' : 'badge-gray') + '">' + (p.active ? 'En ligne' : 'Hors ligne / archivé') + '</span></td>' +
      '<td data-label=""><span style="white-space:nowrap;">' +
      '<button class="btn btn-secondary btn-small edit-product" data-id="' + esc(p.id) + '">Modifier</button> ' +
      '<button class="btn btn-secondary btn-small dup-product" title="Dupliquer en brouillon avec un stock à zéro" data-id="' + esc(p.id) + '">Dupliquer</button>' +
      '</span></td></tr>';
  }

  function loadProducts() {
    var request = ++productRequest;
    var owner = token();
    return call('listProducts').then(function (res) {
      if (request !== productRequest || owner !== token()) return;
      productsAll = res.products || [];
      Object.keys(productSelection).forEach(function (id) { if (!productsAll.some(function (p) { return p.id === id; })) delete productSelection[id]; });
      renderProducts();
    }).catch(function (e) {
      if (request !== productRequest || owner !== token()) return;
      document.getElementById('productsList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function renderProducts() {
    var box = document.getElementById('productsList');
    var q = (document.getElementById('filterProducts').value || '').toLowerCase();
    var cat = document.getElementById('filterCategory').value;
    var visibility = document.getElementById('filterProductVisibility').value;
    var active = productsAll.filter(function (p) { return p.active; }).length;
    var missing = productsAll.filter(function (p) { return p.active && !(p.variants || []).length; }).length;
    document.getElementById('productStats').innerHTML = [
      [productsAll.length, 'Fiches catalogue'], [active, 'Produits en ligne'], [productsAll.length - active, 'Hors ligne / archivés'], [missing, 'En ligne sans stock configuré']
    ].map(function (item) { return '<div class="stat-card"><strong>' + item[0] + '</strong><span>' + item[1] + '</span></div>'; }).join('');
    var list = productsAll.filter(function (p) {
      if (visibility === 'active' && !p.active) return false;
      if (visibility === 'inactive' && p.active) return false;
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return (p.name_en + ' ' + p.slug + ' ' + (p.sku || '') + ' ' + (p.category || '') + ' ' + (p.name_fr || '') + ' ' + (p.name_ar || '')).toLowerCase().indexOf(q) >= 0;
    });
    updateProductSelection();
    if (!list.length) { box.innerHTML = '<p class="empty">Aucun produit pour ces filtres. Changez la recherche ou créez une fiche.</p>'; return; }
    box.innerHTML = '<table class="admin-table"><thead><tr><th><input type="checkbox" id="selectVisibleProducts" aria-label="Sélectionner les produits affichés"' + (list.every(function (p) { return productSelection[p.id]; }) ? ' checked' : '') + (archiveBusy ? ' disabled' : '') + '></th><th>Photo</th><th>Produit</th><th>Prix</th><th>Catégorie</th><th>Stock</th><th>Visibilité</th><th>Actions</th></tr></thead><tbody>' +
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
        return { color: v.color || '', size: v.size || '', stock: 0 };
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
  var editorRevision = 0;
  var imageBusy = false;
  var galleryStop = false;
  var editorReturnFocus = null;

  function closeProductEditor() {
    editorRevision++;
    imageBusy = false;
    galleryStop = true;
    document.getElementById('productEditor').classList.remove('open');
    document.body.style.overflow = '';
    document.getElementById('saveProductBtn').disabled = false;
    document.getElementById('uploadMainBtn').disabled = false;
    document.getElementById('uploadGalleryBtn').disabled = false;
    document.getElementById('uploadMainBtn').textContent = 'Uploader une photo';
    document.getElementById('deleteProductBtn').disabled = false;
    document.getElementById('stopGalleryUpload').hidden = true;
    document.dispatchEvent(new CustomEvent('hn:product-editor'));
    if (editorReturnFocus && document.contains(editorReturnFocus)) editorReturnFocus.focus();
  }

  function openEditor(p) {
    editorRevision++;
    imageBusy = false;
    galleryStop = false;
    editorReturnFocus = document.activeElement;
    ['saveProductBtn', 'uploadMainBtn', 'uploadGalleryBtn', 'deleteProductBtn'].forEach(function (id) { document.getElementById(id).disabled = false; });
    document.getElementById('uploadMainBtn').textContent = 'Uploader une photo';
    document.getElementById('galleryUploadStatus').hidden = true;
    document.getElementById('stopGalleryUpload').hidden = true;
    document.dispatchEvent(new CustomEvent('hn:product-editor'));
    editing = p || {
      name_en: '', name_fr: '', name_ar: '',
      description_en: '', description_fr: '', description_ar: '',
      features_en: [], features_fr: [], features_ar: [],
      care_en: [], care_fr: [], care_ar: [],
      fabrics: [], occasions: [], colors: [], sizes: [],
      fabric_comp_en: '', fabric_comp_fr: '', fabric_comp_ar: '',
      price_cents: '', compare_at_price_cents: '', category: 'hijab',
      badge: '', rating: 4.5, review_count: 0, image: 'images/hero.jpg', gallery: [],
      is_featured: false, is_bestseller: false, active: false, variants: []
    };

    document.getElementById('editorTitle').textContent = p ? 'Modifier : ' + (p.name_fr || p.name_en || p.slug) : 'Nouveau produit';
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
    ['fit', 'measurements'].forEach(function (field) { ['en', 'fr', 'ar'].forEach(function (lang) { setVal('f-' + field + '_' + lang, editing[field + '_' + lang] || ''); }); });
    setVal('f-opacity', editing.opacity || 'unspecified');
    setVal('f-video_url', editing.video_url || '');
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
    document.body.style.overflow = 'hidden';
    document.getElementById('productEditor').scrollTop = 0;
    document.getElementById('closeEditorBtn').focus();
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
      var persisted = (editing.variants || []).some(function (v) { return v.id && v.color === r.color && v.size === r.size; });
      return '<div class="variant-row" data-i="' + i + '">' +
        (r.color ? colorCellHtml(r.color) : '<input type="text" class="v-color" value="" placeholder="Couleur">') +
        '<input type="text" class="v-size" value="' + esc(r.size) + '" placeholder="Taille" ' + (r.size ? 'readonly' : '') + '>' +
        '<input type="number" class="v-stock" min="0" step="1" value="' + (stockFor(r.color, r.size) === '' ? '' : stockFor(r.color, r.size)) + '" placeholder="0"' + (persisted ? ' readonly aria-label="Stock existant, à ajuster dans la rubrique Stock"' : ' aria-label="Stock initial de la nouvelle variante"') + '>' +
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
      var existing = (editing.variants || []).filter(function (variant) { return variant.color === color && variant.size === size; })[0];
      out.push({
        color: color,
        size: size,
        stock: Math.max(0, parseInt(stockRaw, 10) || 0),
        expected_stock: existing ? existing.stock : null,
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
    ['fit', 'measurements'].forEach(function (field) { ['en', 'fr', 'ar'].forEach(function (lang) { p[field + '_' + lang] = getVal('f-' + field + '_' + lang); }); });
    p.opacity = getVal('f-opacity');
    p.video_url = getVal('f-video_url');
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
        '<img src="' + esc(lines[i]) + '" alt="Image ' + (i + 1) + '">' +
        '<div class="g-actions">' +
        '<button type="button" class="btn btn-secondary btn-small g-main" aria-label="Choisir la photo ' + (i + 1) + ' comme image principale">' + (lines[i] === getVal('f-image') ? 'Principale' : 'Choisir principale') + '</button>' +
        '<button type="button" class="btn btn-secondary btn-small g-up" aria-label="Monter la photo ' + (i + 1) + '"' + (i === 0 ? ' disabled' : '') + '>&uarr;</button>' +
        '<button type="button" class="btn btn-secondary btn-small g-down" aria-label="Descendre la photo ' + (i + 1) + '"' + (i === lines.length - 1 ? ' disabled' : '') + '>&darr;</button>' +
        '<button type="button" class="btn btn-danger btn-small g-del" aria-label="Retirer la photo ' + (i + 1) + ' de la galerie">&times;</button>' +
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
    document.getElementById('closeEditorBtn').addEventListener('click', closeProductEditor);
    document.addEventListener('keydown', function (e) {
      var dialog = document.getElementById('productEditor');
      if (!dialog.classList.contains('open')) return;
      if (e.key === 'Escape') { closeProductEditor(); return; }
      if (e.key !== 'Tab') return;
      var focusable = Array.prototype.filter.call(dialog.querySelectorAll('button, input, select, textarea, a[href]'), function (node) { return !node.disabled && node.getClientRects().length; });
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    // Close by clicking the dark backdrop around the editor.
    document.getElementById('productEditor').addEventListener('click', function (e) {
      if (e.target === this) { closeProductEditor(); return; }
      var section = e.target.closest('[data-editor-section]');
      if (section) { document.getElementById(section.getAttribute('data-editor-section')).scrollIntoView({ block: 'start' }); return; }
      var main = e.target.closest('.g-main');
      if (main) { setVal('f-image', galleryLines()[parseInt(main.closest('.gallery-item').getAttribute('data-i'), 10)]); renderGalleryGrid(); return; }
      var up = e.target.closest('.g-up');
      if (up) { moveGallery(parseInt(up.closest('.gallery-item').getAttribute('data-i'), 10), -1); return; }
      var down = e.target.closest('.g-down');
      if (down) { moveGallery(parseInt(down.closest('.gallery-item').getAttribute('data-i'), 10), 1); return; }
      var del = e.target.closest('.g-del');
      if (del) { deleteGallery(parseInt(del.closest('.gallery-item').getAttribute('data-i'), 10)); return; }
      if (e.target.closest('#galleryUrlAdd')) { addGalleryUrl(); return; }
    });
    document.getElementById('newProductBtn').addEventListener('click', function () { openEditor(null); });
    document.getElementById('editInventoryBtn').addEventListener('click', function () {
      var variant = (editing.variants || [])[0];
      closeProductEditor();
      document.querySelector('[data-tab="inventory"]').click();
      if (variant && variant.id) document.dispatchEvent(new CustomEvent('hn:inventory-variant', { detail: variant.id }));
    });
    document.getElementById('f-colors').addEventListener('input', buildVariantGrid);
    document.getElementById('f-sizes').addEventListener('input', buildVariantGrid);
    wireColorsPicker();
    document.getElementById('f-gallery').addEventListener('input', renderGalleryGrid);
    var galleryUrlInput = document.getElementById('galleryUrl');
    if (galleryUrlInput) galleryUrlInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addGalleryUrl();
    });

    document.getElementById('saveProductBtn').addEventListener('click', function () {
      var btn = this;
      if (btn.disabled || imageBusy) return;
      var revision = editorRevision;
      var owner = token();
      var payload;
      try { payload = collectProduct(); } catch (e) { toast(e.message, 'err'); return; }
      lockProductImages(true);
      call('saveProduct', payload)
        .then(function () {
          if (revision !== editorRevision || owner !== token()) return;
          toast(payload.id ? 'Produit mis à jour' : 'Produit créé', 'ok');
          closeProductEditor();
          return loadProducts();
        })
        .catch(function (e) { if (revision === editorRevision && owner === token()) toast(e.message, 'err'); })
        .finally(function () { if (revision === editorRevision) lockProductImages(false); });
    });

    document.getElementById('deleteProductBtn').addEventListener('click', function () {
      if (this.disabled) return;
      var id = document.getElementById('f-id').value;
      if (!id) return;
      if (!confirm('Archiver ce produit ? Il ne sera plus vendu ; les variantes et l’historique seront conservés.')) return;
      var btn = this, revision = editorRevision, owner = token();
      lockProductImages(true);
      call('deleteProduct', { id: id })
        .then(function () {
          if (revision !== editorRevision || owner !== token()) return;
          toast('Produit archivé', 'ok');
          closeProductEditor();
          return loadProducts();
        })
        .catch(function (e) { if (revision === editorRevision && owner === token()) toast(e.message, 'err'); })
        .finally(function () { if (revision === editorRevision && owner === token()) lockProductImages(false); });
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
        input.value = '';
        var revision = editorRevision, owner = token();
        var productPhoto = btnId === 'uploadMainBtn';
        if (productPhoto && imageBusy) return;
        function active() { return owner === token() && (!productPhoto || revision === editorRevision); }
        if (productPhoto) lockProductImages(true);
        btn.disabled = true;
        var originalLabel = btn.textContent;
        btn.textContent = 'Envoi…';
        window.HN_ADMIN.uploadImages([file], {
          active: active,
          success: function (url) { onUrl(url); toast('Photo ajoutée — enregistrez la fiche pour la conserver.', 'ok'); }
        }).then(function (res) { if (active() && res.failed.length) toast(res.failed[0].error, 'err'); })
          .catch(function (e) { if (active()) toast(e.message, 'err'); })
          .finally(function () {
            if (!active()) return;
            btn.textContent = originalLabel;
            btn.disabled = false;
            if (productPhoto) lockProductImages(false);
          });
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
    bind('uploadMainBtn', 'fileMain', function (url) { setVal('f-image', url); document.dispatchEvent(new CustomEvent('hn:main-image-uploaded')); });
    var galleryInput = document.getElementById('fileGallery');
    var galleryButton = document.getElementById('uploadGalleryBtn');
    var status = document.getElementById('galleryUploadStatus');
    var stop = document.getElementById('stopGalleryUpload');
    var drop = document.getElementById('galleryDropZone');
    function uploadGallery(files) {
      if (imageBusy || !files.length) return;
      var revision = editorRevision, owner = token();
      function active() { return revision === editorRevision && owner === token(); }
      galleryStop = false;
      lockProductImages(true);
      stop.hidden = false;
      stop.disabled = false;
      status.hidden = false;
      status.textContent = 'Préparation des photos…';
      window.HN_ADMIN.uploadImages(files, {
        active: active,
        stop: function () { return galleryStop; },
        progress: function (file, index, res) { status.textContent = 'Photo ' + index + '/' + res.total + ' : ' + file.name; },
        success: function (url) {
          var lines = galleryLines();
          if (lines.indexOf(url) < 0) lines.push(url);
          saveGalleryLines(lines);
        }
      }).then(function (res) {
        if (!active()) return;
        status.textContent = res.uploaded + ' photo(s) ajoutée(s)' + (res.stopped ? ' — envoi arrêté' : '') + '. Enregistrez la fiche pour conserver la galerie.';
        res.failed.forEach(function (failure) {
          var line = document.createElement('p');
          line.textContent = failure.name + ' : ' + failure.error + '. Vous pouvez sélectionner à nouveau cette photo.';
          status.appendChild(line);
        });
      }).catch(function (error) { if (active()) status.textContent = error.message; })
        .finally(function () { if (active()) { lockProductImages(false); stop.hidden = true; } });
    }
    galleryButton.addEventListener('click', function () { galleryInput.click(); });
    galleryInput.addEventListener('change', function () { var files = Array.prototype.slice.call(galleryInput.files || []); galleryInput.value = ''; uploadGallery(files); });
    stop.addEventListener('click', function () { galleryStop = true; stop.disabled = true; });
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.classList.toggle('is-dragging', name === 'dragenter' || name === 'dragover');
        if (name === 'drop' && event.dataTransfer) uploadGallery(Array.prototype.slice.call(event.dataTransfer.files));
      });
    });
    bind('uploadPostBtn', 'filePost', function (url) { setVal('b-image', url); }, 'Uploader une image');
    bind('uploadHeroBtn', 'fileHero', function (url) { setVal('s-hero-image', url); }, 'Uploader une image');
    bind('uploadCraftBtn', 'fileCraft', function (url) { setVal('s-craft-image', url); }, 'Uploader une image');
    bind('uploadCollBtn', 'fileColl', function (url) { setVal('c-image', url); }, 'Uploader une image');
    wirePreview('b-image', 'previewPost');
    wirePreview('s-hero-image', 'previewHero');
    wirePreview('s-craft-image', 'previewCraft');
    wirePreview('c-image', 'previewColl');
    wirePreview('f-image', 'previewMain');
  }

  function lockProductImages(busy) {
    imageBusy = busy;
    ['saveProductBtn', 'uploadMainBtn', 'uploadGalleryBtn', 'deleteProductBtn'].forEach(function (id) { document.getElementById(id).disabled = busy; });
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
    var canReturn = ['paid','refunded'].includes(o.status) && ['shipped','delivered'].includes(o.shipping_status);
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
      '<label for="returnSellable">Unités contrôlées et revendables</label><input type="number" id="returnSellable" min="0" step="1" placeholder="0 si aucun">' +
      '<label for="returnInspection">Note du contrôle physique</label><textarea id="returnInspection" minlength="3" maxlength="500"></textarea>' +
      '<p>Aucun remboursement automatique. Les unités non revendables restent hors vente. Une demande client ouverte doit être traitée dans Retours clients.</p>' +
      '<button class="btn btn-primary btn-small" id="confirmReturnBtn" style="margin-top:8px;">Confirmer la réception et le contrôle</button><p id="manualReturnStatus" role="status"></p></div>';
  }

  var manualReturnPending = null, manualReturnBusy = false;
  try { manualReturnPending = token() ? JSON.parse(sessionStorage.getItem('hn-admin-return-operation') || 'null') : null; } catch (e) {}
  document.addEventListener('hn:admin-logout',function () { manualReturnPending = null; manualReturnBusy = false; sessionStorage.removeItem('hn-admin-return-operation'); document.getElementById('orderModal').classList.remove('open'); document.getElementById('orderModalBody').textContent = ''; });

  function openOrder(o) {
    document.getElementById('orderModalTitle').textContent = 'Commande ' + o.order_number;
    var addressBlock = o.delivery_type === 'pickup'
      ? '<p><strong>Retrait :</strong> ' + esc(o.pickup_point || '-') + '</p>'
      : '<p>' + esc(o.address1) + (o.address2 ? ' ' + esc(o.address2) : '') + '<br>' +
        esc(o.city) + (o.state ? ' ' + esc(o.state) : '') + ' ' + esc(o.postal_code) + '<br>' + esc(o.country) + '</p>';

    var canReturn = ['paid','refunded'].includes(o.status) && ['shipped','delivered'].includes(o.shipping_status);
    var ret = returnedByItem(o);

    document.getElementById('orderModalBody').innerHTML =
      (o.stock_issue ? '<p role="alert" class="badge badge-red">Paiement reçu mais stock insuffisant : vérifier avant expédition.</p>' : '') +
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
      '<label for="carrierInput">Transporteur</label><select id="carrierInput"><option value="">Non renseigné</option><option value="colissimo">Colissimo</option><option value="chronopost">Chronopost</option><option value="mondialrelay">Mondial Relay</option><option value="dhl">DHL</option></select>' +
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
    document.getElementById('trackingInput').value = o.tracking_number || '';
    document.getElementById('carrierInput').value = o.carrier || '';
    wireOrderActions(o);
  }

  function wireOrderActions(o) {
    var body = document.getElementById('orderModalBody');
    body.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        if (act === 'refund') {
          if (!confirm('Rembourser intégralement cette commande ?\nAprès expédition, aucun article ne revient automatiquement en stock : contrôlez son retour séparément. Le client sera notifié par email si l’envoi réussit.')) return;
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
            tracking_number: document.getElementById('trackingInput').value.trim(),
            carrier: document.getElementById('carrierInput').value
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
        tracking_number: document.getElementById('trackingInput').value.trim(),
        carrier: document.getElementById('carrierInput').value
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
        document.getElementById('returnSellable').value = '';
        document.getElementById('returnSellable').max = remaining;
        document.getElementById('returnInspection').value = '';
        document.getElementById('returnRow').style.display = 'block';
      });
    });
    var confirmReturn = document.getElementById('confirmReturnBtn');
    if (confirmReturn && manualReturnPending && manualReturnPending.order_id === o.id) {
      document.getElementById('returnRow').style.display = 'block';
      document.getElementById('returnItemId').value = manualReturnPending.order_item_id;
      document.getElementById('returnQty').value = manualReturnPending.quantity;
      document.getElementById('returnReason').value = manualReturnPending.reason;
      document.getElementById('returnSellable').value = manualReturnPending.sellable_quantity;
      document.getElementById('returnInspection').value = manualReturnPending.note;
      body.querySelectorAll('#returnRow input,#returnRow select,#returnRow textarea,.return-line').forEach(function (node) { node.disabled = true; });
      confirmReturn.textContent = 'Vérifier / réessayer le même retour';
      document.getElementById('manualReturnStatus').textContent = 'Retour non confirmé : identifiant conservé. Ne créez pas une nouvelle opération.';
    }
    if (confirmReturn) confirmReturn.addEventListener('click', function () {
      if (manualReturnBusy) return;
      if (manualReturnPending && manualReturnPending.order_id !== o.id) { toast('Vérifiez d’abord le retour non confirmé de la commande précédente.', 'err'); return; }
      var itemId = document.getElementById('returnItemId').value;
      var qty = Number(document.getElementById('returnQty').value);
      var sellableInput = document.getElementById('returnSellable'), sellable = sellableInput.value === '' ? null : Number(sellableInput.value), note = document.getElementById('returnInspection').value.trim();
      if (!manualReturnPending) {
        if (!itemId || !Number.isInteger(qty) || qty < 1 || !Number.isInteger(sellable) || sellable < 0 || sellable > qty || note.length < 3) { toast('Renseignez quantité, unités revendables et contrôle physique.', 'err'); return; }
        if (!confirm('Confirmer le retour reçu : '+qty+' unité(s), dont '+sellable+' revendables ? Aucun remboursement automatique.')) return;
        if (!window.crypto || !window.crypto.randomUUID) { toast('Navigateur récent et connexion sécurisée requis.', 'err'); return; }
        manualReturnPending = { order_id:o.id,order_item_id:itemId,quantity:qty,sellable_quantity:sellable,note:note,reason:document.getElementById('returnReason').value,return_ref:window.crypto.randomUUID() };
        try { sessionStorage.setItem('hn-admin-return-operation',JSON.stringify(manualReturnPending)); } catch (error) { manualReturnPending = null; toast('Identifiant non conservé : aucun envoi.', 'err'); return; }
      }
      var owner = token(); manualReturnBusy = true; confirmReturn.disabled = true;
      body.querySelectorAll('#returnRow input,#returnRow select,#returnRow textarea,.return-line').forEach(function (node) { node.disabled = true; });
      call('recordReturn', manualReturnPending).then(function (res) {
        if (owner !== token()) return;
        if (!res || !res.ok) throw new Error('Réponse incomplète : retour non confirmé.');
        manualReturnPending = null; sessionStorage.removeItem('hn-admin-return-operation');
        toast('Retour contrôlé : '+res.sellable_quantity+' unité(s) revendables. Aucun remboursement effectué.', 'ok');
        if (document.getElementById('orderModal').classList.contains('open') && confirmReturn.isConnected) return call('getOrder',{ id:o.id }).then(function (r2) { if (owner === token() && confirmReturn.isConnected && document.getElementById('orderModal').classList.contains('open') && r2.order) openOrder(r2.order); });
      }).catch(function (error) {
        if (owner !== token()) return;
        var refused = error.status === 400 || ['return_invalid','return_order_unavailable','return_item_missing','return_quantity_unavailable','return_request_open','return_variant_unavailable'].includes(error.code);
        if (refused) { manualReturnPending = null; sessionStorage.removeItem('hn-admin-return-operation'); }
        if (confirmReturn.isConnected) {
          document.getElementById('manualReturnStatus').textContent = error.message + (refused ? ' Aucun nouveau retour enregistré.' : ' Vérifiez ou réessayez le même retour avant toute nouvelle opération.');
          confirmReturn.textContent = refused ? 'Confirmer la réception et le contrôle' : 'Vérifier / réessayer le même retour';
          if (refused) body.querySelectorAll('#returnRow input,#returnRow select,#returnRow textarea,.return-line').forEach(function (node) { node.disabled = false; });
        }
      })
        .finally(function () { if (owner === token()) { manualReturnBusy = false; confirmReturn.disabled = false; } });
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
  var salesRevision = 0;
  document.addEventListener('hn:admin-logout',function () { salesRevision++; salesAll = null; document.getElementById('salesList').textContent = ''; });

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
    var request = ++salesRevision, owner = token();
    return call('saleStats', { period: period, threshold: salesThreshold, currency: document.getElementById('salesCurrency').value }).then(function (res) {
      if (request !== salesRevision || owner !== token()) return;
      salesAll = res || null;
      renderSales();
    }).catch(function (e) {
      if (request !== salesRevision || owner !== token()) return;
      document.getElementById('salesList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
    });
  }

  function salesKpis(t, cur) {
    var lowWarn = t.lowStock > 0 ? ' style="border-color:#E6B0A2;"' : '';
    return '<div class="stat-cards">' +
      '<div class="stat-card"><strong>' + money(t.netRevenueCents, cur) + '</strong><span>Encaissements moins remboursements</span></div>' +
      '<div class="stat-card"><strong>' + money(t.refundedCents || 0, cur) + '</strong><span>Remboursements confirmés</span></div>' +
      '<div class="stat-card"><strong>' + (t.marginCents == null ? 'À compléter' : money(t.marginCents, cur)) + '</strong><span>Marge articles estimée, avant frais</span></div>' +
      '<div class="stat-card"><strong>' + t.netUnits + '</strong><span>Unités commandées hors retours physiques</span></div>' +
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
        (m.refundedCents > 0 ? ' (remboursements confirmés : ' + money(m.refundedCents, cur) + ')' : '') +
        ' \u00b7 ' + m.unitsSold + ' unit\u00e9s vendues' +
        (m.returnedUnits > 0 ? ', ' + m.returnedUnits + ' retourn\u00e9es' : '');
      return '<rect class="bar" x="' + x.toFixed(1) + '" y="' + (H - padB - hh).toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + hh + '" rx="3">' +
        '<title>' + esc(tip) + '</title></rect>' +
        '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(fmtMonth(m.key)) + '</text>';
    }).join('');
    return '<svg class="sales-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Encaissements bruts par mois de paiement">' +
      '<line x1="0" y1="' + (H - padB) + '" x2="' + W + '" y2="' + (H - padB) + '" stroke="currentColor" stroke-opacity="0.15"/>' +
      bars + '</svg>';
  }

  function salesProductsTable(rows, cur) {
    if (!rows || !rows.length) return '<p class="empty">Aucun produit.</p>';
    return '<table class="admin-table"><thead><tr>' +
      '<th>Produit</th><th>Stock dispo</th><th>Commandé</th><th>Retourné</th><th>Hors retours</th><th>Valeur articles hors retours</th><th>Marge articles estimée</th>' +
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
          '<td data-label="Valeur articles">' + money(r.revenueCents - r.returnedCents, cur) + '</td>' +
          '<td data-label="Marge avant frais">' + (r.marginCents == null ? 'Inconnue' : money(r.marginCents, cur)) + '</td>' +
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
    html += '<p>Lecture par date de paiement : les retours et remboursements connus à ce jour sont rattachés aux commandes de cette période, même reçus plus tard. Les montants encaissés incluent livraison et taxes ; ils ne sont pas votre bénéfice.</p>';
    html += '<p>Marge articles = valeur après remise et retours physiques − coût d’achat des unités non remises en stock. Hors transport, emballage, frais de paiement, charges et impôts. Une commande remboursée ou un coût historique absent rend sa marge inconnue ; aucun coût manquant n’est remplacé par zéro.</p>';
    if (t.marginMissingUnits) html += '<p class="admin-notice">Marge incomplète : ' + t.marginMissingUnits + ' unité(s) non calculables. Sous-total des lignes calculables : ' + money(t.marginKnownCents || 0,cur) + ' — ne représente pas la marge totale.</p>';
    if (salesAll.limited) html += '<p class="admin-notice">Résultat partiel : limite de lecture atteinte. Ces chiffres ne sont pas exhaustifs.</p>';
    if ((salesAll.excluded_currencies || []).length) html += '<p class="admin-notice">Autres devises exclues, sans conversion : ' + esc(salesAll.excluded_currencies.join(', ')) + '. Sélectionnez leur devise pour les consulter.</p>';
    html += '<h3 style="margin:16px 0 6px;">Encaissements bruts par mois de paiement — 12 derniers mois</h3>' +
      salesChart(salesAll.monthly || [], cur);
    html += '<h3 style="margin:20px 0 8px;">Produits (' + periodLabel(salesAll.period) + ')</h3>' +
      salesProductsTable(salesAll.products || [], cur);
    box.innerHTML = html;
  }

  function wireSales() {
    document.getElementById('salesCurrency').addEventListener('change',loadSales);
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
    var resetAllBtn = document.getElementById('resetAllBtn');
    if (resetAllBtn) resetAllBtn.addEventListener('click', function () {
      if (!confirm('TOUT remettre à zéro ?\n\nCette action est IRRÉVERSIBLE :\n- TOUTES les commandes sont supprimées (payées, en attente, abandonnées, remboursées, annulées)\n- les lignes et retours de commande avec elles\n- le stock de toutes les variantes repasse à 0\n\nUne sauvegarde CSV des commandes sera téléchargée automatiquement avant l\u2019effacement.')) return;
      resetAllBtn.disabled = true;
      call('exportOrdersCsv').then(function (res) {
        downloadCsv(res.filename, res.csv);
        if (prompt('Tapez EFFACER pour confirmer la suppression définitive') !== 'EFFACER') throw new Error('Suppression annulée');
        return call('resetAll', { confirm: true, confirm_text: 'EFFACER' });
      }).then(function (res) {
        scanCart = [];
        scanLast = null;
        prepCurrent = null;
        prepOrders = [];
        renderScanCart();
        renderScanResult();
        renderPrep();
        toast('Base remise à zéro \u2014 ' + res.deleted_orders + ' commande(s) supprimée(s)', 'ok');
        loadSales();
      }).catch(function (err) {
        toast(err.message, 'err');
      }).then(function () {
        resetAllBtn.disabled = false;
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

  function downloadCsv(filename, csv) {
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

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
        '.label svg { max-width: 100%; height: auto; min-height: 10mm; }' +
        '.label .cd { font-family: "Courier New", monospace; font-size: 12px; letter-spacing: 1px; margin-top: 1mm; }' +
        '@media print { .label { border-color: #aaa; } }';
      var items = labels.map(function (l) {
        return '<div class="label"><div class="nm">' + esc(l.name) + '</div>' +
          '<div class="vt">' + esc(l.variant) + '</div>' +
          '<svg class="bc" data-code="' + esc(l.code) + '"></svg>' +
          '<div class="cd">' + esc(l.code) + '</div></div>';
      }).join('');
      var jsBarcodeUrl = (function () {
        try { return new URL('vendor/jsbarcode.min.js', window.location.href).href; }
        catch (e) { return 'vendor/jsbarcode.min.js'; }
      })();
      var html = '<!doctype html><html><head><meta charset="utf-8"><title>\u00c9tiquettes Hanna &amp; Nour</title>' +
        '<script src="' + jsBarcodeUrl + '"><\/script>' +
        '<style>' + printCss + '</style></head><body><div class="labels">' + items + '</div>' +
        '<script>' +
        'var tries=0;' +
        'function fail(){' +
        '  var m=document.createElement("div");' +
        '  m.style.cssText="color:#a00;font:13px Arial;text-align:center;margin:12px auto;padding:8px;border:1px solid #a00;max-width:80%;";' +
        '  m.textContent="La biblioth\u00e8que de codes-barres n\u2019a pas pu \u00eatre charg\u00e9e (' + jsBarcodeUrl + '). V\u00e9rifiez le fichier public/vendor/jsbarcode.min.js puis r\u00e9essayez.";' +
        '  document.body.insertBefore(m, document.body.firstChild);' +
        '}' +
        'function draw(){' +
        '  var els=document.querySelectorAll(".bc");' +
        '  if(!window.JsBarcode){' +
        '    if(tries++>=20){ fail(); window.setTimeout(function(){ window.print(); }, 200); return; }' +
        '    window.setTimeout(draw,150); return;' +
        '  }' +
        '  for(var i=0;i<els.length;i++){' +
        '    window.JsBarcode(els[i], els[i].getAttribute("data-code"),' +
        '      { format:"CODE128", width:1.6, height:40, margin:0 });' +
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
  var prepRevision = 0;
  var prepListRequest = 0;
  var prepBusy = false;

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
          '<button class="btn btn-secondary btn-small" data-scan="inv">Ajuster avec un motif</button>' +
          '<button class="btn btn-primary btn-small" data-scan="cartAdd" data-vid="' + esc(v.id) + '">Ajouter \u00e0 la caisse</button>' +
        '</div>' +
        pendingHtml +
      '</div>';
  }

  function toggleScanInv(open) {
    if (!scanLast) return;
    document.querySelector('[data-tab="inventory"]').click();
    document.dispatchEvent(new CustomEvent('hn:inventory-variant', { detail: scanLast.variant.id }));
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
      '<button class="btn btn-primary" id="cartCashBtn" disabled>Caisse manuelle suspendue</button>';
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
    var owner = token(), request = ++prepListRequest;
    call('listOrders', { status: 'paid' }).then(function (res) {
      if (owner !== token() || request !== prepListRequest) return;
      prepOrders = (res.orders || []).filter(function (o) {
        return o.status === 'paid' && o.shipping_status === 'new' && !o.admin_archived;
      });
      if (prepCurrent && !prepOrders.some(function (o) { return o.id === prepCurrent.id; })) { prepRevision++; prepCurrent = null; prepBusy = false; }
      renderPrep(prev);
    }).catch(function (err) { if (owner === token() && request === prepListRequest) document.getElementById('prepStatus').textContent = err.message; });
  }

  function renderPrep(selVal) {
    var box = document.getElementById('scanPrepare');
    if (!box) return;
    var opts = prepOrders.map(function (o) {
      var blocked = o.stock_issue || o.refunded_cents > 0;
      return '<option value="' + esc(o.id) + '"' + (blocked ? ' disabled' : '') + '>' + esc(o.order_number) + ' — ' + esc(o.customer_name) + (blocked ? ' — à examiner (stock / remboursement)' : o.prepared_at ? ' — colis prêt' : '') + '</option>';
    }).join('');
    var head = '<div class="prep-head"><b>Pr\u00e9parer une commande</b>' +
      '<select id="prepOrderSel" aria-label="Commande à préparer"' + (prepBusy ? ' disabled' : '') + '><option value="">Choisir une commande</option>' + opts + '</select>' +
      '<button class="btn btn-secondary btn-small" data-scan="prepLoad"' + (prepBusy ? ' disabled' : '') + '>Charger</button></div>';
    var body = '';
    if (prepCurrent) {
      var checked = 0;
      var total = 0;
      prepCurrent.items.forEach(function (it) { checked += it.prepared; total += it.qty; });
      var rows = prepCurrent.items.map(function (it) {
        return '<div class="prep-row' + (it.prepared === it.qty ? ' checked' : '') + '">' +
          '<span class="p-check">' + (it.prepared === it.qty ? '✓' : '□') + '</span>' +
          '<span class="p-name">' + esc(it.label) + '<small>' + it.prepared + '/' + it.qty + ' unité(s) vérifiée(s)</small></span>' +
          '<button type="button" class="btn btn-secondary btn-small" data-prep-item="' + esc(it.id) + '" data-prep-quantity="' + it.qty + '"' + (prepBusy || it.prepared === it.qty ? ' disabled' : '') + '>J’ai vérifié les ' + it.qty + ' unité(s)</button>' +
          '<button type="button" class="btn btn-secondary btn-small" data-prep-item="' + esc(it.id) + '" data-prep-quantity="0"' + (prepBusy || !it.prepared ? ' disabled' : '') + '>Reprendre le contrôle</button>' +
          '</div>';
      }).join('');
      var all = checked === total && total > 0;
      body = '<h3>' + esc(prepCurrent.order_number) + '</h3>' + (prepCurrent.preparedAt ? '<p class="admin-notice">Colis prêt. L’expédition doit être confirmée séparément après le dépôt réel.</p>' : '') + rows +
        '<div class="prep-foot">' +
          '<span id="prepProgress" role="status">' + checked + '/' + total + ' unité(s) vérifiée(s)' + (all ? ' — contrôle complet ✓' : '') + '</span>' +
          '<button class="btn btn-primary" id="prepCompleteBtn"' + (all && !prepBusy && !prepCurrent.preparedAt ? '' : ' disabled') + '>Confirmer le colis prêt</button>' +
          '<button class="btn btn-secondary btn-small" data-scan="prepClose">Fermer la pr\u00e9paration</button>' +
        '</div>';
    } else {
      body = '<p class="admin-muted">Chargez une commande. Scannez chaque unité ou vérifiez manuellement la quantité de chaque ligne. La progression est enregistrée, même si vous fermez la préparation. Liste limitée aux 200 dernières commandes payées renvoyées par l’API.</p>';
    }
    box.style.display = 'block';
    box.innerHTML = head + body;
    var sel2 = document.getElementById('prepOrderSel');
    if (sel2 && (selVal || prepCurrent)) sel2.value = selVal || prepCurrent.id;
    document.getElementById('prepScanBtn').disabled = prepBusy;
    var completeBtn = document.getElementById('prepCompleteBtn');
    if (completeBtn) completeBtn.addEventListener('click', prepComplete);
  }

  function prepLoad() {
    if (prepBusy) return;
    var sel = document.getElementById('prepOrderSel');
    if (!sel || !sel.value) { document.getElementById('prepStatus').textContent = 'Choisissez une commande.'; return; }
    var orderId = sel.value;
    var revision = ++prepRevision, owner = token();
    prepCurrent = null;
    prepBusy = true;
    renderPrep(orderId);
    call('getOrder', { id: orderId }).then(function (res) {
      if (revision !== prepRevision || owner !== token()) return;
      var o = res.order;
      if (!o || o.status !== 'paid' || o.shipping_status !== 'new' || o.stock_issue || o.refunded_cents > 0 || o.admin_archived) { prepCurrent = null; renderPrep(); document.getElementById('prepStatus').textContent = 'Commande non disponible : actualisez et examinez son statut.'; return; }
      prepCurrent = {
        id: o.id,
        order_number: o.order_number,
        preparedAt: o.prepared_at,
        items: (o.order_items || []).map(function (it) {
          return {
            variant_id: it.variant_id,
            id: it.id,
            label: it.product_name + (it.variant ? ' (' + it.variant + ')' : ''),
            qty: it.quantity,
            prepared: it.prepared_quantity || 0
          };
        })
      };
      renderPrep(orderId);
      document.getElementById('prepStatus').textContent = 'Commande chargée. Vérifiez chaque unité, sans nouveau retrait du stock.';
    }).catch(function (err) { if (revision === prepRevision && owner === token()) document.getElementById('prepStatus').textContent = err.message; })
      .finally(function () { if (revision === prepRevision && owner === token()) { prepBusy = false; renderPrep(orderId); } });
  }

  function prepScan(code) {
    if (!prepCurrent || prepBusy) return;
    var revision = prepRevision, owner = token();
    prepBusy = true;
    renderPrep();
    call('scanLookup', { barcode: code }).then(function (res) {
      if (revision !== prepRevision || owner !== token()) return;
      var vid = res.variant && res.variant.id;
      var item = prepCurrent.items.filter(function (it) { return it.variant_id === vid && it.prepared < it.qty; })[0];
      prepBusy = false;
      if (!item) { document.getElementById('prepStatus').textContent = 'Article absent de la commande ou quantité déjà entièrement vérifiée.'; return; }
      return prepSetQuantity(item.id, item.prepared + 1);
    }).catch(function (err) {
      if (revision === prepRevision && owner === token()) document.getElementById('prepStatus').textContent = err.message;
    }).finally(function () { if (revision === prepRevision && owner === token()) { prepBusy = false; renderPrep(); } });
  }

  function prepSetQuantity(id, quantity) {
    if (!prepCurrent || prepBusy) return Promise.resolve();
    var item = prepCurrent.items.filter(function (it) { return it.id === id; })[0];
    if (!item) return Promise.resolve();
    var revision = prepRevision, owner = token();
    prepBusy = true;
    renderPrep();
    return call('setPreparationQuantity', { order_id: prepCurrent.id, item_id: item.id, quantity: quantity, expected_quantity: item.prepared }).then(function (res) {
      if (revision !== prepRevision || owner !== token()) return;
      if (!res.result || !Number.isInteger(res.result.quantity) || res.result.quantity < 0 || res.result.quantity > item.qty) throw new Error('Réponse de préparation incomplète.');
      if (!res.result.already) prepCurrent.preparedAt = null;
      item.prepared = res.result.quantity;
      document.getElementById('prepStatus').textContent = 'Contrôle enregistré. Le stock n’a pas été modifié.';
    }).catch(function (err) { if (revision === prepRevision && owner === token()) document.getElementById('prepStatus').textContent = err.message + ' Rechargez la commande avant de continuer.'; })
      .finally(function () { if (revision === prepRevision && owner === token()) { prepBusy = false; renderPrep(); } });
  }

  function prepComplete() {
    if (!prepCurrent || prepBusy) return;
    var all = prepCurrent.items.length && prepCurrent.items.every(function (it) { return it.prepared === it.qty; });
    if (!all || !confirm('Confirmer que toutes les unités ont été vérifiées et que le colis est prêt ? Ceci ne marque pas l’expédition et n’envoie aucun email.')) return;
    var revision = prepRevision, owner = token();
    prepBusy = true;
    renderPrep();
    call('completePreparation', { order_id: prepCurrent.id }).then(function (res) {
      if (revision !== prepRevision || owner !== token()) return;
      prepCurrent.preparedAt = res.result.prepared_at;
      document.getElementById('prepStatus').textContent = 'Colis prêt enregistré. Confirmez l’expédition séparément après le dépôt réel.';
    }).catch(function (err) { if (revision === prepRevision && owner === token()) document.getElementById('prepStatus').textContent = err.message; })
      .finally(function () { if (revision === prepRevision && owner === token()) { prepBusy = false; renderPrep(); } });
  }

  function prepClose() {
    prepRevision++;
    prepBusy = false;
    prepCurrent = null;
    renderPrep();
    document.getElementById('prepStatus').textContent = 'Préparation fermée. Les contrôles déjà enregistrés sont conservés.';
  }

  function wirePreparation() {
    document.getElementById('refreshPreparation').addEventListener('click', function () { if (!prepBusy) prepLoadOrders(); });
    document.getElementById('scanPrepare').addEventListener('click', function (event) {
      var button = event.target.closest('[data-prep-item]');
      if (button && !button.disabled) prepSetQuantity(button.getAttribute('data-prep-item'), Number(button.getAttribute('data-prep-quantity')));
    });
    document.getElementById('prepScanForm').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = document.getElementById('prepScanInput');
      if (prepBusy) { document.getElementById('prepStatus').textContent = 'Validation en cours : attendez avant de scanner l’unité suivante.'; return; }
      if (!prepCurrent) { document.getElementById('prepStatus').textContent = 'Chargez d’abord une commande.'; return; }
      if (input.value.trim()) prepScan(input.value.trim());
      input.value = '';
    });
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
      document.getElementById('productPriceLabel').textContent = 'Prix (' + ADMIN_CURRENCY_SYMBOL + ') *';
      document.getElementById('productCompareLabel').textContent = 'Ancien prix (' + ADMIN_CURRENCY_SYMBOL + ', promotion)';
      renderProducts();
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
    document.getElementById('filterProductVisibility').addEventListener('change', renderProducts);
    document.getElementById('productsList').addEventListener('change', function (e) {
      if (archiveBusy) return;
      if (e.target.id === 'selectVisibleProducts') {
        this.querySelectorAll('.select-product').forEach(function (checkbox) {
          var id = checkbox.getAttribute('data-id');
          if (e.target.checked) productSelection[id] = true;
          else delete productSelection[id];
        });
      } else if (e.target.classList.contains('select-product')) {
        var id = e.target.getAttribute('data-id');
        if (e.target.checked) productSelection[id] = true;
        else delete productSelection[id];
      }
      renderProducts();
    });
    document.getElementById('clearProductSelection').addEventListener('click', function () { if (!archiveBusy) { productSelection = {}; renderProducts(); } });
    document.getElementById('archiveSelectedProducts').addEventListener('click', function () {
      if (archiveBusy) return;
      var ids = Object.keys(productSelection);
      if (!ids.length) return;
      if (ids.length > 100) { toast('Sélectionnez au maximum 100 produits par opération.', 'err'); return; }
      if (!confirm('Archiver ces ' + ids.length + ' produits, y compris ceux masqués par vos filtres ?\n\n' + productsAll.filter(function (p) { return productSelection[p.id]; }).map(function (p) { return p.name_fr || p.name_en || p.slug; }).join('\n') + '\n\nIls ne seront plus vendus. Les commandes, photos et stocks restent conservés.')) return;
      var owner = token();
      var status = document.getElementById('productBulkStatus');
      archiveBusy = true;
      status.hidden = false;
      status.textContent = 'Archivage en cours…';
      renderProducts();
      call('archiveProducts', { ids: ids }).then(function (res) {
        if (owner !== token()) return;
        var archived = res.archived_ids || [];
        archived.forEach(function (id) { delete productSelection[id]; });
        status.textContent = archived.length + ' produit(s) archivé(s). Historique et stock conservés.' + (archived.length < ids.length ? ' Certains produits n’ont pas été trouvés : vérifiez la liste actualisée.' : '');
        return loadProducts();
      }).catch(function (error) {
        if (owner !== token()) return;
        status.textContent = 'Archivage non confirmé : ' + error.message + '. Actualisez la liste pour vérifier avant de recommencer.';
      }).finally(function () { archiveBusy = false; if (owner === token()) renderProducts(); });
    });
  }

  /* ---------------- Boot ---------------- */

  function boot() {
    loadProducts();
    loadSettings();
  }

  wireLogin();
  wireForgot();
  wireTabs();
  wireEditor();
  wireOrders();
  wireSales();
  wireScan();
  wirePreparation();
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
