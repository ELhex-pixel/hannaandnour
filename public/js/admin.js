/**
 * Hanna & Nour - Admin dashboard (admin.html)
 * Products CRUD, per-variant stock, image upload (Supabase Storage),
 * order fulfillment (shipped/delivered + tracking) and shipping settings.
 */
(function () {
  'use strict';

  var API = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';
  var TOKEN_KEY = 'hn-admin-token';

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
        if (!res.ok) throw new Error(body.error || 'Erreur serveur');
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
        if (id === 'panel-reviews') loadReviews();
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
      '<td><img class="thumb" src="' + esc(p.image || 'images/hero.jpg') + '" alt=""></td>' +
      '<td><strong>' + esc(p.name_en) + '</strong><br><small style="color:#8a7d66;">' + esc(p.slug) + '</small></td>' +
      '<td>' + money(p.price_cents) + '</td>' +
      '<td>' + esc(cat) + '</td>' +
      '<td>' + (managed ? '<span class="badge badge-green">' + totalStock + ' en stock</span>' : '<span class="badge badge-gray">sans stock</span>') + '</td>' +
      (p.active ? '' : '<td><span class="badge badge-red">Inactif</span></td>') +
      '<td style="white-space:nowrap;">' +
      '<button class="btn btn-secondary btn-small edit-product" data-id="' + p.id + '">Modifier</button> ' +
      '<button class="btn btn-secondary btn-small" title="Dupliquer" data-slug="' + esc(p.slug) + '" data-id="' + p.id + '">Dupliquer</button>' +
      '</td></tr>';
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
    box.innerHTML = '<table><thead><tr><th></th><th>Produit</th><th>Prix</th><th>Cat&eacute;gorie</th><th>Stock</th><th></th><th></th></tr></thead><tbody>' +
      list.map(productRow).join('') + '</tbody></table>';
  }

  /* ---- Product editor ---- */

  var editing = null;

  function openEditor(p) {
    editing = p || {
      name_en: '', name_fr: '', name_ar: '',
      description_en: '', description_fr: '', description_ar: '',
      features_en: [], care_en: [], fabrics: [], occasions: [], colors: [], sizes: [],
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
    setVal('f-fabric_comp_en', editing.fabric_comp_en || '');
    setVal('f-care_en', (editing.care_en || []).join(', '));
    setVal('f-rating', editing.rating);
    setVal('f-image', editing.image || 'images/hero.jpg');
    setVal('f-gallery', (editing.gallery || []).join('\n'));
    document.getElementById('f-featured').checked = !!editing.is_featured;
    document.getElementById('f-bestseller').checked = !!editing.is_bestseller;
    document.getElementById('f-active').checked = editing.active !== false;
    document.getElementById('deleteProductBtn').style.display = p ? '' : 'none';

    buildVariantGrid();
    document.getElementById('productEditor').classList.add('open');
  }

  function setVal(id, v) {
    document.getElementById(id).value = (v == null ? '' : v);
  }
  function getVal(id) {
    return document.getElementById(id).value.trim();
  }

  function strToList(val) {
    return val.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function buildVariantGrid() {
    var colors = strToList(getVal('f-colors'));
    var sizes = strToList(getVal('f-sizes'));

    // Keep previously typed stock values when the lists change.
    var keep = {};
    (editing.variants || []).forEach(function (v) {
      keep[v.color + '||' + v.size] = v.stock;
    });

    function stockFor(color, size) {
      return keep[color + '||' + size] != null ? keep[color + '||' + size] : '';
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
        '<input type="text" class="v-color" value="' + esc(r.color) + '" placeholder="Couleur" ' + (r.color ? 'readonly' : '') + '>' +
        '<input type="text" class="v-size" value="' + esc(r.size) + '" placeholder="Taille" ' + (r.size ? 'readonly' : '') + '>' +
        '<input type="number" class="v-stock" min="0" step="1" value="' + (stockFor(r.color, r.size) === '' ? '' : stockFor(r.color, r.size)) + '" placeholder="0">' +
        '<span style="font-size:12px;color:#8a7d66;">stock</span>' +
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
      out.push({ color: color, size: size, stock: Math.max(0, parseInt(stockRaw, 10) || 0) });
    });
    return out;
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
      care_en: strToList(getVal('f-care_en')),
      fabrics: strToList(getVal('f-fabrics')),
      occasions: strToList(getVal('f-occasions')),
      colors: strToList(getVal('f-colors')),
      sizes: strToList(getVal('f-sizes')),
      fabric_comp_en: getVal('f-fabric_comp_en'),
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

  function wireEditor() {
    document.getElementById('closeEditorBtn').addEventListener('click', function () {
      document.getElementById('productEditor').classList.remove('open');
    });
    // Close by clicking the dark backdrop around the editor.
    document.getElementById('productEditor').addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
    document.getElementById('newProductBtn').addEventListener('click', function () { openEditor(null); });
    document.getElementById('f-colors').addEventListener('input', buildVariantGrid);
    document.getElementById('f-sizes').addEventListener('input', buildVariantGrid);

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
    function bind(btnId, inputId, onUrl) {
      var btn = document.getElementById(btnId);
      var input = document.getElementById(inputId);
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
            .finally(function () { btn.disabled = false; btn.textContent = btnId.indexOf('Gallery') >= 0 ? 'Ajouter au galerie' : 'Uploader une photo'; });
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    }
    bind('uploadMainBtn', 'fileMain', function (url) { setVal('f-image', url); });
    bind('uploadGalleryBtn', 'fileGallery', function (url) {
      var cur = getVal('f-gallery');
      setVal('f-gallery', cur ? cur + '\n' + url : url);
    });
  }

  /* ---------------- Orders ---------------- */

  function statusLabel(s) {
    return { pending: 'En attente', paid: 'Pay&eacute;e', abandoned: 'Abandonn&eacute;e', refunded: 'Rembours&eacute;e' }[s] || s;
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
      '<td><strong>' + esc(o.order_number) + '</strong><br><small style="color:#8a7d66;">' + fmtDate(o.created_at) + '</small></td>' +
      '<td>' + esc(o.customer_name) + '<br><small style="color:#8a7d66;">' + esc(o.email) + '</small></td>' +
      '<td>' + count + '</td>' +
      '<td>' + money(o.total_cents, o.currency) + '</td>' +
      '<td><span class="' + payClass(o.status) + '">' + statusLabel(o.status) + '</span></td>' +
      '<td><span class="badge ' + shipClass(o.shipping_status) + '">' + shipLabel(o.shipping_status) + '</span>' +
      (o.tracking_number ? '<br><small style="color:#8a7d66;">' + esc(o.tracking_number) + '</small>' : '') + '</td>' +
      '<td style="white-space:nowrap;"><button class="btn btn-secondary btn-small view-order" data-id="' + o.id + '">Voir</button></td>' +
      '</tr>';
  }

  function renderOrders() {
    var box = document.getElementById('ordersList');
    if (!ordersAll.length) { box.innerHTML = '<p class="empty">Aucune commande.</p>'; return; }
    box.innerHTML = '<table><thead><tr>' +
      '<th>Commande</th><th>Client</th><th>Articles</th><th>Total</th><th>Paiement</th><th>Exp&eacute;dition</th><th></th>' +
      '</tr></thead><tbody>' + ordersAll.map(orderRow).join('') + '</tbody></table>';
  }

  function itemRows(o) {
    return (o.order_items || []).map(function (it) {
      return '<tr><td>' + esc(it.product_name) + '</td><td>' + (parseInt(it.quantity, 10) || 1) + '</td><td>' + money(it.unit_price_cents * it.quantity, o.currency) + '</td></tr>';
    }).join('');
  }

  function openOrder(o) {
    document.getElementById('orderModalTitle').textContent = 'Commande ' + o.order_number;
    var addressBlock = o.delivery_type === 'pickup'
      ? '<p><strong>Retrait :</strong> ' + esc(o.pickup_point || '-') + '</p>'
      : '<p>' + esc(o.address1) + (o.address2 ? ' ' + esc(o.address2) : '') + '<br>' +
        esc(o.city) + (o.state ? ' ' + esc(o.state) : '') + ' ' + esc(o.postal_code) + '<br>' + esc(o.country) + '</p>';

    document.getElementById('orderModalBody').innerHTML =
      '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px; font-size:13px;">' +
      '<div><strong>Client</strong><br>' + esc(o.customer_name) + '<br>' + esc(o.email) + (o.phone ? '<br>' + esc(o.phone) : '') + '</div>' +
      '<div><strong>Livraison</strong><br>' + esc(o.shipping_method || 'standard') + '<br>' + addressBlock +
      (o.tracking_number ? '<br><strong>Suivi :</strong> ' + esc(o.tracking_number) : '') + '</div>' +
      '</div>' +
      '<table><thead><tr><th>Article</th><th>Qt&eacute;</th><th>Total</th></tr></thead><tbody>' + itemRows(o) + '</tbody></table>' +
      '<table style="margin-top:10px;"><tr><td>Sous-total</td><td style="text-align:right;">' + money(o.subtotal_cents, o.currency) + '</td></tr>' +
      (o.discount_cents > 0 ? '<tr><td>Remise</td><td style="text-align:right;">-' + money(o.discount_cents, o.currency) + '</td></tr>' : '') +
      '<tr><td>Livraison</td><td style="text-align:right;">' + money(o.shipping_cents, o.currency) + '</td></tr>' +
      (o.tax_cents > 0 ? '<tr><td>Taxe</td><td style="text-align:right;">' + money(o.tax_cents, o.currency) + '</td></tr>' : '') +
      '<tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>' + money(o.total_cents, o.currency) + '</strong></td></tr></table>' +
      (o.status === 'paid' ? '<div class="order-actions">' +
        '<button class="btn btn-secondary btn-small" data-act="markShipped">Marquer expédiée</button>' +
        '<button class="btn btn-secondary btn-small" data-act="markDelivered">Marquer livr&eacute;e</button>' +
        '<button class="btn btn-secondary btn-small" data-act="revert">R&eacute;initialiser</button>' +
        '<button class="btn btn-danger btn-small" data-act="refund">Rembourser (complet)</button>' +
        '<button class="btn btn-secondary btn-small" data-act="printInvoice">Facture</button>' +
        '<button class="btn btn-secondary btn-small" data-act="printPacking">Bon de livraison</button>' +
        '<button class="btn btn-secondary btn-small" data-act="printLabel">&Eacute;tiquette</button>' +
        '</div>' : '') +
      '<div id="trackingRow" style="display:none; margin-top:12px;">' +
      '<label style="font-size:12px; color:#5c5548;">Num&eacute;ro de suivi (facultatif)</label>' +
      '<input type="text" id="trackingInput" style="width:100%; padding:8px; border:1px solid #ddd5c4; border-radius:8px;">' +
      '<button class="btn btn-primary btn-small" id="confirmShipBtn" style="margin-top:8px;">Confirmer l&rsquo;exp&eacute;dition</button></div>';
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
    document.getElementById('confirmShipBtn').addEventListener('click', function () {
      call('updateOrder', {
        id: o.id,
        shipping_status: 'shipped',
        tracking_number: document.getElementById('trackingInput').value.trim()
      }).then(function () { return afterUpdate(o.id, 'Marqu\u00e9e exp\u00e9di\u00e9e'); });
    });
  }

  function afterUpdate(id, msg) {
    toast(msg, 'ok');
    document.getElementById('orderModal').classList.remove('open');
    return loadOrders();
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
    return call('listReviews').then(function (res) {
      renderReviews(res.reviews || []);
    }).catch(function (e) {
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
    box.innerHTML = '<table><thead><tr><th>Code</th><th>Réduction</th><th>Expiration</th><th>Statut</th><th></th></tr></thead><tbody>' +
      promosAll.map(function (p) {
        return '<tr>' +
          '<td><strong>' + esc(p.code) + '</strong></td>' +
          '<td>' + (parseInt(p.percent_off, 10) || 0) + ' %</td>' +
          '<td>' + (p.expires_at ? fmtDate(p.expires_at) : '—') + '</td>' +
          '<td><span class="badge ' + (p.active ? 'badge-green' : 'badge-red') + '">' + (p.active ? 'Actif' : 'Inactif') + '</span></td>' +
          '<td style="white-space:nowrap;">' +
          '<button class="btn btn-secondary btn-small edit-promo" data-code="' + esc(p.code) + '">Modifier</button> ' +
          '<button class="btn btn-danger btn-small del-promo" data-code="' + esc(p.code) + '">Supprimer</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table>';
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
      return '<table><thead><tr><th>Vue</th><th>Nombre</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var label = r.slug ? esc(prodName(r.slug)) : r.path ? esc(r.path).replace(/\?.*$/, '') : esc(String(r.path || r.slug));
          var n = r.views != null ? r.views : r.count;
          return '<tr><td>' + label + '</td><td>' + n + '</td></tr>';
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
  wireTabs();
  wireEditor();
  wireOrders();
  wireReviews();
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