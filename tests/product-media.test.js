const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const media = require('../public/js/product-media');

const beige='images/beige.jpg', vin='images/vin.jpg', general='images/detail.jpg';
const publicPhoto='https://rqgoawbzbgzuvpxnzxsu.supabase.co/storage/v1/object/public/product-images/photo%20beige.png';
test('la livraison légère conserve la source exacte, les proportions et trois largeurs bornées sans modifier la galerie', () => {
  for(const width of [160,480,960]) {
    const url=new URL(media.delivery(publicPhoto,width,true),'https://hannanour.com');
    assert.equal(url.pathname,'/.netlify/images');assert.equal(url.searchParams.get('url'),publicPhoto);
    assert.equal(url.searchParams.get('w'),String(width));assert.equal(url.searchParams.get('fit'),'contain');
    assert.equal(url.searchParams.get('fm'),'webp');assert.equal(url.searchParams.get('q'),'82');
    assert.equal(url.searchParams.has('h'),false);
  }
  assert.equal(new URL(media.delivery(publicPhoto,200000,true),'https://hannanour.com').searchParams.get('w'),'960');
  const p={image:publicPhoto,gallery:[{src:publicPhoto,color:'Beige'}]};const original=JSON.stringify(p);
  media.select(p,'Beige').images.map(src=>media.delivery(src,480,true));assert.equal(JSON.stringify(p),original);
});
test('le CDN ne reçoit que les photos publiques de la boutique, jamais une URL privée, signée, étrangère ou de développement', () => {
  assert.equal(media.delivery(publicPhoto,480,false),publicPhoto);
  for(const src of [beige,'http://127.0.0.1/photo.png','https://example.test/a.png',publicPhoto+'?token=private',publicPhoto+'#private',publicPhoto.replace('/public/','/sign/'),publicPhoto.replace('/product-images/','/private-returns/'),publicPhoto.replace('https://','http://'),publicPhoto.replace('https://','https://user:pass@')])assert.equal(media.delivery(src,480,true),src);
  const toml=fs.readFileSync('netlify.toml','utf8');const match=toml.match(/remote_images = \["([^"]+)"\]/);assert(match);
  const allow=new RegExp(match[1]);assert(allow.test(publicPhoto));assert(!allow.test(publicPhoto+'?token=private'));assert(!allow.test(publicPhoto.replace('supabase.co','supabase.co.evil.test')));
});
function sizeGuide(lang='fr') {
  const nodes={},state={lang};
  const node=id=>nodes[id]||(nodes[id]={textContent:'',innerHTML:'',style:{},hidden:false,attributes:{'data-i18n':'sgUnspecified'},removeAttribute(name){delete this.attributes[name];}});
  const dict=require('../public/js/i18n');
  const context={HN:{lang:()=>state.lang},document:{getElementById:node},tr:key=>dict[state.lang][key],productVariants:p=>p.variants||p.product_variants||[],lower:value=>String(value||'').toLowerCase().trim()};
  const source=fs.readFileSync('public/js/product.js','utf8');vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function localized('),source.indexOf('  function listLocalized('))+source.slice(source.indexOf('  function renderSizeGuide('),source.indexOf('  /* ---- Variants & stock ---- */')),context);
  return {nodes,state,render:context.renderSizeGuide};
}
test('le guide n’invente ni mesures de One Size/XL ni usage conseillé quand les champs sont vides', () => {
  const mock=sizeGuide();mock.render({sizes:['One Size','XL']});
  assert.equal(mock.nodes.sizeGuideBody.textContent,'Taille unique, XL');
  assert.equal(mock.nodes.sizeGuideMeasurements.hidden,true);
  assert.equal(mock.nodes.sizeGuideMeasurementsText.textContent,'');
  assert(!fs.readFileSync('public/js/product.js','utf8').includes('SIZE_DIMS'));
});
test('la plage conseillée se modifie indépendamment du stock et les mesures facultatives se masquent après retrait', () => {
  const mock=sizeGuide(),product={sizes:['One Size'],variants:[{size:'One Size',stock:18,active:true}],fit_fr:'Du 36 au 46',measurements_fr:''};
  mock.render(product);assert.equal(mock.nodes.sizeGuideBody.textContent,'Du 36 au 46');
  assert.equal(mock.nodes.sizeGuideMeasurements.hidden,true);
  product.fit_fr='Du 38 au 50';product.measurements_fr='Longueur mesurée : 125 cm';mock.render(product);
  assert.equal(mock.nodes.sizeGuideBody.textContent,'Du 38 au 50');
  assert.equal(mock.nodes.sizeGuideMeasurements.hidden,false);assert.equal(mock.nodes.sizeGuideMeasurementsText.textContent,product.measurements_fr);
  product.measurements_fr='';mock.render(product);assert.equal(mock.nodes.sizeGuideMeasurements.hidden,true);
  assert.deepEqual(product.sizes,['One Size']);assert.equal(product.variants[0].stock,18);
});
test('le guide FR/EN/AR respecte les textes enregistrés, les variantes réelles et refuse tout HTML actif', () => {
  const mock=sizeGuide(),product={fit_fr:'Du 36 au 46',fit_en:'From 36 to 46',fit_ar:'من 36 إلى 46'};
  for(const lang of ['fr','en','ar']) {mock.state.lang=lang;mock.render(product);assert.equal(mock.nodes.sizeGuideBody.textContent,product['fit_'+lang]);}
  mock.render({fit_fr:'Du 36 au 46'});assert.equal(mock.nodes.sizeGuideBody.textContent,'Du 36 au 46');
  mock.render({fit_ar:'<img src=x onerror=alert(1)>',measurements_ar:'<script>alert(1)</script>'});
  assert.equal(mock.nodes.sizeGuideBody.textContent,'<img src=x onerror=alert(1)>');assert.equal(mock.nodes.sizeGuideBody.innerHTML,'');
  assert.equal(mock.nodes.sizeGuideMeasurementsText.innerHTML,'');
  mock.render({variants:[{size:'M',active:true},{size:'L',active:false},{size:'M',active:true},{size:'',active:true}]});assert.equal(mock.nodes.sizeGuideBody.textContent,'M');
  mock.render({sizes:[],variants:[]});assert.equal(mock.nodes.sizeGuideBody.textContent,require('../public/js/i18n').ar.sgUnspecified);
  assert.equal(mock.nodes.sizeGuideBody.attributes['data-i18n'],undefined);
});
test('les anciennes galeries et la photo principale seule restent lisibles sans inventer de coloris', () => {
  assert.deepEqual(media.entries({ image:beige,gallery:[] }),[{src:beige,color:''}]);
  assert.deepEqual(media.select({image:beige,gallery:[general,beige]},'Vin'),{images:[beige,general],matched:false,color:'Vin'});
  assert.deepEqual(media.clean([general],['Vin'],beige),[beige,general]);
});
test('le coloris sélectionne ses vraies photos puis les vues générales, jamais un autre coloris', () => {
  const product={image:beige,gallery:[{src:beige,color:'Beige'},general,{src:vin,color:'Vin'}]};
  assert.deepEqual(media.select(product,' vin '),{images:[vin,general],matched:true,color:' vin '});
  assert.deepEqual(media.select(product,'Beige').images,[beige,general]);
  assert.deepEqual(media.select(product,'Noir'),{images:[general],matched:false,color:'Noir'});
  assert.deepEqual(media.select({image:beige,gallery:[{src:beige,color:'Beige'}]},'Vin').images,[]);
});
test('la validation des photos conserve les associations et refuse coloris inconnu, doublons, URL dangereuse et galerie excessive', () => {
  assert.deepEqual(media.clean([{src:vin,color:'vin'},beige],['Vin','Beige'],beige),[{src:vin,color:'Vin'},beige]);
  for (const gallery of [[{src:vin,color:'Inconnu'}],[{src:vin,color:{}}],[vin,vin],['javascript:alert(1)'],['data:image/png;base64,eA=='],['https://user:pass@example.test/a.jpg'],['images/../../secret'],Array(101).fill(vin),{src:vin}]) assert.throws(()=>media.clean(gallery,['Vin'],beige));
  assert.throws(()=>media.clean([vin],['Vin'],'invalid'));
});
test('l’ordre de galerie et le choix principal sont respectés par coloris sans recoloration artificielle', () => {
  const p={image:vin,gallery:[{src:'images/vin-back.jpg',color:'Vin'},{src:vin,color:'Vin'},beige]};
  assert.deepEqual(media.select(p,'Vin').images,[vin,'images/vin-back.jpg',beige]);
  assert(!fs.readFileSync('public/js/product.js','utf8').includes('hue-rotate'));
});
test('la galerie JSON transmise au serveur ne contient ni objets arbitraires ni coloris inventés', () => {
  const body=JSON.parse(JSON.stringify({image:beige,colors:['Beige','Vin'],gallery:[{src:vin,color:'Vin'},beige]}));
  assert.deepEqual(JSON.parse(JSON.stringify(media.clean(body.gallery,body.colors,body.image))),body.gallery);
  assert.deepEqual(media.entries({image:beige,gallery:[null,42,{src:'javascript:alert(1)'},{src:vin,color:'Vin'},vin]}),[{src:beige,color:''},{src:vin,color:'Vin'}]);
});

function galleryEditor() {
  const values={'f-image':beige,'f-gallery':beige+'\n'+vin,'f-colors':'Beige, Vin'},nodes={};
  const node=id=>nodes[id]||(nodes[id]={value:'',innerHTML:'',textContent:''});
  const context={window:{HN_MEDIA:media},document:{getElementById:node},galleryColors:Object.create(null),getVal:id=>values[id]||'',setVal:(id,value)=>{values[id]=value;},pickerColors:()=>values['f-colors'].split(',').map(s=>s.trim()),esc:s=>String(s).replace(/"/g,'&quot;')};
  const source=fs.readFileSync('public/js/admin.js','utf8');
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function galleryLines()'),source.indexOf('  function openVariantInventory(')),context);
  return {context,values,nodes,node};
}
test('l’admin conserve l’association par URL lors du déplacement, retrait et sauvegarde de galerie', () => {
  const mock=galleryEditor();mock.context.galleryColors[vin]='Vin';mock.node('galleryPreviewColor').value='Vin';
  mock.context.renderGalleryGrid();
  assert.match(mock.nodes.galleryGrid.innerHTML,/class="g-color"/);
  assert.match(mock.nodes.galleryColorPreview.innerHTML,/vin.jpg/);
  mock.context.moveGallery(1,-1);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.context.galleryPayload())),[{src:vin,color:'Vin'},beige]);
  mock.context.deleteGallery(1);
  assert.equal(mock.values['f-image'],vin);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.context.galleryPayload())),[{src:vin,color:'Vin'}]);
  mock.context.galleryColors[vin]='Noir';
  assert.throws(()=>media.clean(mock.context.galleryPayload(),['Vin','Beige'],vin));
});
