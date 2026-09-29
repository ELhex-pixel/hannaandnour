(function () {
  'use strict';

  // Page dédiée « Votre avis nous intéresse » ouverte depuis l'email
  // d'invitation à noter (review.html?slug=xxx). Règles identiques à la page
  // produit : seul un client connecté dont la commande (payée + livrée)
  // contient le produit peut poster un avis.

  var HN = window.HN;
  if (!HN) return;
  var SLUG = (window.location.search.match(/[?&]slug=([^&]+)/) || [])[1];

  function $(id) { return document.getElementById(id); }

  function tr(k) { return HN && HN.tr ? HN.tr(k) : k; }

  function showToast(t, m, type) {
    if (typeof window.hnToast === 'function') window.hnToast(t, m, type);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function showGate(msg, isLogin) {
    $('reviewFormPanel').style.display = 'none';
    $('reviewThanks').style.display = 'none';
    var gate = $('reviewGate');
    gate.style.display = '';
    gate.innerHTML = '<p style="color: var(--color-gray); margin: 0;">' + msg +
      (isLogin ? ' <a href="account.html" style="color: var(--color-emerald);">' + tr('accountTitle') + '</a>' : '') + '</p>';
  }

  function showForm(p) {
    $('reviewGate').style.display = 'none';
    $('reviewThanks').style.display = 'none';
    $('reviewFormPanel').style.display = '';
    var user = window.HN_AUTH ? HN_AUTH.currentUser() : null;
    var nameInput = $('reviewName');
    if (nameInput && user) {
      nameInput.value = ((user.first_name || '').trim()) || String(user.email || '').split('@')[0];
      nameInput.readOnly = true;
    }
  }

  function showThanks() {
    $('reviewGate').style.display = 'none';
    $('reviewFormPanel').style.display = 'none';
    var t = $('reviewThanks');
    t.style.display = '';
    t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function updateReviewGate(p) {
    if (!$('reviewForm') || !$('reviewGate')) return;

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
        if (eligible) showForm(p);
        else showGate(tr('reviewGateNotEligible'), false);
      })
      .catch(function () {
        if (window.HN_AUTH && HN_AUTH.isAuthed()) showGate(tr('reviewGateNotEligible'), false);
        else showGate(tr('reviewGateLogin'), true);
      });
  }

  function wireReviewForm(p) {
    var form = $('reviewForm');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('reviewName');
      var rating = $('reviewRating');
      var text = $('reviewText');
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
            showThanks();
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

  function renderProduct(p) {
    var name = window.HN.productName(p);
    var img = p.image || 'images/hero.jpg';
    $('reviewProduct').innerHTML =
      '<img src="' + img + '" alt="' + esc(name) + '" style="width: 72px; height: 72px; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0;">' +
      '<div style="min-width: 0;">' +
        '<p style="font-weight: 600; margin-bottom: var(--spacing-xs);">' + esc(name) + '</p>' +
        '<a href="product.html?slug=' + encodeURIComponent(p.slug) + '" style="color: var(--color-emerald); font-size: 0.875rem;">' + tr('reviewProductLink') + '</a>' +
      '</div>';
    document.title = tr('reviewPageTitle') + ' | Hanna & Nour';
  }

  function notFound() {
    document.title = tr('reviewNotFound') + ' | Hanna & Nour';
    var hero = $('reviewProduct');
    if (hero) hero.style.display = 'none';
    var panel = $('reviewFormPanel');
    if (panel) panel.style.display = 'none';
    var gate = $('reviewGate');
    if (gate) gate.style.display = 'none';
    var nf = $('reviewNotFound');
    if (nf) nf.style.display = '';
  }

  function init() {
    if (!SLUG) {
      notFound();
      return;
    }
    HN.loadConfig()
      .then(function () { return HN.loadProducts(); })
      .then(function (products) {
        var p = null;
        for (var i = 0; i < products.length; i++) {
          if (products[i].slug === SLUG) { p = products[i]; break; }
        }
        if (!p) throw new Error('not found');
        renderProduct(p);
        wireReviewForm(p);
        updateReviewGate(p);
      })
      .catch(function () {
        notFound();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();