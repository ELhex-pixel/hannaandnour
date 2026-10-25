(function () {
  'use strict';
  var country=null,manual=false,revision=0,choiceKey='hn-shipping-choice',geoKey='hn-shipping-country-geo';
  function valid(value){return typeof value==='string'&&/^[A-Z]{2}$/i.test(value)?value.toUpperCase():null;}
  function read(key){try{return window.sessionStorage.getItem(key);}catch(e){return null;}}
  function write(key,value){try{window.sessionStorage.setItem(key,value);}catch(e){}}
  function notify(){try{document.dispatchEvent(new CustomEvent('hn:shipping-country',{detail:{country:country,source:manual?'manual':'geo'}}));}catch(e){}}
  function choose(value){
    country=valid(value);manual=true;revision++;
    var previous;try{previous=JSON.parse(read(choiceKey)||'null');}catch(e){}
    var method=previous&&typeof previous.method==='string'?previous.method:'standard';
    write(choiceKey,JSON.stringify({country:country||'',method:method,source:'manual'}));notify();
  }
  try{var choice=JSON.parse(read(choiceKey)||'null');if(choice&&Object.prototype.hasOwnProperty.call(choice,'country')){country=valid(choice.country);manual=true;}}catch(e){}
  if(!manual)country=valid(read(geoKey));
  var settled=manual||!!country,ready=Promise.resolve(country);
  if(!manual&&!country&&window.location&&/^https?:$/.test(window.location.protocol)){
    var controller=new AbortController(),timer,request=revision;
    ready=new Promise(function(resolve){
      timer=setTimeout(function(){controller.abort();resolve(null);},3000);
      var base=(window.HN_CONFIG&&window.HN_CONFIG.API_BASE)||'/.netlify/functions';
      fetch(base+'/shipping-country',{method:'GET',cache:'no-store',signal:controller.signal})
        .then(function(response){if(!response.ok)throw Error('Country unavailable');return response.json();})
        .then(function(data){if(request!==revision||manual){resolve(country);return;}country=valid(data&&data.country);if(country)write(geoKey,country);resolve(country);})
        .catch(function(){resolve(country);})
        .finally(function(){clearTimeout(timer);});
    });
  }
  if(!settled)ready=ready.then(function(value){settled=true;notify();return value;});
  window.HN_SHIPPING_COUNTRY={current:function(){return country;},isManual:function(){return manual;},isReady:function(){return manual||settled;},choose:choose,ready:ready};
})();
