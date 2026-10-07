/**
 * Product page: renders the product from ?slug= and wires up
 * Add to Cart / Buy Now / Reviews with the real backend.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var COLORS = window.HN_COLORS || {
    hex: function () { return '#A67C00'; },
    label: function (n) { return String(n == null ? '' : n); }
  };

  var RETURNS_DAYS = 30;
  var DEMO_ON = false;
  var KNOWN_REVIEW_COUNT = 0;
  var KNOWN_RATING = 0;

  var SIZE_DIMS = {
    'one size': [180, 70], '180cm x 70cm': [180, 70], '180 x 70': [180, 70],
    'large': [200, 75], '200cm x 75cm': [200, 75],
    'extra large': [220, 90], 'xl': [220, 90], '220cm x 90cm': [220, 90]
  };
  var SIZE_BEST_KEY = {
    'one size': 'sgR1',
    'large': 'sgR2',
    'extra large': 'sgR3',
    'xl': 'sgR3'
  };

  function catKey(cat) {
    return HN.catKey(cat);
  }

  function colorHex(name) {
    return COLORS.hex(name);
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

  function listLocalized(p, fieldEn) {
    var lang = HN.lang();
    var fr = fieldEn.replace('_en', '_fr');
    var ar = fieldEn.replace('_en', '_ar');
    if (lang === 'fr' && Array.isArray(p[fr]) && p[fr].length) return p[fr];
    if (lang === 'ar' && Array.isArray(p[ar]) && p[ar].length) return p[ar];
    return Array.isArray(p[fieldEn]) ? p[fieldEn] : [];
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
        html += '<div class="product-thumbnail' + (i === 0 ? ' active' : '') + '" data-img="' + esc(images[i]) + '">' +
          '<img src="' + esc(images[i]) + '" alt="' + esc(HN.productName(p)) + ' view"' + (filter ? ' style="filter:' + filter + ';"' : '') + '></div>';
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
      if (starsEl) starsEl.textContent = KNOWN_REVIEW_COUNT ? stars(KNOWN_RATING) : '';
      var countEl = ratingWrapper.querySelector('.rating-count');
      if (countEl) countEl.textContent = KNOWN_REVIEW_COUNT + ' ' + tr('reviewsLabel');
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
      var lang = HN.lang();
      p.colors.forEach(function (c, i) {
        colorsHtml += '<span class="color-option' + (i === 0 ? ' active' : '') + '" style="background-color: ' + colorHex(c) + ';' + (String(c).toLowerCase() === 'white' ? ' border: 1px solid #ccc;' : '') + '" data-color="' + esc(c) + '" title="' + esc(COLORS.label(c, lang)) + '"></span>';
      });
      colorWrap.innerHTML = colorsHtml;
      var colorLabel = document.getElementById('selectedColor');
      if (colorLabel) colorLabel.textContent = COLORS.label(p.colors[0], lang);
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

    injectProductSchema(p);
    updateReturnsMeta();
  }

  function updateReturnsMeta() {
    var titleEl = document.querySelector('[data-i18n="metaReturnTitle"]');
    var textEl = document.querySelector('[data-i18n="metaReturnText"]');
    if (titleEl) titleEl.textContent = tr('metaReturnTitleN', { n: RETURNS_DAYS });
    if (textEl) textEl.textContent = tr('metaReturnTextN', { n: RETURNS_DAYS });
  }

  function injectProductSchema(p) {
    var head = document.getElementsByTagName('head')[0];
    var old = document.getElementById('product-jsonld');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var schema = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: HN.productName(p),
      image: [new URL(p.image || 'images/hero.jpg', window.location.origin + '/').href],
      description: localized(p, 'description_en', 'description_fr', 'description_ar', ''),
      sku: p.sku || p.slug,
      brand: { '@type': 'Brand', name: 'Hanna & Nour' },
      offers: {
        '@type': 'Offer',
        url: window.location.origin + '/' + HN.lang() + '/product.html?slug=' + encodeURIComponent(p.slug),
        priceCurrency: ((typeof HN.currency === 'function' ? HN.currency() : '') || 'USD').toUpperCase(),
        price: ((parseInt(p.price_cents, 10) || 0) / 100).toFixed(2),
        availability: productVariants(p).length && !productVariants(p).some(function (v) { return variantStock(v) > 0; }) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock'
      }
    };
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.href = schema.offers.url;
    var description = document.querySelector('meta[name="description"]');
    if (description) description.content = schema.description.slice(0, 160);
    document.querySelectorAll('link[hreflang]').forEach(function (link) { var lang = link.hreflang === 'x-default' ? 'fr' : link.hreflang; link.href = window.location.origin + '/' + lang + '/product.html?slug=' + encodeURIComponent(p.slug); });

    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'product-jsonld';
    script.textContent = JSON.stringify(schema);
    head.appendChild(script);
  }

  function renderDetails(p) {
    // Description tab
    var descTab = document.getElementById('tab-description');
    if (descTab) {
      var features = listLocalized(p, 'features_en');
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
      var extra = document.getElementById('productRichDetails');
      if (!extra) { extra = document.createElement('div'); extra.id = 'productRichDetails'; descTab.appendChild(extra); }
      extra.textContent = '';
      ['fit', 'measurements'].forEach(function (field) {
        var value = localized(p, field + '_en', field + '_fr', field + '_ar', '');
        if (!value) return;
        var title = document.createElement('h3'); title.textContent = tr(field === 'fit' ? 'productFit' : 'productMeasurements'); extra.appendChild(title);
        var text = document.createElement('p'); text.textContent = value; text.style.whiteSpace = 'pre-line'; extra.appendChild(text);
      });
      if (p.opacity && p.opacity !== 'unspecified') { var opacity = document.createElement('p'); opacity.textContent = tr('productOpacity') + ' : ' + tr('opacity_' + p.opacity); extra.appendChild(opacity); }
      if (/^https:\/\//.test(p.video_url || '')) { var link = document.createElement('a'); link.href = p.video_url; link.textContent = tr('productVideo'); link.target = '_blank'; link.rel = 'noopener noreferrer'; extra.appendChild(link); }
    }

    // Fabric & Care tab
    var fabricTab = document.getElementById('tab-fabric');
    if (fabricTab) {
      var comp = fabricTab.querySelector('p');
      var compList = fabricTab.querySelector('ul');
      if (comp) comp.textContent = localized(p, 'fabric_comp_en', 'fabric_comp_fr', 'fabric_comp_ar', '');
      var care = listLocalized(p, 'care_en');
      if (compList && care.length) {
        var careHtml = '';
        care.forEach(function (c) { careHtml += '<li>' + esc(c) + '</li>'; });
        compList.innerHTML = careHtml;
      }
      var fabLine = document.getElementById('fabricListLine');
      if (fabLine) {
        if (Array.isArray(p.fabrics) && p.fabrics.length) {
          fabLine.textContent = tr('fabricLabel') + ': ' + p.fabrics.join(', ');
          fabLine.style.display = '';
        } else {
          fabLine.style.display = 'none';
        }
      }
    }

    // Reviews tab heading (real count is applied once reviews load)
    var reviewTabBtn = document.querySelector('.tab-btn[data-tab="reviews"]');
    if (reviewTabBtn) reviewTabBtn.textContent = tr('tabReviewsN', { n: 0 });
  }

  function renderSizeGuide(p) {
    var btn = document.getElementById('sizeGuideBtn');
    var body = document.getElementById('sizeGuideBody');
    if (!btn || !body) return;
    if (!Array.isArray(p.sizes) || !p.sizes.length) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    var rows = p.sizes.map(function (s) {
      var key = String(s || '').toLowerCase().trim();
      var dims = SIZE_DIMS[key];
      var cells = dims
        ? '<td>' + dims[0] + 'cm</td><td>' + dims[1] + 'cm</td>'
        : '<td colspan="2">&mdash;</td>';
      return '<tr><td>' + esc(s) + '</td>' + cells + '<td>' + tr(SIZE_BEST_KEY[key] || 'sgGeneric') + '</td></tr>';
    }).join('');
    body.innerHTML = rows;
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

  function variantStock(v) {
    if (!v || v.active !== true) return 0;
    var stock = Number(v.stock);
    return Number.isInteger(stock) && stock > 0 ? stock : 0;
  }

  // Returns an integer stock, or null when the product has no managed variants.
  function stockFor(p, color, size) {
    if (!productVariants(p).length) return null;
    return variantStock(variantFor(p, color, size));
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
    var activeSwatch = document.querySelector('.color-option.active');
    var color = activeSwatch ? (activeSwatch.getAttribute('data-color') || '') : '';
    var size = sizeLabel ? sizeLabel.textContent : '';
    if (colorLabel) colorLabel.textContent = COLORS.label(color, HN.lang());

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
    var selectedVariant = variantFor(p, color, size);
    if (stock === 0) {
      label.textContent = tr(selectedVariant && selectedVariant.active === true ? 'stockOut' : 'notAvailable');
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

    var demoBox = document.getElementById('demoReviews');
    if (demoBox) demoBox.style.display = 'none';

    if (!list) return;

    function setBars(counts) {
      var rows = document.querySelectorAll('.reviews-bars .review-bar');
      var total = 0;
      for (var i = 0; i < counts.length; i++) total += counts[i];
      for (var j = 0; j < rows.length && j < 5; j++) {
        var n = j < counts.length ? (counts[j] || 0) : 0;
        var fill = rows[j].querySelector('.review-bar-fill');
        if (fill) fill.style.width = total ? Math.round(n / total * 100) + '%' : '0%';
        var countSpan = rows[j].querySelector('.review-bar-count');
        if (countSpan) countSpan.textContent = String(n);
      }
    }

    function setCount(n) {
      KNOWN_REVIEW_COUNT = n;
      var tab = document.querySelector('.tab-btn[data-tab="reviews"]');
      if (tab) tab.textContent = tr('tabReviewsN', { n: n });
    }

    function setSummary(number, count, counts) {
      KNOWN_REVIEW_COUNT = count;
      KNOWN_RATING = parseFloat(number) || 0;
      if (numberEl) numberEl.textContent = number;
      if (totalEl) totalEl.textContent = count ? tr('reviewSummaryN', { n: count }) : tr('noReviews');
      var starsRow = document.querySelector('.reviews-average .stars');
      if (starsRow) starsRow.style.display = count ? '' : 'none';
      if (counts) setBars(counts);
      var ratingWrapper = document.querySelector('.product-rating');
      if (ratingWrapper) {
        var rwStars = ratingWrapper.querySelector('.stars');
        if (rwStars) rwStars.textContent = count ? stars(KNOWN_RATING) : '';
        var topCount = ratingWrapper.querySelector('.rating-count');
        if (topCount) topCount.textContent = count + ' ' + tr('reviewsLabel');
      }
    }

    function reviewCardHtml(r) {
      var date = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';
      return '<div class="review-card">' +
        '<div class="review-header"><div class="review-author">' +
        '<div class="review-avatar">' + esc((r.author_name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div><p class="review-name">' + esc(r.author_name) + '</p>' +
        '<p class="review-date"><span class="review-verified">' + tr('verifiedBadge') + '</span>' + (date ? ' &bull; ' + esc(date) : '') + '</p></div></div>' +
        '<span class="stars">' + stars(r.rating) + '</span></div>' +
        '<p class="review-text">' + esc(r.body) + '</p></div>';
    }

    function sumReviews(reviews, counts) {
      var sum = 0;
      reviews.forEach(function (r) {
        var k = Math.max(1, Math.min(5, parseInt(r.rating, 10) || 0));
        counts[5 - k]++;
        sum += k;
      });
      return sum;
    }

    function demoCardHtml(r) {
      var badge = r.verified ? '<span class="review-verified">' + tr('verifiedBadge') + '</span>' : '';
      return '<div class="review-card">' +
        '<div class="review-header"><div class="review-author">' +
        '<div class="review-avatar">' + esc((r.author_name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div><p class="review-name">' + esc(r.author_name) + '</p>' +
        '<p class="review-date">' + (badge ? badge + ' &bull; ' : '') + esc(r.location || '') + '</p></div></div>' +
        '<span class="stars">' + stars(r.rating) + '</span></div>' +
        '<p class="review-text">' + esc(r.body) + '</p></div>';
    }

    function fetchDemo() {
      return fetch(HN.api('reviews') + '?demo=true')
        .then(function (res) { return res.json(); })
        .then(function (data) { return data.reviews || []; })
        .catch(function () { return null; });
    }

    var demoPromise = DEMO_ON ? fetchDemo() : Promise.resolve([]);

    demoPromise
      .then(function (demo) {
        return fetch(HN.api('reviews') + '?product=' + encodeURIComponent(p.slug))
          .then(function (res) { return res.json(); })
          .then(function (data) {
            var reviews = data.reviews || [];
            var html = '';
            reviews.forEach(function (r) { html += reviewCardHtml(r); });
            list.innerHTML = html;

            var counts = [0, 0, 0, 0, 0];
            var sum = 0;

            if (!DEMO_ON) {
              if (reviews.length) {
                sum = sumReviews(reviews, counts);
                setBars(counts);
                setSummary((sum / reviews.length).toFixed(1), reviews.length, counts);
                setCount(reviews.length);
              } else {
                list.innerHTML = '';
                setSummary('0', 0, counts);
                setCount(0);
              }
              return;
            }

            // Illustration ON: combine admin demo reviews with real ones.
            var demoTotal = 0;
            if (demo === null) {
              // Demo fetch failed: keep the static #demoReviews markup (3 x 5*).
              if (demoBox) demoBox.style.display = '';
              demoTotal = 3;
              sum = 15;
            } else if (demo.length) {
              var dh = '';
              demo.forEach(function (r) { dh += demoCardHtml(r); });
              if (demoBox) { demoBox.innerHTML = dh; demoBox.style.display = ''; }
              demoTotal = demo.length;
              demo.forEach(function (r) { sum += sumReviews([r], counts); });
            } else {
              // Admin has no active demo review: hide the box, real reviews only.
              if (demoBox) demoBox.style.display = 'none';
            }
            sum += sumReviews(reviews, counts);
            var total = demoTotal + reviews.length;
            if (!total) {
              setSummary('0', 0, counts);
              setCount(0);
            } else {
              setBars(counts);
              setSummary((sum / total).toFixed(1), total, counts);
              setCount(total);
            }
          });
      })
      .catch(function () {
        if (DEMO_ON) {
          setSummary('5.0', 3, [3, 0, 0, 0, 0]);
          setCount(3);
        } else {
          setSummary('0', 0, [0, 0, 0, 0, 0]);
          setCount(0);
        }
      });
  }

  var reviewFocusDone = false;

  // Le lien d'invitation à noter (email) arrive avec ?review=1 : on amène le
  // client directement sur l'onglet Avis et le panneau « Écrire un avis ».
  function focusReviewIfRequested() {
    if (reviewFocusDone) return;
    if (!/review=1/.test(window.location.search)) return;
    reviewFocusDone = true;

    var btn = document.querySelector('.tab-btn[data-tab="reviews"]');
    if (window.switchTab) window.switchTab('reviews', btn);

    var form = document.getElementById('reviewForm');
    var gate = document.getElementById('reviewGate');
    var target = null;
    if (form && form.style.display !== 'none') target = form;
    else if (gate && gate.style.display !== 'none') target = gate;
    if (target) {
      setTimeout(function () {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.boxShadow = '0 0 0 3px var(--color-emerald)';
        setTimeout(function () { target.style.boxShadow = ''; }, 2500);
        if (form && form.style.display !== 'none') {
          var f = form.querySelector('#reviewRating, textarea, input');
          if (f) f.focus({ preventScroll: true });
        }
      }, 150);
    }

    // Retire le paramètre : un rechargement ne re-saute pas dessus.
    try {
      var s = window.location.search.replace(/[?&]review=1(&|$)/, function (m, sep) { return sep ? '?' : ''; });
      window.history.replaceState(null, '', window.location.pathname + s);
    } catch (e) { /* ignore */ }
  }

  function updateReviewGate(p) {
    var form = document.getElementById('reviewForm');
    var gate = document.getElementById('reviewGate');
    if (!form || !gate) return;

    function showGate(msg, isLogin) {
      form.style.display = 'none';
      gate.style.display = '';
      gate.innerHTML = '<p style="color: var(--color-gray); margin: 0;">' + msg +
        (isLogin ? ' <a href="account.html" style="color: var(--color-emerald);">' + tr('accountTitle') + '</a>' : '') + '</p>';
      focusReviewIfRequested();
    }

    function showForm() {
      gate.style.display = 'none';
      form.style.display = '';
      var user = window.HN_AUTH ? HN_AUTH.currentUser() : null;
      var nameInput = document.getElementById('reviewName');
      if (nameInput && user) {
        nameInput.value = ((user.first_name || '').trim()) || String(user.email || '').split('@')[0];
        nameInput.readOnly = true;
      }
      focusReviewIfRequested();
    }

    if (!window.HN_AUTH || !window.HN_AUTH.ready) {
      showGate(tr('reviewGateLogin'), true);
      return;
    }
    window.HN_AUTH.ready
      .then(function () {
        if (!window.HN_AUTH || !HN_AUTH.isAuthed()) { showGate(tr('reviewGateLogin'), true); return null; }
        return HN_AUTH.call({ action: 'orders' }, true);
      })
      .then(function (data) {
        if (data === null) return;
        var orders = (data && data.orders) || [];
        var eligible = orders.some(function (o) {
          return o.status === 'paid' && o.shipping_status === 'delivered' &&
            Array.isArray(o.order_items) &&
            o.order_items.some(function (it) { return it.product_slug === p.slug; });
        });
        if (eligible) showForm();
        else showGate(tr('reviewGateNotEligible'), false);
      })
      .catch(function () {
        if (window.HN_AUTH && HN_AUTH.isAuthed()) showGate(tr('reviewGateNotEligible'), false);
        else showGate(tr('reviewGateLogin'), true);
      });
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': (window.HN_AUTH && HN_AUTH.token()) ? 'Bearer ' + HN_AUTH.token() : ''
        },
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
    var sizeLabel = document.getElementById('selectedSize');
    if (sizeLabel) size = sizeLabel.textContent;
    var activeSwatch = document.querySelector('.color-option.active');
    if (activeSwatch) color = activeSwatch.getAttribute('data-color') || '';
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

    // Apply the persisted wishlist state to the detail heart right away,
    // without waiting for the catalog (slug is already known from the URL).
    var infoEl = document.querySelector('.product-info');
    if (infoEl) infoEl.setAttribute('data-slug', slug);
    HN.updateWishlistHearts();

    HN.loadConfig().then(function (cfg) {
      if (cfg && cfg.settings) {
        var d = parseInt(cfg.settings.returns_days, 10);
        if (!isNaN(d) && d > 0) RETURNS_DAYS = d;
      }
      if (cfg && cfg.reviews) DEMO_ON = !!cfg.reviews.show_demo;
      return fetch(HN.api('products') + '?slug=' + encodeURIComponent(slug)).then(function (res) { if (!res.ok) throw new Error('not found'); return res.json(); }).then(function (data) { HN.rememberProducts(data.products || []); return data.products || []; });
    })
      .then(function (products) {
        var p = null;
        for (var i = 0; i < products.length; i++) {
          if (products[i].slug === slug) { p = products[i]; break; }
        }
        if (!p) throw new Error('not found');
        current = p;
        if (HN.track) HN.track('product_view', slug);
        renderGallery(p);
        renderInfo(p);
        renderDetails(p);
        renderSizeGuide(p);
        loadReviews(p);
        wireActions(p);
        wireReviewForm(p);
        updateReviewGate(p);
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
      updateReviewGate(current);
      document.querySelectorAll('.review-verified').forEach(function (el) { el.textContent = tr('verifiedBadge'); });
    }
  });

  init();
})();
