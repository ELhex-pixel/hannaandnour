const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const media = require('../public/js/product-media');

const beige='images/beige.jpg', vin='images/vin.jpg', general='images/detail.jpg';
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
