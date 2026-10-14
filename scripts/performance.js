const { transform } = require('esbuild');

async function compactAsset(content, extension) {
  const result=await transform(content.toString(),{loader:extension==='css'?'css':'js',target:'safari15',charset:'utf8',minifyWhitespace:true,minifyIdentifiers:false,minifySyntax:false,legalComments:'none'});
  return Buffer.from(result.code);
}

function optimizePage($,file,language,images={}) {
  const storefront=$('script[src]').toArray().some(node=>/\/(?:store)(?:\.[a-f0-9]+)?\.js$/.test($(node).attr('src')||''));
  if(storefront)$('script[src]').each((_,node)=>{const script=$(node);if(!/\/(?:theme|early-data)(?:\.[a-f0-9]+)?\.js$/.test(script.attr('src')))script.attr('defer','');});
  if($('link[href*="fonts/fonts"]').length){
    if(language==='ar'){if(!$('#arabicFont').length)$('head').append('<link id="arabicFont" rel="stylesheet" href="/fonts/cairo.css">');}
    else $('head').append('<link rel="preload" href="/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2" as="font" type="font/woff2" crossorigin>');
  }
  $('img[src]').each((_,node)=>{
    const image=$(node), src=image.attr('src'), local=images[src];
    const hero=image.closest('.hero-image').length>0;
    if(!image.attr('loading'))image.attr('loading',hero?'eager':'lazy');
    if(hero)image.attr('fetchpriority','high');
    if(!local)return;
    if(!image.attr('width'))image.attr('width',local.width);
    if(!image.attr('height'))image.attr('height',local.height);
    if(!image.attr('srcset')&&local.sources.length>1){
      image.attr('srcset',local.sources.map(entry=>entry.src+' '+entry.width+'w').join(', '));
      image.attr('sizes',hero?'(max-width: 992px) 100vw, 55vw':'(max-width: 600px) calc(100vw - 32px), (max-width: 1100px) 50vw, 560px');
    }
  });
}
module.exports={compactAsset,optimizePage};
