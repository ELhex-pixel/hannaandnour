/* Editorial presentation only: the existing product controller owns all purchases. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null, require('./product-media'), require('./colors'));
  else root.HN_PRODUCT_LANDING = factory(root, root.HN_MEDIA, root.HN_COLORS);
})(typeof window !== 'undefined' ? window : this, function (root, media, colors) {
  'use strict';
  function enabled(slug) { return slug === 'ensemble-col-rond-pantalon-large'; }
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function localized(p, field, lang) { return p[field + '_' + lang] || p[field + '_en'] || p[field + '_fr'] || p[field + '_ar'] || ''; }
  function list(p, field, lang) { var value = localized(p, field, lang); return Array.isArray(value) ? value.filter(function (item) { return typeof item === 'string' && item.trim(); }) : []; }
  function availability(p, color) {
    var variants = Array.isArray(p.variants) ? p.variants : Array.isArray(p.product_variants) ? p.product_variants : [];
    var matching = variants.filter(function (v) { return v && v.active === true && media.norm(v.color) === media.norm(color); });
    if (matching.some(function (v) { return Number.isInteger(v.stock) && v.stock > 0; })) return 'in';
    if (!variants.length || matching.some(function (v) { return !Number.isInteger(v.stock) || v.stock < 0; })) return 'unknown';
    return 'out';
  }
  function editorialHTML(p, lang, color, cfg, t, image) {
    if (!enabled(p.slug)) return '';
    lang = ['fr','en','ar'].indexOf(lang) >= 0 ? lang : 'fr';
    var selection = media.select(p, color), photo = selection.images[1] || selection.images[0];
    var small = photo ? image(photo, 480) : '', large = photo ? image(photo, 960) : '';
    var responsive = small && small !== large ? ' srcset="' + esc(small) + ' 480w, ' + esc(large) + ' 960w" sizes="(max-width:767px) calc(100vw - 32px), 560px"' : '';
    var features = list(p, 'features', lang), fit = localized(p, 'fit', lang), measures = localized(p, 'measurements', lang);
    var material = localized(p, 'fabric_comp', lang), care = list(p, 'care', lang);
    var policy = cfg && cfg.return_policy, days = policy && Number.isInteger(policy.days) && policy.days >= 14 && policy.days <= 365 ? policy.days : null;
    var caption = selection.matched && color ? colors.label(color, lang) : t('landingGeneralView');
    var facts = features.map(function (feature, index) { return '<li><span class="landing-fact-number">0' + (index + 1) + '</span><span>' + esc(feature) + '</span></li>'; }).join('');
    function detail(title, value) { return value ? '<div class="landing-detail-line"><h3>' + esc(title) + '</h3><p>' + esc(value).replace(/\r?\n/g, '<br>') + '</p></div>' : ''; }
    var body = '<div class="container landing-editorial-inner"><div class="landing-section-heading"><div><p class="landing-eyebrow">' + esc(t('landingDetailsKicker')) + '</p><h2 id="landingDetailsTitle">' + esc(t('landingDetailsTitle')) + '</h2></div><span class="landing-section-index" aria-hidden="true">01 / 03</span></div>';
    if (facts) body += '<ul class="landing-facts">' + facts + '</ul>';
    body += '<div class="landing-look-grid">' + (photo ? '<figure class="landing-look-photo"><img src="' + esc(small) + '"' + responsive + ' alt="' + esc(localized(p, 'name', lang) + ' — ' + caption) + '" loading="lazy" decoding="async"><figcaption>' + esc(caption) + '</figcaption></figure>' : '') + '<div class="landing-look-copy"><p class="landing-eyebrow">' + esc(t('landingModelKicker')) + '</p><h2>' + esc(t('landingModelTitle')) + '</h2>' + detail(t('tabDescription'), localized(p, 'description', lang)) + detail(t('productFit'), fit) + detail(t('productMeasurements'), measures) + detail(t('fabricComp'), material) + (care.length ? detail(t('careTitle'), care.join('\n')) : '') + '<button type="button" class="btn btn-primary" data-landing-target="landingOptions">' + esc(t('landingChoose')) + '<span aria-hidden="true"> ↗</span></button></div></div>';
    body += '<section class="landing-faq" aria-labelledby="landingFaqTitle"><div class="landing-section-heading"><div><p class="landing-eyebrow">' + esc(t('landingFaqKicker')) + '</p><h2 id="landingFaqTitle">' + esc(t('landingFaqTitle')) + '</h2></div><span class="landing-section-index" aria-hidden="true">02 / 03</span></div>';
    var questions = [
      [t('landingSizeQuestion'), fit || t('landingSizeAnswer')],
      [t('landingShippingQuestion'), t('landingShippingAnswer')],
      [t('landingReturnsQuestion'), days ? t('landingReturnsAnswer', { days: days }) : t('landingReturnsFallback')]
    ];
    questions.forEach(function (q, index) { body += '<details data-landing-faq="' + index + '"><summary>' + esc(q[0]) + '<span aria-hidden="true">+</span></summary><p>' + esc(q[1]) + (index === 2 ? ' <a href="/' + lang + '/terms.html">' + esc(t('landingReadTerms')) + '</a>' : '') + '</p></details>'; });
    body += '</section><section class="landing-final"><span class="landing-section-index" aria-hidden="true">03 / 03</span><p class="landing-eyebrow">Hanna &amp; Nour</p><h2>' + esc(t('landingFinalTitle')) + '</h2><p>' + esc(t('landingFinalText')) + '</p><button type="button" class="btn btn-primary btn-lg" data-landing-target="landingOptions">' + esc(t('landingChoose')) + ' <span aria-hidden="true">↗</span></button></section></div>';
    return body;
  }

  var signature = '', previousRoot = null, ratingObserved = null;
  function headerHeight() {
    if (!root || !root.document.body.classList.contains('product-landing')) return;
    var header = root.document.getElementById('header');
    if (header) root.document.body.style.setProperty('--landing-header-height', Math.ceil(header.getBoundingClientRect().height) + 'px');
  }
  function refresh(p, cfg, flags) {
    if (!root || !root.HN || !root.document) return;
    var doc = root.document, on = enabled(p.slug);
    doc.body.classList.toggle('product-landing', on);
    if (!on) return;
    flags = flags || {};
    var HN = root.HN, t = HN.tr, lang = HN.lang(), info = doc.querySelector('.product-info'), editorial = doc.getElementById('productLandingEditorial');
    if (!info || !editorial) return;
    headerHeight();
    info.id = 'landingOptions';
    var rating = info.querySelector('.product-rating');
    function showRating() { var count = rating && rating.querySelector('.rating-count'); if (count) rating.hidden = parseInt(count.textContent, 10) === 0; }
    showRating();
    if (rating && rating !== ratingObserved && root.MutationObserver) { new root.MutationObserver(showRating).observe(rating.querySelector('.rating-count'), { childList: true, characterData: true, subtree: true }); ratingObserved = rating; }
    function node(id, tag, className, before) {
      var element = doc.getElementById(id);
      if (!element) { element = doc.createElement(tag); element.id = id; element.className = className; before.parentNode.insertBefore(element, before); }
      return element;
    }
    var title = info.querySelector('.product-title-row');
    node('landingEyebrow', 'p', 'landing-eyebrow', title).textContent = t('landingHeroKicker');
    var fit = node('landingFit', 'p', 'landing-fit', info.querySelector('.product-option-group'));
    fit.textContent = localized(p, 'fit', lang); fit.hidden = !fit.textContent;
    var sizeGroup = info.querySelector('.size-options').closest('.product-option-group'), quantityGroup = doc.getElementById('quantity').closest('.product-option-group');
    if (!doc.getElementById('landingSizeQuantity')) { var choices = doc.createElement('div'); choices.id = 'landingSizeQuantity'; choices.className = 'landing-size-quantity'; sizeGroup.parentNode.insertBefore(choices, sizeGroup); choices.appendChild(sizeGroup); choices.appendChild(quantityGroup); }
    var selected = doc.querySelector('.color-option.active'), color = selected ? selected.getAttribute('data-color') : '';
    doc.querySelectorAll('.product-thumbnail').forEach(function (thumb, index) {
      thumb.tabIndex = 0; thumb.setAttribute('role','button'); thumb.setAttribute('aria-label', t('landingViewPhoto', { n: index + 1 })); thumb.setAttribute('aria-pressed', thumb.classList.contains('active') ? 'true' : 'false');
    });
    doc.querySelectorAll('.color-option').forEach(function (button) {
      var name = button.getAttribute('data-color'), status = flags.failed ? 'unknown' : availability(p, name);
      if (!button.querySelector('.landing-swatch')) {
        var swatch = doc.createElement('span'); swatch.className = 'landing-swatch'; swatch.style.background = button.style.background;
        var label = doc.createElement('span'); label.className = 'landing-color-label';
        var state = doc.createElement('span'); state.className = 'landing-color-state';
        button.textContent = ''; button.appendChild(swatch); button.appendChild(label); button.appendChild(state);
      }
      var shown = colors.label(name, lang), stateText = t(status === 'in' ? 'stockIn' : status === 'out' ? 'stockOut' : 'landingCheckOptions');
      button.querySelector('.landing-color-label').textContent = shown; button.querySelector('.landing-color-state').textContent = stateText;
      button.setAttribute('data-landing-availability', status); button.setAttribute('aria-label', shown + ' — ' + stateText);
      button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false');
    });
    var other = node('landingOtherColor', 'p', 'landing-other-color', info.querySelector('.color-options-detail'));
    var hasOther = Array.from(doc.querySelectorAll('.color-option')).some(function (button) { return availability(p, button.getAttribute('data-color')) === 'in'; });
    other.hidden = flags.failed || !color || availability(p, color) !== 'out' || !hasOther;
    other.textContent = t('landingOtherColor');
    var actions = info.querySelector('.product-actions');
    var reassurance = doc.getElementById('landingReassurance');
    if (!reassurance) { reassurance = doc.createElement('div'); reassurance.id = 'landingReassurance'; reassurance.className = 'landing-reassurance'; actions.insertAdjacentElement('afterend', reassurance); }
    var policy = cfg && cfg.return_policy, days = policy && Number.isInteger(policy.days) && policy.days >= 14 && policy.days <= 365 ? policy.days : null;
    reassurance.textContent = '';
    [t('landingStripe'), flags.failed || !days ? t('metaReturnTitle') : t('landingReturnDays', { days: days })].forEach(function (value) { var span = doc.createElement('span'); span.textContent = value; reassurance.appendChild(span); });
    var image = function (src, width) { return HN.image(src, width); };
    var html = editorialHTML(p, lang, color, flags.failed ? null : cfg, t, image);
    if (html !== signature || previousRoot !== editorial) {
      var opened = Array.from(editorial.querySelectorAll('details[open]')).map(function (detail) { return detail.getAttribute('data-landing-faq'); });
      editorial.innerHTML = html; opened.forEach(function (index) { var detail = editorial.querySelector('[data-landing-faq="' + index + '"]'); if (detail) detail.open = true; });
      signature = html; previousRoot = editorial;
    }
  }
  if (root && root.document) root.document.addEventListener('click', function (event) {
    if (root.document.body.classList.contains('product-landing') && event.target.closest && event.target.closest('.product-thumbnail')) root.document.querySelectorAll('.product-thumbnail').forEach(function (thumb) { thumb.setAttribute('aria-pressed', thumb.classList.contains('active') ? 'true' : 'false'); });
    var button = event.target.closest && event.target.closest('[data-landing-target]');
    if (!button) return;
    var target = root.document.getElementById(button.getAttribute('data-landing-target'));
    if (!target) return;
    target.scrollIntoView({ behavior: root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    var control = target.querySelector('.color-option') || target.querySelector('.size-option') || target.querySelector('button'); if (control) control.focus({ preventScroll: true });
  });
  if (root && root.document) root.document.addEventListener('keydown', function (event) {
    if (!root.document.body.classList.contains('product-landing') || ['Enter',' '].indexOf(event.key) < 0) return;
    var thumb = event.target.closest && event.target.closest('.product-thumbnail'); if (thumb) { event.preventDefault(); thumb.click(); }
  });
  if (root && root.document) { root.addEventListener('resize', headerHeight); if (root.document.fonts) root.document.fonts.ready.then(headerHeight); }
  return { enabled: enabled, availability: availability, editorialHTML: editorialHTML, refresh: refresh };
});
