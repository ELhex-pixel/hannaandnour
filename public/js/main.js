/**
 * Hanna & Nour - Main JavaScript (shared UI only)
 * Handles header/navigation, toasts, modals, tabs, newsletter,
 * wishlist & quick-add delegation. Page-specific logic lives in
 * dedicated scripts: shop.js, product.js, cart-page.js, checkout.js, account.js.
 */

(function() {
  'use strict';

  function tr(key, params) {
    return window.I18n && typeof window.I18n.t === 'function' ? window.I18n.t(key, params) : key;
  }

  /* ==============================================
     Toast Notifications
     ============================================== */

  function showToast(title, message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'toast-icon ' + (type === 'error' ? 'error' : 'success');
    icon.textContent = type === 'error' ? '\u2715' : '\u2713';

    const content = document.createElement('div');
    content.className = 'toast-content';

    const titleEl = document.createElement('p');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;

    const messageEl = document.createElement('p');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;

    content.appendChild(titleEl);
    content.appendChild(messageEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';

    toast.appendChild(icon);
    toast.appendChild(content);
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add('show');
    });

    closeBtn.addEventListener('click', function() {
      removeToast(toast);
    });

    setTimeout(function() {
      removeToast(toast);
    }, 4000);
  }

  function removeToast(toast) {
    if (!toast) return;
    toast.classList.remove('show');
    setTimeout(function() {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  window.hnToast = showToast;

  /* ==============================================
     Header & Mobile Navigation
     ============================================== */

  const header = document.getElementById('header');
  const menuToggle = document.getElementById('menuToggle');
  const navClose = document.getElementById('navClose');
  const navMobile = document.getElementById('navMobile');

  if (header) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }

  if (menuToggle && navMobile) {
    menuToggle.addEventListener('click', function() {
      navMobile.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

  if (navClose && navMobile) {
    navClose.addEventListener('click', function() {
      navMobile.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  if (navMobile) {
    navMobile.addEventListener('click', function(e) {
      if (e.target.closest('.nav-mobile-link')) {
        navMobile.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }

  /* ==============================================
     Newsletter Form -> real API
     ============================================== */

  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const input = this.querySelector('input[type="email"]');
      const email = input && input.value ? input.value.trim() : '';
      if (!email) return;

      const btn = this.querySelector('button[type="submit"]');
      const original = btn ? btn.textContent : null;
      if (btn) btn.disabled = true;

      fetch((window.HN ? window.HN.api('newsletter') : '/.netlify/functions/newsletter'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, source: 'footer' })
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.ok) {
            showToast(tr('newsletterOk'), tr('newsletterOkMsg'), 'success');
            newsletterForm.reset();
          } else {
            showToast(tr('newsletterError'), (data.error || tr('demoMsg')), 'error');
          }
        })
        .catch(function() {
          showToast(tr('newsletterError'), tr('demoMsg'), 'error');
        })
        .finally(function() {
          if (btn) { btn.disabled = false; if (original) btn.textContent = original; }
        });
    });
  }

  /* ==============================================
     Search modal (catalog-wide)
     ============================================== */

  function buildSearchModal() {
    if (document.getElementById('searchModal')) return;
    const modal = document.createElement('div');
    modal.className = 'search-overlay';
    modal.id = 'searchModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<div class="search-box" role="search">' +
      '  <div class="search-box-header">' +
      '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>' +
      '    <input type="search" class="search-input" id="searchInput" autocomplete="off" spellcheck="false">' +
      '    <button class="search-close" id="searchClose" aria-label="Close">\u00d7</button>' +
      '  </div>' +
      '  <div class="search-results" id="searchResults"></div>' +
      '</div>';
    document.body.appendChild(modal);
    return modal;
  }

  function searchMatches(p, q) {
    const query = String(q || '').toLowerCase().trim();
    if (!query) return false;
    const fields = [
      p.name_en, p.name_fr, p.name_ar, p.name,
      p.description_en, p.description_fr, p.description_ar,
      p.category
    ];
    return fields.some(function (f) {
      return f && String(f).toLowerCase().indexOf(query) >= 0;
    }) || [].concat(p.colors || [], p.occasions || [], p.sizes || []).some(function (t) {
      return t && String(t).toLowerCase().indexOf(query) >= 0;
    });
  }

  function renderSearchResults(list, q, box) {
    if (!box) return;
    if (list.length === 0) {
      box.innerHTML = '<p class="search-result-empty">' + tr('searchEmpty') + '</p>';
      return;
    }
    box.innerHTML = list.map(function (p) {
      const name = window.HN.productName(p);
      const url = 'product.html?slug=' + encodeURIComponent(p.slug);
      return '<a class="search-result" href="' + url + '">' +
        '  <img class="search-result-img" src="' + (p.image || 'images/hero.jpg') + '" alt="' + name.replace(/"/g, '&quot;') + '" loading="lazy">' +
        '  <div class="search-result-body">' +
        '    <p class="search-result-name">' + name + '</p>' +
        '    <p class="search-result-meta">' + window.HN.money(p.price_cents) + '</p>' +
        '  </div>' +
        '</a>';
    }).join('');
  }

  function initSearch() {
    const modal = buildSearchModal();
    if (!modal) return;
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    const closeBtn = document.getElementById('searchClose');

    function setPlaceholder() {
      input.setAttribute('placeholder', tr('searchPlaceholder'));
    }

    function openSearch() {
      setPlaceholder();
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      setTimeout(function () { input.focus(); }, 30);
      if (window.HN) {
        window.HN.loadProducts()
          .then(function () { if (input.value) runSearch(input.value); })
          .catch(function () { /* offline: no catalog to search */ });
      }
    }

    function closeSearch() {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }

    function runSearch(q) {
      const query = String(q || '').trim();
      if (query.length < 2 || !window.HN) {
        renderSearchResults([], query, results);
        return;
      }
      const all = (window.HN.products ? window.HN.products() : []) || [];
      const list = all.filter(function (p) { return p.active !== false && searchMatches(p, query); }).slice(0, 12);
      renderSearchResults(list, query, results);
    }

    let debounceTimer;
    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (input.value.trim().length >= 2) renderSearchResults([], input.value, results);
        runSearch(input.value);
      }, 160);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSearch();
    });

    closeBtn.addEventListener('click', closeSearch);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeSearch();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('active')) closeSearch();
    });
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.header-action-btn[aria-label="Search"]');
      if (btn) {
        e.preventDefault();
        openSearch();
      }
    });
    document.addEventListener('langchange', setPlaceholder);
  }

  /* ==============================================
     Wishlist toggle (persisted by store.js)
     ============================================== */

  // Header wishlist icon: if it's still a <button>, make it open the wishlist page.
  document.addEventListener('click', function(e) {
    const hb = e.target.closest('.header-action-btn[aria-label="Wishlist"]');
    if (hb && hb.tagName === 'BUTTON' && hb.classList.contains('header-action-btn') && !hb.closest('.product-wishlist')) {
      e.preventDefault();
      window.location.href = 'account.html#wishlist';
    }
  });

  document.addEventListener('click', function(e) {
    const wishlistBtn = e.target.closest('.product-wishlist');
    if (!wishlistBtn) return;
    e.preventDefault();

    const card = wishlistBtn.closest('.product-card, [data-slug]');
    const slug = card ? card.getAttribute('data-slug') : null;

    if (slug) {
      const res = window.HN.wishlist.toggle(slug);
      wishlistBtn.classList.toggle('active', res.active);
      showToast(res.active ? tr('wishAdd') : tr('wishRemove'),
        card && (card.querySelector('.product-card-title') || card.querySelector('.product-title')) ? (card.querySelector('.product-card-title') || card.querySelector('.product-title')).textContent : tr('productFallback'),
        'success');
    } else {
      wishlistBtn.classList.toggle('active');
      showToast(wishlistBtn.classList.contains('active') ? tr('wishAdd') : tr('wishRemove'), tr('productFallback'), 'success');
    }
  });

  /* ==============================================
     Quick Add to Cart (persisted by store.js)
     ============================================== */

  document.addEventListener('click', function(e) {
    const quickAddBtn = e.target.closest('[data-add-to-cart], .product-card-quick-add .btn');
    if (!quickAddBtn) return;
    e.preventDefault();
    if (window.HN && window.HN.quickAdd) {
      window.HN.quickAdd(quickAddBtn);
    }
  });

  /* ==============================================
     Product Page: Image Gallery
     ============================================== */

  window.switchImage = function(el) {
    const mainImage = document.getElementById('mainImage');
    const thumbnails = document.querySelectorAll('.product-thumbnail');

    if (!mainImage || !el) return;

    const img = el.tagName === 'IMG' ? el : el.querySelector('img');
    mainImage.src = img.src;
    mainImage.style.filter = img.style.filter || '';

    thumbnails.forEach(function(t) {
      t.classList.remove('active');
    });
    const wrapper = el.closest('.product-thumbnail');
    if (wrapper) wrapper.classList.add('active');
  };

  /* ==============================================
     Product Page: Color & Size Selection
     ============================================== */

  window.selectColor = function(el, name) {
    const options = el.parentElement.querySelectorAll('.color-option');
    options.forEach(function(o) {
      o.classList.remove('active');
    });
    el.classList.add('active');

    const label = document.getElementById('selectedColor');
    if (label) label.textContent = name;
  };

  window.selectSize = function(el, size) {
    const options = el.parentElement.querySelectorAll('.size-option');
    options.forEach(function(o) {
      o.classList.remove('active');
    });
    el.classList.add('active');

    const label = document.getElementById('selectedSize');
    if (label) label.textContent = size;
  };

  /* ==============================================
     Product Page: Quantity Selector
     ============================================== */

  const qtyMinus = document.getElementById('qtyMinus');
  const qtyPlus = document.getElementById('qtyPlus');
  const quantityInput = document.getElementById('quantity');

  if (qtyMinus && quantityInput) {
    qtyMinus.addEventListener('click', function() {
      let val = parseInt(quantityInput.value, 10) || 1;
      if (val > 1) quantityInput.value = val - 1;
    });
  }

  if (qtyPlus && quantityInput) {
    qtyPlus.addEventListener('click', function() {
      let val = parseInt(quantityInput.value, 10) || 1;
      if (val < 10) quantityInput.value = val + 1;
    });
  }

  if (quantityInput) {
    quantityInput.addEventListener('change', function() {
      let val = parseInt(this.value, 10);
      if (isNaN(val) || val < 1) this.value = 1;
      if (val > 10) this.value = 10;
    });
  }

  /* ==============================================
     Product Page: Tabs
     ============================================== */

  window.switchTab = function(tabId, btn) {
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(function(c) {
      c.classList.remove('active');
    });

    const target = document.getElementById('tab-' + tabId);
    if (target) target.classList.add('active');

    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function(b) {
      b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
  };

  /* ==============================================
     Modals (Size Guide, etc.)
     ============================================== */

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function openModal(modal) {
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  const sizeGuideBtn = document.getElementById('sizeGuideBtn');
  const sizeGuideModal = document.getElementById('sizeGuideModal');
  const sizeGuideClose = document.getElementById('sizeGuideClose');

  if (sizeGuideBtn && sizeGuideModal) {
    sizeGuideBtn.addEventListener('click', function() {
      openModal(sizeGuideModal);
    });
  }

  if (sizeGuideClose && sizeGuideModal) {
    sizeGuideClose.addEventListener('click', function() {
      closeModal(sizeGuideModal);
    });
  }

  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal(e.target);
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(function(m) {
        closeModal(m);
      });
    }
  });

  /* ==============================================
     Product Page: Delegated Interactions
     ============================================== */

  document.addEventListener('click', function(e) {
    const thumb = e.target.closest('.product-thumbnail');
    if (thumb) window.switchImage(thumb);
  });

  document.addEventListener('click', function(e) {
    const color = e.target.closest('.color-option');
    if (color) {
      const name = color.getAttribute('data-color') || 'Gold';
      window.selectColor(color, name);
    }
  });

  document.addEventListener('click', function(e) {
    const size = e.target.closest('.size-option');
    if (size) window.selectSize(size, size.textContent.trim());
  });

  document.addEventListener('click', function(e) {
    const tab = e.target.closest('.tab-btn, [data-tab]');
    if (tab) {
      window.switchTab(tab.getAttribute('data-tab'), tab);
      if (!tab.classList.contains('tab-btn')) e.preventDefault();
    }
  });

  /* ==============================================
     Scroll Animations
     ============================================== */

  const animatedElements = document.querySelectorAll('[data-animate]');

  if ('IntersectionObserver' in window && animatedElements.length) {
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('animated');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    animatedElements.forEach(function(el) {
      observer.observe(el);
    });
  }

  /* ==============================================
     Header Page Padding
     ============================================== */

  function addHeaderOffset() {
    if (header) {
      const headerHeight = header.offsetHeight;
      const pageHeader = document.querySelector('.page-header');
      if (pageHeader && !pageHeader.getAttribute('style')) {
        pageHeader.style.paddingTop = (headerHeight + 30) + 'px';
      }
    }
  }

  window.addEventListener('load', addHeaderOffset);

  /* ==============================================
     Cart badge sync (store.js keeps it fresh)
     ============================================== */

  if (window.HN) {
    window.HN.refreshBadge();
  }

  initSearch();

  if (window.HN && window.HN.track) {
    window.HN.track('pageview');
  }

})();