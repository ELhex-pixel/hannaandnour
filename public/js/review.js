(function () {
  'use strict';

  // Page dédiée « Votre avis nous intéresse » ouverte depuis l'email
  // d'invitation à noter (review.html?slug=xxx&order=NNN).
  // Deux parcours :
  //   - Client connecté : éligibilité = commande payée + livrée contenant
  //     le produit (compte ou invité avec le même e-mail).
  //   - Invité (sans compte) : il prouve son achat avec le n° de commande et
  //     l'e-mail, en plus du produit. Son avis passe aussi par la validation
  //     admin (status pending).

  var HN = window.HN;
  if (!HN) return;
  var SLUG = (window.location.search.match(/[?&]slug=([^&]+)/) || [])[1];
  var ORDER_NUM = (window.location.search.match(/[?&]order=([^&]+)/) || [])[1];

  var GUEST = null; // { orderNumber, email } confirmé par la preuve d'achat

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

    if (!isLogin) {
      gate.innerHTML = '<p style="color: var(--color-gray); margin: 0;">' + msg + '</p>';
      return;
    }

    // Non connecté : connexion (retour auto) OU preuve d'achat invité.
    var next = 'review.html?slug=' + encodeURIComponent(SLUG) +
      (ORDER_NUM ? '&order=' + encodeURIComponent(ORDER_NUM) : '');
    gate.innerHTML =
      '<p style="margin-bottom: var(--spacing-md); color: var(--color-gray);">' +
        tr('reviewLoginCta') +
        ' <a href="account.html?next=' + encodeURIComponent(next) +
        '" style="color: var(--color-emerald); text-decoration: underline;">' + tr('authSignIn') + '</a>' +
      '</p>' +
      '<div style="display: flex; align-items: center; gap: var(--spacing-md); margin: var(--spacing-md) 0;">' +
        '<span style="flex: 1; height: 1px; background: var(--color-blush);"></span>' +
        '<span style="font-size: 0.8125rem; color: var(--color-gray); text-transform: uppercase; letter-spacing: 0.05em;">' + tr('orSeparator') + '</span>' +
        '<span style="flex: 1; height: 1px; background: var(--color-blush);"></span>' +
      '</div>' +
      '<p style="font-weight: 600; margin-bottom: var(--spacing-xs);">' + tr('reviewGuestTitle') + '</p>' +
      '<p style="font-size: 0.875rem; color: var(--color-gray); margin-bottom: var(--spacing-md);">' + tr('reviewGuestIntro') + '</p>' +
      '<form id="guestProofForm" style="display: grid; gap: var(--spacing-sm);">' +
        '<div class="form-group" style="margin: 0;">' +
          '<label class="form-label" for="guestOrder">' + tr('reviewOrderLabel') + '</label>' +
          '<input type="text" class="form-input" id="guestOrder" value="' + esc(ORDER_NUM || '') + '" placeholder="HN-012345" autocomplete="off">' +
        '</div>' +
        '<div class="form-group" style="margin: 0;">' +
          '<label class="form-label" for="guestEmail">' + tr('reviewGuestEmailLabel') + '</label>' +
          '<input type="email" class="form-input" id="guestEmail" placeholder="exemple@email.com" autocomplete="email">' +
        '</div>' +
        '<button type="submit" class="btn btn-primary" style="justify-self: start;">' + tr('reviewVerifyBtn') + '</button>' +
      '</form>' +
      '<p id="guestProofMsg" style="display: none; margin-top: var(--spacing-md); color: var(--color-error, #b00020); font-size: 0.875rem;"></p>';

    wireGuestProof();
  }

  function wireGuestProof() {
    var form = $('guestProofForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var orderNumber = $('guestOrder').value.trim();
      var email = $('guestEmail').value.trim();
      var btn = form.querySelector('button[type="submit"]');
      var msg = $('guestProofMsg');
      if (msg) { msg.style.display = 'none'; }
      if (!orderNumber || !email) {
        if (msg) { msg.textContent = tr('reviewCheckError'); msg.style.display = 'block'; }
        return;
      }
      if (btn) btn.disabled = true;

      fetch(HN.api('reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', product: SLUG, order_number: orderNumber, email: email })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            GUEST = { orderNumber: orderNumber, email: email };
            showForm(data.customer_name || '');
          } else if (msg) {
            msg.textContent = tr(data.error === 'already_reviewed' ? 'reviewAlreadyReviewed' : 'reviewCheckError');
            msg.style.display = 'block';
          }
        })
        .catch(function () {
          if (msg) { msg.textContent = tr('reviewCheckError'); msg.style.display = 'block'; }
        })
        .finally(function () { if (btn) btn.disabled = false; });
    });
  }

  function showForm(guestName) {
    $('reviewGate').style.display = 'none';
    $('reviewThanks').style.display = 'none';
    $('reviewFormPanel').style.display = '';
    var user = window.HN_AUTH && HN_AUTH.isAuthed() ? HN_AUTH.currentUser() : null;
    var nameInput = $('reviewName');
    if (nameInput) {
      if (guestName) {
        nameInput.value = guestName;
        nameInput.readOnly = true;
      } else if (user) {
        nameInput.value = ((user.first_name || '').trim()) || String(user.email || '').split('@')[0];
        nameInput.readOnly = true;
      }
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
        if (eligible) showForm('');
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

      var body = {
        product: p.slug,
        author_name: name.value.trim(),
        rating: rating ? rating.value : 5,
        body: text.value.trim()
      };
      if (GUEST) {
        body.order_number = GUEST.orderNumber;
        body.email = GUEST.email;
      }

      fetch(HN.api('reviews'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': (window.HN_AUTH && HN_AUTH.token()) ? 'Bearer ' + HN_AUTH.token() : ''
        },
        body: JSON.stringify(body)
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showThanks();
          } else {
            showToast(tr('reviewError'), data.error === 'already_reviewed' ? tr('reviewAlreadyReviewed') : (data.error || tr('demoMsg')), 'error');
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
      .then(function () { return HN.loadProductSlugs([SLUG]); })
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
