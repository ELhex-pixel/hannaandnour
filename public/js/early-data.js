(function(){
  'use strict';
  var requests=Object.create(null),script=document.currentScript,page=script&&script.getAttribute('data-page');
  var base='/.netlify/functions/';
  function start(path){
    var url=new URL(base+path,location.origin).href,controller=new AbortController();
    var timer=setTimeout(function(){controller.abort();},12000);
    var promise=fetch(url,{cache:'no-store',signal:controller.signal}).then(function(response){return response.json().then(function(data){if(!response.ok)throw new Error('Lecture indisponible');return data;});}).finally(function(){clearTimeout(timer);});
    // A navigation may finish before the body scripts consume the public read.
    promise.catch(function(){});requests[url]=promise;
  }
  window.HN_EARLY_DATA={take:function(raw){var url=new URL(raw,location.href).href,promise=requests[url];if(promise)delete requests[url];return promise||null;}};
  start('config');
  if(page==='index.html'||page==='collections.html')start('products?limit=48');
  if(page==='shop.html'&&!location.search){start('products?facets=true');start('products?category=&sizes=&occasions=&sort=featured&limit=8&page=1');}
  if(page==='product.html'){
    var match=location.pathname.match(/\/products\/([a-z0-9_-]+)(?:\.html)?\/?$/),slug=match?match[1]:new URLSearchParams(location.search).get('slug');
    if(slug&&/^[a-z0-9_-]{1,120}$/.test(slug))start('products?slug='+encodeURIComponent(slug));
  }
})();
