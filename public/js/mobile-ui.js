(function () {
  'use strict';
  var HN=window.HN;
  if (!HN || !document.getElementById('header') || document.body.classList.contains('admin-page')) return;
  var mobile=window.matchMedia('(max-width: 767.98px)'), reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  var nav, badge, productBar, productButton, productPrice, frame=null, sheet, sidebar=document.getElementById('shopSidebar'), filterToggle=document.getElementById('filterToggle'), sheetClose, sheetDone, anchor;
  var icons={home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',shop:'<path d="M4 9h16v12H4Z"/><path d="m3 9 2-6h14l2 6"/><path d="M9 21v-7h6v7"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',cart:'<path d="M5 7h14l2 14H3Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',account:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'};
  function tr(key){return HN.tr(key);}
  function node(tag,parent,text){var n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(parent)parent.appendChild(n);return n;}
  function activePage(){var path=window.location.pathname.replace(/^\/(fr|en|ar)(?=\/)/,'').replace(/\.html\/?$/,'');return /^\/products\//.test(path)||path==='/product'?'shop':path==='/'||path==='/index'?'home':path==='/shop'||path==='/collections'?'shop':path==='/cart'||path==='/checkout'?'cart':path==='/account'?'account':'';}
  function updateNav(){
    if(!nav)return;
    var keys={home:'navHome',shop:'navShop',search:'menuSearch',cart:'crumbCart',account:'crumbAccount'};
    nav.setAttribute('aria-label',tr('mobileNavigation'));
    nav.querySelectorAll('[data-mobile-page]').forEach(function(item){var page=item.getAttribute('data-mobile-page');item.querySelector('.mobile-nav-label').textContent=tr(keys[page]);if(page===activePage())item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});
    var count=HN.cart.count();badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;
  }
  function buildNav(){
    nav=node('nav',document.body);nav.id='mobileBottomNav';nav.className='mobile-bottom-nav';
    [['home','index.html'],['shop','shop.html'],['search',null],['cart','cart.html'],['account','account.html']].forEach(function(entry){
      var item=node(entry[1]?'a':'button',nav);item.setAttribute('data-mobile-page',entry[0]);
      if(entry[1])item.href=HN.pageUrl(entry[1]);else{item.type='button';item.setAttribute('data-search-open','');}
      item.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[entry[0]]+'</svg>';
      node('span',item).className='mobile-nav-label';
      if(entry[0]==='cart'){badge=node('span',item);badge.className='mobile-nav-count';badge.setAttribute('aria-hidden','true');}
    });updateNav();
  }
  function buildProductBar(){
    var source=document.getElementById('addToCartBtn'),info=document.querySelector('.product-info');
    if(!source||!info)return;
    productBar=node('div',document.body);productBar.id='mobileProductBar';productBar.className='mobile-product-bar';productBar.hidden=true;
    productPrice=node('span',productBar);productPrice.className='mobile-product-price';
    productButton=node('button',productBar);productButton.type='button';productButton.className='btn btn-primary';
    productButton.addEventListener('click',function(){
      var options=document.querySelector('.product-info .product-option-group')||document.querySelector('.product-actions');
      if(!options)return;options.scrollIntoView({block:'center',behavior:reduced.matches?'auto':'smooth'});
      var target=info.querySelector('.color-option[tabindex],.size-option:not([disabled]),#quantity')||source;target.focus({preventScroll:true});
    });
    if('IntersectionObserver' in window){new IntersectionObserver(function(entries){document.body.classList.toggle('mobile-actions-visible',entries[0].isIntersecting);queueProduct();},{threshold:0.25}).observe(document.querySelector('.product-actions'));}
    if('MutationObserver' in window)new MutationObserver(queueProduct).observe(info,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','class']});
  }
  function queueProduct(){if(frame!==null)return;frame=requestAnimationFrame(function(){frame=null;updateProduct();});}
  function updateProduct(){
    if(!productBar)return;
    var info=document.querySelector('.product-info'),amount=document.querySelector('.product-price-current'),content=info.closest('[data-product-content]');
    var ready=amount&&amount.textContent&&(!content||!content.hidden);
    productPrice.textContent=ready?amount.textContent:'';productButton.textContent=tr('mobileChooseOptions');productButton.disabled=!ready;
    productBar.hidden=!mobile.matches||!ready||document.body.classList.contains('mobile-actions-visible');
    document.body.classList.toggle('mobile-product-access',!productBar.hidden);
  }
  function buildFilters(){
    if(!sidebar||!filterToggle)return;
    anchor=document.createComment('shop-filter-location');sidebar.parentNode.insertBefore(anchor,sidebar);
    sheet=node('dialog',document.body);sheet.className='mobile-filter-sheet';sheet.id='mobileFilterSheet';sheet.setAttribute('aria-labelledby','mobileFilterTitle');
    if(typeof sheet.showModal!=='function'){sheet.remove();sheet=null;return;}
    var head=node('div',sheet);head.className='mobile-sheet-header';node('h2',head,tr('filtersBtn')).id='mobileFilterTitle';
    sheetClose=node('button',head,'×');sheetClose.type='button';sheetClose.className='mobile-sheet-close';sheetClose.setAttribute('aria-label',tr('mobileClose'));
    sheetDone=node('button',sheet,tr('mobileSeeProducts'));sheetDone.type='button';sheetDone.className='btn btn-primary mobile-sheet-done';
    var filterOverflow='',filterOpen=false;
    function release(){if(filterOpen){document.body.style.overflow=filterOverflow;filterOpen=false;}filterToggle.setAttribute('aria-expanded','false');}
    function close(){release();if(sheet.open)sheet.close();filterToggle.focus();}
    sheet.addEventListener('close',release);
    sheetClose.addEventListener('click',close);sheetDone.addEventListener('click',close);sheet.addEventListener('cancel',function(event){event.preventDefault();close();});
    filterToggle.addEventListener('click',function(event){
      if(!mobile.matches||typeof sheet.showModal!=='function')return;
      event.preventDefault();event.stopImmediatePropagation();if(sheet.open)return;sidebar.classList.add('active');filterToggle.setAttribute('aria-expanded','true');filterOverflow=document.body.style.overflow;filterOpen=true;document.body.style.overflow='hidden';sheet.showModal();sheetClose.focus();
    },true);
    filterToggle.setAttribute('aria-expanded','false');
  }
  function keyboard(){
    if(!window.visualViewport)return;
    var editing=document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    document.body.classList.toggle('mobile-keyboard-open',!!editing&&window.innerHeight-window.visualViewport.height>140);
  }
  function layout(){
    if(!nav&&mobile.matches)buildNav();
    if(nav)nav.hidden=!mobile.matches;
    document.body.toggleAttribute('data-mobile-nav',mobile.matches&&!!nav);
    if(sheet){
      if(mobile.matches){if(sidebar.parentNode!==sheet)sheet.insertBefore(sidebar,sheetDone);filterToggle.setAttribute('aria-controls','mobileFilterSheet');}
      else{if(sheet.open)sheet.close();sidebar.classList.remove('active');anchor.parentNode.insertBefore(sidebar,anchor.nextSibling);filterToggle.setAttribute('aria-controls','shopSidebar');filterToggle.setAttribute('aria-expanded','false');}
    }
    updateProduct();keyboard();
  }
  function translate(){updateNav();if(sheet){document.getElementById('mobileFilterTitle').textContent=tr('filtersBtn');sheetClose.setAttribute('aria-label',tr('mobileClose'));sheetDone.textContent=tr('mobileSeeProducts');}updateProduct();}
  buildProductBar();buildFilters();layout();
  if(mobile.addEventListener)mobile.addEventListener('change',layout);else mobile.addListener(layout);
  document.addEventListener('hn:cart',updateNav);document.addEventListener('langchange',translate);
  if(window.visualViewport)window.visualViewport.addEventListener('resize',keyboard);
  document.addEventListener('focusin',keyboard);document.addEventListener('focusout',function(){setTimeout(keyboard,0);});
})();
