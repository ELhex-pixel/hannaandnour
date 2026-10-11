const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const media = require('../public/js/product-media');
const source = fs.readFileSync('public/js/main.js','utf8');
const start = source.indexOf('  window.switchImage = function(el)');
const gallery = source.slice(start,source.indexOf('  /* ==============================================',start));
const photo = 'https://rqgoawbzbgzuvpxnzxsu.supabase.co/storage/v1/object/public/product-images/detail.webp';
function setup(full = media.delivery(photo,960,true)) {
  const main = { src: 'old-photo.webp', style: {}, attributes: { srcset: 'tiny.webp 160w', sizes: '160px' }, removeAttribute(key) { delete this.attributes[key]; } };
  const state = { active: false, previous: true };
  const wrapper = { tagName:'DIV', getAttribute:key=>key==='data-img'?full:null, closest:()=>wrapper, classList:{add(){state.active=true;},remove(){state.active=false;}}, querySelector:()=>img };
  const img = { tagName:'IMG', src:media.delivery(photo,160,true), style:{}, closest:()=>wrapper };
  const window = {};
  vm.runInNewContext(gallery,{window,document:{getElementById:()=>main,querySelectorAll:()=>[{classList:{remove(){state.previous=false;}}},wrapper]}});
  return { main,img,wrapper,state,switch:window.switchImage };
}
test('cliquer la miniature ou son image affiche la version 960px, jamais la miniature agrandie',()=>{
  for(const element of ['img','wrapper']) {
    const mock=setup();mock.switch(mock[element]);
    assert.equal(new URL(mock.main.src,'https://example.test').searchParams.get('w'),'960');
    assert.notEqual(mock.main.src,mock.img.src);
    assert.equal(mock.main.attributes.srcset,undefined);assert.equal(mock.main.attributes.sizes,undefined);
    assert.equal(mock.state.active,true);assert.equal(mock.state.previous,false);
  }
});
test('la galerie statique conserve ses photos originales et une vignette invalide ne casse pas la page',()=>{
  const mock=setup(null);mock.img.src='images/hero.jpg';mock.switch(mock.wrapper);assert.equal(mock.main.src,'images/hero.jpg');
  mock.wrapper.querySelector=()=>null;assert.doesNotThrow(()=>mock.switch(mock.wrapper));assert.equal(mock.main.src,'images/hero.jpg');
});
