/**
 * Product page: renders the product from ?slug= and wires up
 * Add to Cart / Buy Now / Reviews with the real backend.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var COLOR_PALETTE = {
    white: '#FFFFFF', cream: '#F1E7D3', beige: '#D9CCB2', gold: '#A67C00',
    bronze: '#6E5A1C', espresso: '#3B362E', black: '#1A1A1A', champagne: '#C9A227',
    ivory: '#FFFFF0', charcoal: '#404040', emerald: '#3D7A5C', blush: '#E8B4B8',
    nude: '#D2A58F', sage: '#8A9A7B', brown: '#6E5A1C'
  };

  function catKey(cat) {
    return { hijab: 'catHijabs', abaya: 'catAbayas', dress: 'catDresses', prayer: 'catPrayerWear', accessory: 'catAccessories' }[cat] || 'catHijabs';
  }

  function colorHex(name) {
    return COLOR_PALETTE[String(name || '').toLowerCase()] || '#A67C00';
  }

  function stars(rating) {
    var n = Math.round(parseFloat(rating) || 0);
    if (n < 0) n = 0;
    if (n > 5) n = 5;
    var s = '';
    for (var i = 0; i < n; i++) s += '\u2605';
    for (var j = n; j < 5; j++) s += '\u2606';
    return s;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function localized(p, fieldEn, fieldFr, fieldAr, fallback) {
    var lang = HN.lang();
    if (lang === 'fr' && p[fieldFr]) return p[fieldFr];
    if (lang === 'ar' && p[fieldAr]) return p[fieldAr];
    return p[fieldEn] || fallback || '';
  }

  function getSlug() {
    var params = new URLSearchParams(window.location.search);
    return (params.get('slug') || '').trim();
  }

  function flatMap(arr) {
    return Array.isArray(arr) ? arr.join(', ') : String(arr || '');
  }

  /* ---- Render ---- */

  function renderGallery(p) {
    var main = document.getElementById('mainImage');
    var thumbs = document.querySelector('.product-gallery-thumbnails');
    var images = [];
    if (Array.isArray(p.gallery)) {
      images = p.gallery.map(function (g) { return g.src || g; });
    }
    if (!images.length && p.image) images = [p.image];

    if (main) { main.src = images[0] || 'images/hero.jpg'; main.alt = esc(HN.productName(p)); }

    if (thumbs) {
      var html = '';
      for (var i = 0; i < images.length; i++) {
        var filter = images.length > 1 && i === 1 && images[1] === images[0] ? 'hue-rotate(160deg)' : '';
        html += '<div class="product-thumbnail' + (i === 0 ? ' active' : '') + '" data-img="' + images[i] + '">' +
          '<img src="' + images[i] + '" alt="' + esc(HN.productName(p)) + ' view"' + (filter ? ' style="filter:' + filter + ';"' : '') + '></div>';
      }
      thumbs.innerHTML = html;
    }
  }

  function renderInfo(p) {
    var catEl = document.querySelector('.product-category');
    if (catEl) catEl.textContent = tr(catKey(p.category));

    var infoEl = document.querySelector('.product-info');
    if (infoEl) infoEl.setAttribute('data-slug', p.slug);

    var titleEl = document.querySelector('.product-title');
    if (titleEl) titleEl.textContent = HN.productName(p);

    var ratingWrapper = document.querySelector('.product-rating');
    if (ratingWrapper) {
      var starsEl = ratingWrapper.querySelector('.stars');
      if (starsEl) starsEl.textContent = stars(p.rating);
      var countEl = ratingWrapper.querySelector('.rating-count');
      if (countEl) countEl.textContent = (p.review_count || 0) + ' ' + tr('reviewsLabel');
    }

    var priceEl = document.querySelector('.product-price');
    if (priceEl) {
      var html = '<span class="product-price-current">' + HN.money(p.price_cents) + '</span>';
      if (p.compare_at_price_cents && p.compare_at_price_cents > p.price_cents) {
        var off = Math.round((1 - p.price_cents / p.compare_at_price_cents) * 100);
        html += '<span class="product-price-original">' + HN.money(p.compare_at_price_cents) + '</span>';
        html += '<span class="product-price-discount">' + off + '% OFF</span>';
      }
      priceEl.innerHTML = html;
    }

    var descEl = document.querySelector('.product-short-desc');
    if (descEl) descEl.textContent = localized(p, 'description_en', 'description_fr', 'description_ar', '');

    // Colors
    var colorWrap = document.querySelector('.color-options-detail');
    if (colorWrap && Array.isArray(p.colors) && p.colors.length) {
      var colorsHtml = '';
      p.colors.forEach(function (c, i) {
        colorsHtml += '<span class="color-option' + (i === 0 ? ' active' : '') + '" style="background-color: ' + colorHex(c) + ';' + (String(c).toLowerCase() === 'white' ? ' border: 1px solid #ccc;' : '') + '" data-color="' + esc(c) + '"></span>';
      });
      colorWrap.innerHTML = colorsHtml;
      var colorLabel = document.getElementById('selectedColor');
      if (colorLabel) colorLabel.textContent = p.colors[0];
    }

    // Sizes
    var sizeWrap = document.querySelector('.size-options');
    if (sizeWrap && Array.isArray(p.sizes) && p.sizes.length) {
      var sizesHtml = '';
      p.sizes.forEach(function (s, i) {
        sizesHtml += '<button class="size-option' + (i === 0 ? ' active' : '') + '" type="button">' + esc(s) + '</button>';
      });
      sizeWrap.innerHTML = sizesHtml;
      var sizeLabel = document.getElementById('selectedSize');
      if (sizeLabel) sizeLabel.textContent = p.sizes[0];
    }

    // Breadcrumb last crumb
    var crumbs = document.querySelectorAll('.page-header-breadcrumb span');
    if (crumbs.length) crumbs[crumbs.length - 1].textContent = HN.productName(p);

    // Title
    document.title = HN.productName(p) + ' | Hanna & Nour';
  }

  function renderDetails(p) {
    // Description tab
    var descTab = document.getElementById('tab-description');
    if (descTab) {
      var features = Array.isArray(p.features_en) ? p.features_en : [];
      if (features.length) {
        var heading = descTab.querySelector('h2');
        var list = descTab.querySelector('ul');
        if (heading) heading.textContent = tr('whyTitle');
        if (list) {
          var html = '';
          features.forEach(function (f) { html += '<li>' + esc(f) + '</li>'; });
          list.innerHTML = html;
        }
      }
    }

    // Fabric & Care tab
    var fabricTab = document.getElementById('tab-fabric');
    if (fabricTab) {
      var comp = fabricTab.querySelector('p');
      var compList = fabricTab.querySelector('ul');
      if (comp) comp.textContent = localized(p, 'fabric_comp_en', 'fabric_comp_fr', 'fabric_comp_ar', '');
      if (compList && Array.isArray(p.care_en)) {
        var careHtml = '';
        p.care_en.forEach(function (c) { careHtml += '<li>' + esc(c) + '</li>'; });
        compList.innerHTML = careHtml;
      }
    }

    // Reviews tab heading
    var reviewTabBtn = document.querySelector('.tab-btn[data-tab="reviews"]');
    if (reviewTabBtn) reviewTabBtn.textContent = tr('tabReviewsN', { n: p.review_count || 0 });
  }

  /* ---- Variants & stock ---- */

  function productVariants(p) {
    if (Array.isArray(p.variants)) return p.variants;
    if (Array.isArray(p.product_variants)) return p.product_variants;
    return [];
  }

  function lower(s) { return String(s || '').toLowerCase().trim(); }

  function variantFor(p, color, size) {
    var vs = productVariants(p);
    if (!vs.length) return null;
    var c = lower(color);
    var s = lower(size);
    for (var i = 0; i < vs.length; i++) {
      if (lower(vs[i].color) === c && lower(vs[i].size) === s) return vs[i];
    }
    return null;
  }

  // Returns an integer stock, or null when the product has no managed variants.
  function stockFor(p, color, size) {
    var v = variantFor(p, color, size);
    if (!v) return null;
    return Math.max(0, parseInt(v.stock, 10) || 0);
  }

  var stockEl = null;

  function ensureStockLabel() {
    if (stockEl) return stockEl;
    var actions = document.querySelector('.product-actions');
    if (!actions) return null;
    stockEl = document.createElement('p');
    stockEl.id = 'stockInfo';
    stockEl.style.cssText = 'font-size: 0.875rem; font-weight: 600; margin: 0 0 var(--spacing-md);';
    actions.parentNode.insertBefore(stockEl, actions);
    return stockEl;
  }

  function updateStockUI() {
    if (!current) return;
    var p = current;
    var vs = productVariants(p);
    var managed = vs.length > 0;

    var colorLabel = document.getElementById('selectedColor');
    var sizeLabel = document.getElementById('selectedSize');
    var color = colorLabel ? colorLabel.textContent : '';
    var size = sizeLabel ? sizeLabel.textContent : '';

    // Mark out-of-stock sizes for the current color.
    document.querySelectorAll('.size-option').forEach(function (btn) {
      var s = btn.textContent.trim();
      var st = managed ? stockFor(p, color, s) : null;
      btn.disabled = managed && st === 0;
      btn.classList.toggle('out-of-stock', managed && st === 0);
      btn.title = managed && st === 0 ? tr('notAvailable') : '';
    });

    var stock = managed ? stockFor(p, color, size) : null;
    var inStock = !managed || (stock !== null && stock > 0);

    var addBtn = document.getElementById('addToCartBtn');
    var buyBtn = document.getElementById('buyNowBtn');
    if (addBtn) addBtn.disabled = !inStock;
    if (buyBtn) buyBtn.disabled = !inStock;

    // Cap the quantity input to the available stock.
    var qtyInput = document.getElementById('quantity');
    if (qtyInput) {
      qtyInput.max = managed && stock !== null ? Math.min(10, Math.max(1, stock)) : 10;
      if (managed && stock !== null && (parseInt(qtyInput.value, 10) || 1) > stock) {
        qtyInput.value = Math.max(1, stock);
      }
    }

    var label = ensureStockLabel();
    if (!label) return;
    if (!managed) { label.style.display = 'none'; return; }
    label.style.display = '';
    label.style.color = 'var(--color-gray)';
    if (stock === 0) {
      label.textContent = tr('stockOut');
      label.style.color = 'var(--color-burgundy)';
    } else if (stock <= 5) {
      label.textContent = tr('stockLow', { n: stock });
      label.style.color = '#b5792a';
    } else {
      label.textContent = tr('stockIn');
    }
  }

  /* ---- Reviews ---- */

  function loadReviews(p) {
    var list = document.getElementById('reviewList');
    var numberEl = document.querySelector('.reviews-number');
    var totalEl = document.querySelector('.reviews-total');
    if (numberEl) numberEl.textContent = p.rating || '0';
    if (totalEl) totalEl.textContent = tr('reviewSummaryN', { n: p.review_count || 0 });
    if (!list) return;

    fetch(HN.api('reviews') + '?product=' + encodeURIComponent(p.slug))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var reviews = data.reviews || [];
        if (!reviews.length) {
          list.innerHTML = '<p style="color: var(--color-gray);">' + tr('noReviews') + '</p>';
          return;
        }
        var html = '';
        reviews.forEach(function (r) {
          var date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
          html += '<div class="review-card">' +
            '<div class="review-header"><div class="review-author">' +
            '<div class="review-avatar">' + esc((r.author_name || '?').charAt(0).toUpperCase()) + '</div>' +
            '<div><p class="review-name">' + esc(r.author_name) + '</p>' +
            '<p class="review-date">' + esc(date) + '</p></div></div>' +
            '<span class="stars">' + stars(r.rating) + '</span></div>' +
            '<p class="review-text">' + esc(r.body) + '</p></div>';
        });
        list.innerHTML = html;
      })
      .catch(function () { /* static demo reviews remain */ });
  }

  function wireReviewForm(p) {
    var form = document.getElementById('reviewForm');
    if (!form) return;

    // Remove old handler if main.js bound one (it no longer does).
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('reviewName');
      var rating = document.getElementById('reviewRating');
      var text = document.getElementById('reviewText');
      var btn = form.querySelector('button[type="submit"]');

      if (!name || !text || !name.value.trim() || !text.value.trim()) return;
      if (btn) btn.disabled = true;

      fetch(HN.api('reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: p.slug,
          author_name: name.value.trim(),
          rating: rating ? rating.value : 5,
          body: text.value.trim()
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast(tr('reviewThanks'), tr('reviewThanksMsg'), 'success');
            form.reset();
          } else {
            showToast(tr('reviewError'), data.error || tr('demoMsg'), 'error');
          }
        })
        .catch(function () {
          showToast(tr('reviewError'), tr('demoMsg'), 'error');
        })
        .finally(function () { if (btn) btn.disabled = false; });
    });
  }

  /* ---- Add to cart / buy now ---- */

  function selectedOptions() {
    var color = '';
    var size = '';
    var colorLabel = document.getElementById('selectedColor');
    var sizeLabel = document.getElementById('selectedSize');
    if (colorLabel) color = colorLabel.textContent;
    if (sizeLabel) size = sizeLabel.textContent;
    var qty = 1;
    var qtyInput = document.getElementById('quantity');
    if (qtyInput) qty = parseInt(qtyInput.value, 10) || 1;

    if (!current) return { color: color, size: size, qty: qty, variantId: null, stock: null };
    var stock = stockFor(current, color, size);
    var variant = variantFor(current, color, size);
    var managed = productVariants(current).length > 0;
    if (managed && stock === 0) { qty = 0; }
    if (managed && qty > stock) { qty = Math.max(0, stock); }
    return { color: color, size: size, qty: qty, variantId: variant ? variant.id : null, stock: managed ? stock : null };
  }

  function wireActions(p) {
    var addBtn = document.getElementById('addToCartBtn');
    var buyBtn = document.getElementById('buyNowBtn');

    function handleAdd(redirect) {
      var o = selectedOptions();
      if (o.qty === 0) {
        showToast(tr('stockOut'), tr('notAvailable'), 'error');
        return;
      }
      HN.cart.add({
        slug: p.slug,
        name_en: p.name_en || HN.productName(p),
        price_cents: p.price_cents,
        image: p.image || ''
      }, { color: o.color, size: o.size, qty: o.qty, variantId: o.variantId, stock: o.stock });
      showToast(tr('cartAdd'), HN.productName(p) + ' x' + o.qty + ' ' + tr('cartAddMsg'), 'success');
      if (redirect) window.location.href = 'checkout.html';
    }

    if (addBtn) addBtn.addEventListener('click', function () { handleAdd(false); });
    if (buyBtn) buyBtn.addEventListener('click', function () { handleAdd(true); });
  }

  function showToast(t, m, type) {
    if (typeof window.hnToast === 'function') window.hnToast(t, m, type);
  }

  /* ---- Init ---- */

  function init() {
    var slug = getSlug();
    if (!slug) return;

    HN.loadProducts()
      .then(function (products) {
        var p = null;
        for (var i = 0; i < products.length; i++) {
          if (products[i].slug === slug) { p = products[i]; break; }
        }
        if (!p) throw new Error('not found');
        current = p;
        renderGallery(p);
        renderInfo(p);
        renderDetails(p);
        loadReviews(p);
        wireActions(p);
        wireReviewForm(p);
        updateStockUI();
        HN.updateWishlistHearts();
      })
      .catch(function () {
        showToast(tr('productNotFound'), tr('goToShop'), 'error');
        setTimeout(function () { window.location.href = 'shop.html'; }, 1200);
      });
  }

  var current = null;

  // main.js handles color/size selection via document-level delegation (runs
  // first). This listener re-evaluates the stock state right after, using the
  // already-updated labels.
  document.addEventListener('click', function (e) {
    if (!current) return;
    var target = e.target;
    if (target && (target.closest('.color-option') || target.closest('.size-option'))) {
      updateStockUI();
    }
  });

  document.addEventListener('langchange', function () {
    if (current) {
      renderInfo(current);
      renderDetails(current);
      updateStockUI();
    }
  });

  init();
})();