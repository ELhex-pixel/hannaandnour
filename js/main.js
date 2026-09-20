/**
 * Hanna & Nour - Main JavaScript
 * Handles navigation, interactions, filters, and UI components
 */

(function() {
  'use strict';

  function tr(key, params) {
    return window.I18n && typeof window.I18n.t === 'function' ? window.I18n.t(key, params) : key;
  }

  /* ==============================================
     Header & Mobile Navigation
     ============================================== */

  const header = document.getElementById('header');
  const menuToggle = document.getElementById('menuToggle');
  const navClose = document.getElementById('navClose');
  const navMobile = document.getElementById('navMobile');

  // Scroll effect
  if (header) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 50) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    });
  }

  // Mobile menu open
  if (menuToggle && navMobile) {
    menuToggle.addEventListener('click', function() {
      navMobile.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  }

  // Mobile menu close
  if (navClose && navMobile) {
    navClose.addEventListener('click', function() {
      navMobile.classList.remove('active');
      document.body.style.overflow = '';
    });
  }

  // Close mobile menu on link click
  if (navMobile) {
    navMobile.addEventListener('click', function(e) {
      if (e.target.closest('.nav-mobile-link')) {
        navMobile.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
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

    // Show animation
    requestAnimationFrame(function() {
      toast.classList.add('show');
    });

    // Close button
    closeBtn.addEventListener('click', function() {
      removeToast(toast);
    });

    // Auto dismiss
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

  /* ==============================================
     Newsletter Form
     ============================================== */

  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const input = this.querySelector('input[type="email"]');
      if (input && input.value) {
        showToast(tr('welcomeTitle'), tr('welcomeMsg'), 'success');
        this.reset();
      }
    });
  }

  /* ==============================================
     Product Wishlist
     ============================================== */

  document.addEventListener('click', function(e) {
    const wishlistBtn = e.target.closest('.product-wishlist');
    if (wishlistBtn) {
      e.preventDefault();
      wishlistBtn.classList.toggle('active');
      showToast(
        wishlistBtn.classList.contains('active') ? tr('wishAdd') : tr('wishRemove'),
        wishlistBtn.closest('.product-card')
          ? wishlistBtn.closest('.product-card').querySelector('.product-card-title').textContent
          : tr('productFallback'),
        'success'
      );
    }
  });

  /* ==============================================
     Product Quick Add
     ============================================== */

  document.addEventListener('click', function(e) {
    const quickAddBtn = e.target.closest('[data-add-to-cart], .product-card-quick-add .btn');
    if (quickAddBtn) {
      const card = quickAddBtn.closest('.product-card');
      const name = card ? card.querySelector('.product-card-title').textContent : tr('productFallback');
      showToast(tr('cartAdd'), name + ' ' + tr('cartAddMsg'), 'success');
      updateCartCount(1);
    }
  });

  /* ==============================================
     Cart Count Badge
     ============================================== */

  function updateCartCount(change) {
    const badge = document.querySelector('.cart-count');
    if (!badge) return;
    let count = parseInt(badge.textContent, 10) || 0;
    count += change;
    badge.textContent = count;
  }

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
      if (val > 1) {
        quantityInput.value = val - 1;
      }
    });
  }

  if (qtyPlus && quantityInput) {
    qtyPlus.addEventListener('click', function() {
      let val = parseInt(quantityInput.value, 10) || 1;
      if (val < 10) {
        quantityInput.value = val + 1;
      }
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
     Product Page: Add to Cart & Buy Now
     ============================================== */

  const addToCartBtn = document.getElementById('addToCartBtn');
  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', function() {
      const title = document.querySelector('.product-title');
      const qty = quantityInput ? (parseInt(quantityInput.value, 10) || 1) : 1;
      showToast(tr('cartAdd'), (title ? title.textContent : tr('productFallback')) + ' x' + qty + ' ' + tr('cartAddMsg'), 'success');
      updateCartCount(qty);
    });
  }

  const buyNowBtn = document.getElementById('buyNowBtn');
  if (buyNowBtn) {
    buyNowBtn.addEventListener('click', function() {
      window.location.href = 'checkout.html';
    });
  }

  /* ==============================================
     Product Page: Tabs
     ============================================== */

  window.switchTab = function(tabId, btn) {
    // Hide all tab content
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(function(c) {
      c.classList.remove('active');
    });

    // Show selected tab
    const target = document.getElementById('tab-' + tabId);
    if (target) target.classList.add('active');

    // Update buttons
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach(function(b) {
      b.classList.remove('active');
    });
    if (btn) btn.classList.add('active');
  };

  /* ==============================================
     Product Page: Review Form
     ============================================== */

  const reviewForm = document.getElementById('reviewForm');
  if (reviewForm) {
    reviewForm.addEventListener('submit', function(e) {
      e.preventDefault();
      showToast(tr('reviewThanks'), tr('reviewThanksMsg'), 'success');
      this.reset();
    });
  }

  /* ==============================================
     Size Guide Modal
     ============================================== */

  const sizeGuideBtn = document.getElementById('sizeGuideBtn');
  const sizeGuideModal = document.getElementById('sizeGuideModal');
  const sizeGuideClose = document.getElementById('sizeGuideClose');

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

  // Close modal on overlay click
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
      closeModal(e.target);
    }
  });

  // Close modal on Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      const openModals = document.querySelectorAll('.modal-overlay.active');
      openModals.forEach(function(m) {
        closeModal(m);
      });
    }
  });

  /* ==============================================
     Product Page: Interaction Delegation
     (replaces inline onclick handlers for CSP)
     ============================================== */

  // Product thumbnails -> switchImage
  document.addEventListener('click', function(e) {
    const thumb = e.target.closest('.product-thumbnail');
    if (thumb) {
      window.switchImage(thumb);
    }
  });

  // Color options -> selectColor
  document.addEventListener('click', function(e) {
    const color = e.target.closest('.color-option');
    if (color) {
      const name = color.getAttribute('data-color') || 'Gold';
      window.selectColor(color, name);
    }
  });

  // Size options -> selectSize
  document.addEventListener('click', function(e) {
    const size = e.target.closest('.size-option');
    if (size) {
      window.selectSize(size, size.textContent.trim());
    }
  });

  // Tab buttons -> switchTab
  document.addEventListener('click', function(e) {
    const tab = e.target.closest('.tab-btn, [data-tab]');
    if (tab) {
      window.switchTab(tab.getAttribute('data-tab'), tab);
      if (!tab.classList.contains('tab-btn')) {
        e.preventDefault();
      }
    }
  });

  /* ==============================================
     Form Submission Neutralization
     No backend exists: block native GET submits
     that would leak data into the URL.
     ============================================== */

  function neutralizeForm(form) {
    if (!form || form.getAttribute('data-neutralized')) return;
    form.setAttribute('data-neutralized', 'true');
    form.addEventListener('submit', function(ev) {
      ev.preventDefault();
      showToast(tr('demoTitle'), tr('demoMsg'), 'success');
      form.reset();
    });
  }

  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form) return;
    // Only neutralize forms that have no real action endpoint
    const action = form.getAttribute('action') || '';
    if (action && action.indexOf('mailto:') !== 0) return;
    if (form.id === 'newsletterForm' || form.id === 'reviewForm') return;
    neutralizeForm(form);
  });

  /* ==============================================
     Shop Page: Filters
     ============================================== */

  // Collapsible filter groups
  document.querySelectorAll('.filter-title').forEach(function(title) {
    title.addEventListener('click', function() {
      this.classList.toggle('collapsed');
      const options = this.nextElementSibling;
      if (options) {
        options.style.display = options.style.display === 'none' ? 'flex' : 'none';
      }
    });
  });

  // Filter option click toggles active state
  document.querySelectorAll('.filter-option').forEach(function(option) {
    option.addEventListener('click', function() {
      this.classList.toggle('active');
      updateActiveFilters();
      filterProducts();
    });
  });

  // Color swatch toggle
  document.querySelectorAll('.color-swatch').forEach(function(swatch) {
    swatch.addEventListener('click', function() {
      this.classList.toggle('active');
      filterProducts();
    });
  });

  // Mobile filter toggle
  const filterToggle = document.getElementById('filterToggle');
  const shopSidebar = document.getElementById('shopSidebar');

  if (filterToggle && shopSidebar) {
    filterToggle.addEventListener('click', function() {
      shopSidebar.classList.toggle('active');
    });
  }

  // Active filter tags
  function updateActiveFilters() {
    const container = document.getElementById('activeFilters');
    if (!container) return;

    const activeOptions = document.querySelectorAll('.filter-option.active');
    const labels = [];

    activeOptions.forEach(function(opt) {
      const labelText = opt.textContent.trim();
      labels.push({
        text: labelText,
        el: opt
      });
    });

    container.textContent = '';

    if (labels.length === 0) {
      const tag = document.createElement('span');
      tag.className = 'filter-tag';
      tag.textContent = tr('allProducts') + ' ';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'filter-tag-remove';
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.textContent = '\u00d7';
      tag.appendChild(removeBtn);
      container.appendChild(tag);
    } else {
      labels.forEach(function(item) {
        const tag = document.createElement('span');
        tag.className = 'filter-tag';
        tag.textContent = item.text + ' ';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'filter-tag-remove';
        removeBtn.setAttribute('aria-label', 'Remove');
        removeBtn.textContent = '\u00d7';
        removeBtn.addEventListener('click', function() {
          item.el.classList.remove('active');
          updateActiveFilters();
          filterProducts();
        });
        tag.appendChild(removeBtn);
        container.appendChild(tag);
      });
    }
  }

  // Product filtering
  function filterProducts() {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.product-card');
    const categoryOptions = document.querySelectorAll('.filter-option.active');
    const selectedCategories = [];

    categoryOptions.forEach(function(opt) {
      const text = opt.textContent.trim().toLowerCase();
      if (text.includes('hijab')) selectedCategories.push('hijabs');
      if (text.includes('abaya')) selectedCategories.push('abayas');
      if (text.includes('dress')) selectedCategories.push('dresses');
      if (text.includes('prayer')) selectedCategories.push('prayer');
      if (text.includes('accessor')) selectedCategories.push('accessories');
    });

    // If only "All Products" is selected or nothing, show all
    const showAll = selectedCategories.length === 0 ||
      (selectedCategories.includes('hijabs') && selectedCategories.includes('abayas') &&
       selectedCategories.includes('dresses') && selectedCategories.includes('prayer') &&
       selectedCategories.includes('accessories'));

    // Price filter
    const priceInputs = document.querySelectorAll('.price-input');
    let minPrice = null;
    let maxPrice = null;

    if (priceInputs.length >= 2) {
      const minVal = parseInt(priceInputs[0].value, 10);
      const maxVal = parseInt(priceInputs[1].value, 10);
      if (!isNaN(minVal)) minPrice = minVal;
      if (!isNaN(maxVal)) maxPrice = maxVal;
    }

    cards.forEach(function(card) {
      let visible = true;

      // Category filter
      if (!showAll && selectedCategories.length > 0) {
        const cardCategory = card.getAttribute('data-category');
        if (!selectedCategories.includes(cardCategory)) {
          visible = false;
        }
      }

      // Price filter
      if (visible) {
        const price = parseFloat(card.getAttribute('data-price'));
        if (minPrice !== null && price < minPrice) visible = false;
        if (maxPrice !== null && price > maxPrice) visible = false;
      }

      card.style.display = visible ? '' : 'none';
    });

    // Update results count
    let visibleCount = 0;
    cards.forEach(function(card) {
      if (card.style.display !== 'none') visibleCount++;
    });

    const results = document.querySelector('.shop-results');
    if (results) {
      results.textContent = tr('showingResults', { visible: visibleCount, total: cards.length });
    }
  }

  // Price inputs
  document.querySelectorAll('.price-input').forEach(function(input) {
    let timer;
    input.addEventListener('input', function() {
      clearTimeout(timer);
      timer = setTimeout(filterProducts, 400);
    });
  });

  /* ==============================================
     Shop Page: Sorting
     ============================================== */

  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', function() {
      const grid = document.getElementById('productsGrid');
      if (!grid) return;

      const cards = Array.from(grid.querySelectorAll('.product-card'));
      const sortBy = this.value;

      cards.sort(function(a, b) {
        const priceA = parseFloat(a.getAttribute('data-price')) || 0;
        const priceB = parseFloat(b.getAttribute('data-price')) || 0;
        const ratingA = parseFloat(a.getAttribute('data-rating')) || 0;
        const ratingB = parseFloat(b.getAttribute('data-rating')) || 0;

        switch (sortBy) {
          case 'price-asc':
            return priceA - priceB;
          case 'price-desc':
            return priceB - priceA;
          case 'rating':
            return ratingB - ratingA;
          default:
            return 0;
        }
      });

      cards.forEach(function(card) {
        grid.appendChild(card);
      });
    });
  }

  /* ==============================================
     Shop Page: Load More
     ============================================== */

  const loadMoreBtn = document.getElementById('loadMore');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function() {
      showToast(tr('endCatalogTitle'), tr('endCatalogMsg'), 'success');
      this.textContent = tr('allItemsLoaded');
      this.disabled = true;
      this.style.opacity = '0.6';
    });
  }

  /* ==============================================
     Cart Page: Quantity Update
     ============================================== */

  document.addEventListener('click', function(e) {
    const minusBtn = e.target.closest('.cart-qty-minus');
    const plusBtn = e.target.closest('.cart-qty-plus');

    if (minusBtn || plusBtn) {
      const input = (minusBtn || plusBtn).parentElement.querySelector('.cart-qty-input');
      if (!input) return;

      let val = parseInt(input.value, 10) || 1;

      if (minusBtn && val > 1) {
        input.value = val - 1;
        showToast(tr('cartUpdated'), tr('qtyDecreased'), 'success');
        updateCartSummary();
      }

      if (plusBtn && val < 10) {
        input.value = val + 1;
        showToast(tr('cartUpdated'), tr('qtyIncreased'), 'success');
        updateCartSummary();
      }
    }
  });

  // Remove from cart
  document.querySelectorAll('[data-remove-cart]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const item = btn.closest('.cart-item');
      if (item) {
        const name = item.querySelector('.cart-item-title');
        item.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        item.style.opacity = '0';
        item.style.transform = 'translateX(30px)';

        setTimeout(function() {
          item.remove();
          showToast(tr('cartRemove'), (name ? name.textContent : tr('productFallback')) + ' ' + tr('cartRemoveMsg'), 'success');
          updateCartSummary();
        }, 300);
      }
    });
  });

  // Update cart summary values
  function updateCartSummary() {
    const items = document.querySelectorAll('.cart-item');
    const subtotalEl = document.querySelector('.cart-summary-row span + span');
    const totalEl = document.querySelector('.cart-summary-row.total span:last-child');

    if (!items.length) {
      const cartLayout = document.querySelector('.cart-layout');
      if (cartLayout) {
        const empty = document.createElement('div');
        empty.className = 'text-center';
        empty.style.padding = 'var(--spacing-3xl) 0';

        const heading = document.createElement('h2');
        heading.style.fontSize = '2rem';
        heading.style.marginBottom = 'var(--spacing-md)';
        heading.textContent = tr('cartEmptyTitle');

        const desc = document.createElement('p');
        desc.style.color = 'var(--color-gray)';
        desc.style.marginBottom = 'var(--spacing-xl)';
        desc.textContent = tr('cartEmptyDesc');

        const shopLink = document.createElement('a');
        shopLink.href = 'shop.html';
        shopLink.className = 'btn btn-primary btn-lg';
        shopLink.textContent = tr('startShopping');

        empty.appendChild(heading);
        empty.appendChild(desc);
        empty.appendChild(shopLink);
        cartLayout.appendChild(empty);
      }
      return;
    }

    let subtotal = 0;
    items.forEach(function(item) {
      const priceEl = item.querySelector('.cart-item-price');
      const qtyInput = item.querySelector('.cart-qty-input');
      if (priceEl && qtyInput) {
        const price = parseFloat(priceEl.textContent.replace('$', '')) || 0;
        const qty = parseInt(qtyInput.value, 10) || 1;
        subtotal += price * qty;
      }
    });

    const tax = subtotal * 0.07;
    const total = subtotal + tax;

    if (subtotalEl) subtotalEl.textContent = '$' + subtotal.toFixed(2);
    if (totalEl) totalEl.textContent = '$' + total.toFixed(2);
  }

  /* ==============================================
     Cart Page: Promo Code
     ============================================== */

  const applyPromo = document.getElementById('applyPromo');
  const promoInput = document.getElementById('promoInput');
  const applyDiscount = document.getElementById('applyDiscount');
  const discountInput = document.getElementById('discountInput');

  function applyCode(input, isValid) {
    if (input) {
      if (isValid) {
        showToast(tr('promoApplied'), tr('promoAppliedMsg'), 'success');
      } else {
        showToast(tr('invalidCode'), tr('invalidCodeMsg'), 'error');
      }
    } else {
      showToast(tr('noCode'), tr('noCodeMsg'), 'error');
    }
  }

  if (applyPromo && promoInput) {
    applyPromo.addEventListener('click', function() {
      const code = promoInput.value.trim().toUpperCase();
      applyCode(code, code === 'WELCOME15');
    });
  }

  if (applyDiscount && discountInput) {
    applyDiscount.addEventListener('click', function() {
      const code = discountInput.value.trim().toUpperCase();
      applyCode(code, code === 'WELCOME15');
    });
  }

  /* ==============================================
     Checkout Page: Shipping Method Selection
     ============================================== */

  window.selectShipping = function(el) {
    const methods = el.parentElement.querySelectorAll('.payment-method');
    methods.forEach(function(m) {
      m.classList.remove('selected');
    });
    el.classList.add('selected');
  };

  /* ==============================================
     Checkout Page: Payment Method Selection
     ============================================== */

  window.selectPayment = function(el) {
    const methods = el.parentElement.querySelectorAll('.payment-method');
    methods.forEach(function(m) {
      m.classList.remove('selected');
    });
    el.classList.add('selected');
  };

  // Event delegation for payment/shipping method selection (replace inline onclick)
  document.addEventListener('click', function(e) {
    const method = e.target.closest('.payment-method');
    if (!method) return;
    const section = method.closest('.checkout-section');
    if (!section) return;
    const stepTitle = section.querySelector('.checkout-section-title');
    const titleKey = stepTitle ? (stepTitle.getAttribute('data-i18n') || '') : '';
    if (titleKey === 'step3') window.selectShipping(method);
    if (titleKey === 'step4') window.selectPayment(method);
  });

  /* ==============================================
     Checkout Page: Place Order
     ============================================== */

  const placeOrderBtn = document.getElementById('placeOrderBtn');
  if (placeOrderBtn) {
    placeOrderBtn.addEventListener('click', function() {
      this.textContent = tr('processing');
      this.disabled = true;

      setTimeout(function() {
        showToast(tr('orderPlaced'), tr('orderPlacedMsg'), 'success');

        setTimeout(function() {
          window.location.href = 'index.html';
        }, 2500);
      }, 1500);
    });
  }

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
      if (pageHeader) {
        pageHeader.style.paddingTop = (headerHeight + 30) + 'px';
      }
    }
  }

  window.addEventListener('load', addHeaderOffset);

  /* ==============================================
     Language Change: Re-render Dynamic Strings
     ============================================== */

  document.addEventListener('langchange', function() {
    updateCartSummary();
    filterProducts();
    updateActiveFilters();

    const loadMore = document.getElementById('loadMore');
    if (loadMore && loadMore.disabled) loadMore.textContent = tr('allItemsLoaded');

    const placeOrder = document.getElementById('placeOrderBtn');
    if (placeOrder && placeOrder.disabled) placeOrder.textContent = tr('processing');
  });

})();