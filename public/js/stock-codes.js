(function(){
  'use strict';
  var script=document.currentScript,src=script&&script.getAttribute('data-engine-src')||'/js/stock-codes-engine.js';
  var promise=null,revision=0;
  function load(){
    if(window.HN_STOCK_ENGINE)return Promise.resolve(window.HN_STOCK_ENGINE);
    if(promise)return promise;
    promise=new Promise(function(resolve,reject){
      var engine=document.createElement('script');engine.src=src;engine.async=true;
      var timer=setTimeout(function(){fail();},20000);
      function fail(){clearTimeout(timer);engine.onload=null;engine.onerror=null;engine.remove();promise=null;reject(new Error('Le scanner ne peut pas être chargé. Réessaie avec une connexion active.'));}
      engine.onload=function(){clearTimeout(timer);if(!window.HN_STOCK_ENGINE){fail();return;}resolve(window.HN_STOCK_ENGINE);};
      engine.onerror=fail;document.head.appendChild(engine);
    });return promise;
  }
  function stop(){revision++;if(window.HN_STOCK_ENGINE)window.HN_STOCK_ENGINE.stop();}
  function start(mode,video,found){stop();var current=revision;return load().then(function(engine){if(current!==revision)return;return engine.start(mode,video,function(value){if(current===revision)found(value);});});}
  window.HN_STOCK_CODES={start:start,stop:stop,qr:function(value){return load().then(function(engine){return engine.qr(value);});}};
})();
