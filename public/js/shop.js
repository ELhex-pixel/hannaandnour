/**
 * Shop page: renders the real product catalog (from store.js),
 * handles filters, sorting and pagination.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var PAGE_SIZE = 8;
  var state = {
    items: [],
    categories: [],
    sizes: [],
    occasions: [],
    minCents: null,
    maxCents: null,
    sort: 'featured',
    page: 1,
    filtersOpen: false,
    facetRevision: 0
  };
  state.ready = false;
  var initial = new URLSearchParams(window.location.search);
  state.collection = ['new','sale'].indexOf(initial.get('collection')) >= 0 ? initial.get('collection') : '';
  state.categories = (initial.get('category') || '').split(',').filter(Boolean).map(normalizeCategory);
  state.sizes = (initial.get('sizes') || '').split(',').filter(Boolean);
  state.occasions = (initial.get('occasions') || '').split(',').filter(Boolean);
  if(initial.has('min')&&/^\d+$/.test(initial.get('min')))state.minCents=Number(initial.get('min'));
  if(initial.has('max')&&/^\d+$/.test(initial.get('max')))state.maxCents=Number(initial.get('max'));
  state.sort = ['featured','price-asc','price-desc','rating','newest'].indexOf(initial.get('sort'))>=0?initial.get('sort'):state.collection==='new'?'newest':'featured';

  var grid = document.getElementById('productsGrid');
  var loadMoreBtn = document.getElementById('loadMore');
  var resultsEl = document.querySelector('.shop-results');
  var activeFiltersEl = document.getElementById('activeFilters');

  function normalizeCategory(cat) {
    var m = { hijabs: 'hijab', hijab: 'hijab', abayas: 'abaya', abaya: 'abaya', dresses: 'dress', dress: 'dress', prayer: 'prayer', prayerwear: 'prayer', accessories: 'accessory', accessory: 'accessory' };
    return m[String(cat || '').toLowerCase().replace(/[\s_-]/g, '')] || String(cat || '').toLowerCase();
  }

  function catKey(cat) {
    return HN.catKey(cat);
  }

/* Shared helpers: keep filter options in sync with the real catalog, so
      anything the admin stores in sizes/occasions appears here. */

  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Canonical orders so the options stay tidy even with mixed admin data.
  var SIZE_ORDER = ['xs', 's', 'm', 'l', 'xl', 'one size'];
  var OCC_ORDER = ['everyday', 'eid', 'wedding', 'prayer', 'work', 'travel'];

  function canonicalSort(list, order) {
    return list.slice().sort(function (a, b) {
      var ia = order.indexOf(String(a).toLowerCase());
      var ib = order.indexOf(String(b).toLowerCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
    });
  }

  function buildFilterOptions() {
    var facets=state.facets;
    // Never offer hard-coded categories or options inferred from a partial page.
    var categories=facets?facets.categories:[];
    document.querySelectorAll('.filter-option[data-group="category"]').forEach(function(option){
      var value=option.getAttribute('data-value')||'';
      option.hidden=value!==''&&categories.indexOf(value)<0&&state.categories.indexOf(value)<0;
    });
    function selectedOptions(available,selected){var result=available.slice();selected.forEach(function(value){if(result.indexOf(value)<0)result.push(value);});return result;}
    function showGroup(group,visible){var node=document.querySelector('[data-filter-group="'+group+'"]');if(node)node.hidden=!visible;}
    showGroup('category',!!facets&&categories.length>1||state.categories.length>0);

    var sizes = canonicalSort(selectedOptions(facets?facets.sizes:[],state.sizes), SIZE_ORDER);
    showGroup('size',!!facets&&facets.sizes.length>1||state.sizes.length>0);
    var sizeEl = document.getElementById('sizeOptions');
    if (sizeEl) {
      sizeEl.innerHTML = sizes.map(function (s) {
        return '<label class="filter-option" data-group="size" data-value="' + escAttr(s) + '">' +
          '<span class="filter-checkbox"></span> <span>' + escAttr(s) + '</span>' +
          '</label>';
      }).join('');
    }

    var occasions = canonicalSort(selectedOptions(facets?facets.occasions:[],state.occasions), OCC_ORDER);
    showGroup('occasion',!!facets&&facets.occasions.length>1||state.occasions.length>0);
    var occEl = document.getElementById('occasionOptions');
    if (occEl) {
      occEl.innerHTML = occasions.map(function (o) {
        return '<label class="filter-option" data-group="occasion" data-value="' + escAttr(o) + '">' +
          '<span class="filter-checkbox"></span> <span>' + escAttr(o) + '</span>' +
          '</label>';
      }).join('');
    }

    showGroup('price',!!facets&&facets.min_price_cents!==null&&facets.min_price_cents<facets.max_price_cents||state.minCents!==null||state.maxCents!==null);
    var hasFilters=Array.prototype.some.call(document.querySelectorAll('[data-filter-group]'),function(node){return !node.hidden;});
    var toggle=document.getElementById('filterToggle');if(toggle)toggle.hidden=!hasFilters;
    document.querySelectorAll('.filter-count').forEach(function (node) { node.textContent = ''; });
    setFilterControls();
  }

  function buildCard(p, index) {
    return HN.card(p, index);
  }

  function loadItems(force) {
    var facetRevision=++state.facetRevision;
    state.facets=null;buildFilterOptions();
    state.configuration = HN.requireConfig(force).then(function (config) {
      state.ready = true;
      return config;
    });
    HN.request(HN.api('products') + '?facets=true').then(function (facets) {
      if(facetRevision!==state.facetRevision)return;
      if (!facets||!['categories','sizes','occasions'].every(function(key){return Array.isArray(facets[key])&&facets[key].every(function(v){return typeof v==='string'&&v.trim();});})||!Number.isSafeInteger(facets.total)||facets.total<0||!((facets.total===0&&facets.min_price_cents===null&&facets.max_price_cents===null)||(facets.total>0&&Number.isSafeInteger(facets.min_price_cents)&&facets.min_price_cents>0&&Number.isSafeInteger(facets.max_price_cents)&&facets.max_price_cents>=facets.min_price_cents)))throw new Error('Invalid facets');
      state.facets = facets; buildFilterOptions();
    }).catch(function () { if(facetRevision===state.facetRevision){state.facets = null;buildFilterOptions();} });
  }

  function render() {
    if (!grid || !state.configuration) return;
    renderRemote();
  }

  /* ---- Active filter tags ---- */

  var remoteRevision = 0;
  var remoteSignature = '';
  var remoteItems = [];
  function renderRemote() {
    var params = new URLSearchParams({ category: state.categories.join(','), sizes: state.sizes.join(','), occasions: state.occasions.join(','), sort: state.sort, limit: PAGE_SIZE });
    if (state.minCents !== null) params.set('min', state.minCents);
    if (state.maxCents !== null) params.set('max', state.maxCents);
    if (state.collection) params.set('collection', state.collection);
    var url = new URL(window.location.href);
    ['category','sizes','occasions','sort','min','max','collection'].forEach(function(key){var value=params.get(key);if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);});
    window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    var signature = params.toString();
    if (signature !== remoteSignature || state.page === 1) remoteItems = [];
    remoteSignature = signature;
    params.set('page', state.page);
    var revision = ++remoteRevision;
    HN.loading(grid, 'card', PAGE_SIZE);
    if (resultsEl) resultsEl.textContent = '';
    if (loadMoreBtn) loadMoreBtn.disabled = true;
    Promise.all([HN.request(HN.api('products') + '?' + params.toString()), state.configuration])
      .then(function (results) {
        var data = results[0];
        if (revision !== remoteRevision) return;
        if (!Array.isArray(data.products)) throw new Error(tr('liveLoadError'));
        var seen = {};
        remoteItems = remoteItems.concat(data.products || []).filter(function (p) { if (seen[p.slug]) return false; seen[p.slug] = true; return true; });
        state.items = remoteItems;
        HN.rememberProducts(data.products || []);
        grid.innerHTML = remoteItems.map(buildCard).join('') || '<p class="text-center">' + tr('emptyCatalog') + '</p>';
        HN.loaded(grid);
        HN.updateWishlistHearts();
        if (resultsEl) resultsEl.textContent = tr('showingResults', { visible: remoteItems.length, total: Number.isInteger(data.total) ? data.total : remoteItems.length });
        if (loadMoreBtn) { loadMoreBtn.hidden = !data.has_more; loadMoreBtn.disabled = false; loadMoreBtn.style.display = data.has_more ? '' : 'none'; }
        document.querySelectorAll('.filter-count').forEach(function (node) { node.textContent = ''; });
        buildFilterOptions();
        updateActiveFilters();
      }).catch(function () {
        if (revision !== remoteRevision) return;
        if (loadMoreBtn) loadMoreBtn.hidden = true;
        HN.loadError(grid, state.ready ? render : function () { init(true); });
      });
  }

  function updateActiveFilters() {
    if (!activeFiltersEl) return;
    var tags = [];
    if(state.collection)tags.push({text:tr(state.collection==='new'?'linkNewArrivals':'linkPromotions'),remove:function(){state.collection='';state.page=1;render();}});
    state.categories.forEach(function (c) {
      tags.push({ text: tr(catKey(c)), remove: function () { state.categories = []; state.page = 1; setFilterControls(); render(); } });
    });
    state.occasions.forEach(function (o) { tags.push({ text: o, remove: function () { state.occasions = []; state.page = 1; setFilterControls(); render(); } }); });
    state.sizes.forEach(function (s) { tags.push({ text: s, remove: function () { state.sizes = []; state.page = 1; setFilterControls(); render(); } }); });

    activeFiltersEl.textContent = '';
    if (!tags.length) {
      var tag = document.createElement('span');
      tag.className = 'filter-tag';
      tag.textContent = tr('allProducts') + ' ';
      activeFiltersEl.appendChild(tag);
      return;
    }
    tags.forEach(function (item) {
      var t = document.createElement('span');
      t.className = 'filter-tag';
      t.textContent = item.text + ' ';
      var rm = document.createElement('button');
      rm.className = 'filter-tag-remove';
      rm.setAttribute('aria-label', 'Remove');
      rm.textContent = '\u00d7';
      rm.addEventListener('click', item.remove);
      t.appendChild(rm);
      activeFiltersEl.appendChild(t);
    });
  }

  /* ---- Filter controls ---- */

  function toggleIn(arr, value) {
    var idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
  }

  function setFilterControls() {
    document.querySelectorAll('.filter-option').forEach(function (opt) {
      var val = opt.getAttribute('data-value') || '';
      var group = opt.getAttribute('data-group');
      var active = false;
      if (group === 'category') {
        // "All Products" (empty value) is active when no category is selected.
        active = val === '' ? state.categories.length === 0 : state.categories.indexOf(val) >= 0;
      }
      if (group === 'size') active = state.sizes.indexOf(val) >= 0;
      if (group === 'occasion') active = state.occasions.indexOf(val) >= 0;
      opt.classList.toggle('active', active);
      opt.setAttribute('role','checkbox');opt.setAttribute('tabindex','0');opt.setAttribute('aria-checked',active?'true':'false');
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function wireFilters() {
    document.querySelectorAll('.filter-title').forEach(function (title) {
      title.setAttribute('role','button');title.setAttribute('tabindex','0');title.setAttribute('aria-expanded','true');
      title.addEventListener('click', function () {
        this.classList.toggle('collapsed');
        var options = this.nextElementSibling;
        if (options) options.style.display = options.style.display === 'none' ? '' : 'none';
        this.setAttribute('aria-expanded',options&&options.style.display==='none'?'false':'true');
      });
    });
    document.addEventListener('keydown',function(event){
      var control=event.target.closest&&event.target.closest('.filter-option[data-group],.filter-title');
      if(control&&(event.key==='Enter'||event.key===' ')){event.preventDefault();control.click();}
    });

    document.addEventListener('click', function (e) {
      var opt = e.target.closest ? e.target.closest('.filter-option[data-group]') : null;
      if (opt) {
        if(opt.hidden||(opt.closest('[data-filter-group]')&&opt.closest('[data-filter-group]').hidden))return;
        var group = opt.getAttribute('data-group');
        var val = opt.getAttribute('data-value') || '';
        if (group === 'category' && val === '') {
          state.categories = [];
          opt.classList.add('active');
        } else if (group === 'category') {
          toggleIn(state.categories, val);
        } else if (group === 'size') { toggleIn(state.sizes, val); }
        else if (group === 'occasion') { toggleIn(state.occasions, val); }
        state.page = 1;
        setFilterControls();
        render();
        return;
      }
    });

    var inputs = document.querySelectorAll('.price-input');
    var debounced = debounce(function () {
      var min = parseInt(inputs[0].value, 10);
      var max = parseInt(inputs[1].value, 10);
      state.minCents = isNaN(min) ? null : min * 100;
      state.maxCents = isNaN(max) ? null : max * 100;
      state.page = 1;
      render();
    }, 400);
    inputs.forEach(function (input) { input.addEventListener('input', debounced); });

    var filterToggle = document.getElementById('filterToggle');
    var shopSidebar = document.getElementById('shopSidebar');
    if (filterToggle && shopSidebar) {
      filterToggle.addEventListener('click', function () {
        shopSidebar.classList.toggle('active');
      });
    }

    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        state.sort = this.value;
        state.page = 1;
        render();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        state.page += 1;
        render();
        if (state.source !== 'api' && (state.page * PAGE_SIZE) >= state.items.length) {
          loadMoreBtn.style.display = 'none';
        }
      });
    }

    document.addEventListener('langchange', function () {
      buildFilterOptions();
      render();
    });
  }

  /* ---- Init ---- */

  function init(force) {
    state.ready = false;
    HN.loading(grid, 'card', PAGE_SIZE);
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    loadItems(force);
    render();
  }

  wireFilters();
  if(document.getElementById('sortSelect'))document.getElementById('sortSelect').value=state.sort;
  init();
})();
