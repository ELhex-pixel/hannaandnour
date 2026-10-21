const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cheerio=require('cheerio');
const landing=require('../public/js/product-landing'),media=require('../public/js/product-media'),dict=require('../public/js/i18n');
const vm=require('node:vm');
const {renderContent}=require('../scripts/seo'),{prepareLivePage}=require('../scripts/build');
const base='https://rqgoawbzbgzuvpxnzxsu.supabase.co/storage/v1/object/public/product-images/';
const product={slug:'ensemble-col-rond-pantalon-large',name_fr:'Ensemble test',name_en:'Test outfit',name_ar:'طقم تجريبي',description_fr:'Description <script>privée</script>',description_en:'Description',description_ar:'وصف',fit_fr:'Du 36 au 46',fit_en:'EU 36–46',fit_ar:'من 36 إلى 46',features_fr:['Col rond','Pantalon large'],features_en:['Round neck','Wide leg'],features_ar:['ياقة دائرية','بنطال واسع'],image:base+'gray-1.webp',gallery:[{src:base+'gray-1.webp',color:'Gris clair'},{src:base+'gray-2.webp',color:'Gris clair'},{src:base+'black-1.webp',color:'Noir'},{src:base+'black-2.webp',color:'Noir'}],variants:[{color:'Gris clair',active:true,stock:0},{color:'Noir',active:true,stock:5}]};
function t(lang){return(key,params)=>{let value=dict[lang][key]||key;for(const[name,replacement]of Object.entries(params||{}))value=value.replace('{'+name+'}',replacement);return value;};}
test('la page éditoriale suit les photos du coloris et les faits admin, sans composition/mesure/avis/prix inventés',()=>{
  for(const lang of ['fr','en','ar']){
    const html=landing.editorialHTML(product,lang,'Noir',{return_policy:{days:14}},t(lang),(src,width)=>media.delivery(src,width,true)),doc=cheerio.load(html);
    assert.equal(doc('script,[onerror]').length,0);assert.equal(doc('.landing-look-photo img').length,1);assert.equal(new URL(doc('.landing-look-photo img').attr('src'),'https://example.test').searchParams.get('url'),base+'black-2.webp');assert(!html.includes('gray-2.webp'));
    assert.equal(doc('.landing-facts li').length,2);assert(doc('.landing-look-copy').text().includes(product['fit_'+lang]));assert.equal(doc('details').length,3);assert.match(doc('details').last().text(),/14/);assert.equal(doc('details a').attr('href'),'/'+lang+'/terms.html');assert.equal(doc('[data-landing-target]').length,2);
    assert.equal(doc('.landing-look-photo img').attr('loading'),'lazy');assert.match(doc('.landing-look-photo img').attr('srcset'),/480w.*960w/);
    assert.doesNotMatch(doc.text(),/100%|70%|★★★★★|cm|€|\$/);assert(doc('.landing-look-copy').text().includes(product['description_'+lang]));
  }
  const noInfo={...product,features_fr:[],features_en:[],features_ar:[],fit_fr:'',fit_en:'',fit_ar:''};const html=landing.editorialHTML(noInfo,'fr','Gris clair',null,t('fr'),src=>src);assert(!html.includes('36'));assert(!html.includes('14 jours'));
  assert.equal(landing.editorialHTML({...product,slug:'autre-modele'},'fr','',null,t('fr'),src=>src),'');
});
test('les états des coloris distinguent disponible, épuisé et inconnu sans sélectionner une variante ou additionner du stock fictif',()=>{
  assert.equal(landing.availability(product,'Noir'),'in');assert.equal(landing.availability(product,'Gris clair'),'out');
  for(const stock of [null,-1,'5',NaN])assert.equal(landing.availability({...product,variants:[{active:true,color:'Noir',stock}]},'Noir'),'unknown');
  assert.equal(landing.availability({...product,variants:[{active:false,color:'Noir',stock:10}]},'Noir'),'out');assert.equal(landing.availability({...product,variants:[]},'Noir'),'unknown');assert.equal(product.variants[1].stock,5);
});
test('le pré-rendu cible uniquement cette fiche, conserve les contrôles et ne publie ni prix ni quantité figés',()=>{
  for(const lang of ['fr','en','ar'])for(const slug of [product.slug,'autre-modele']){
    const doc=cheerio.load(fs.readFileSync('public/product.html','utf8'));prepareLivePage(doc,'product.html');
    const url=renderContent(doc,'https://example.test','product',{...product,slug},lang);
    assert.equal(doc('body').hasClass('product-landing'),slug===product.slug);assert.equal(doc('#addToCartBtn').is('[disabled]'),true);assert.equal(doc('#buyNowBtn').length,1);assert.equal(doc('.product-price').text(),'');assert.equal(doc('link[rel=canonical]').attr('href'),url);assert.equal(doc('#productLandingEditorial').is('[hidden]'),true);assert.equal(doc('script[src="js/product.js"]').length,1);
    if(slug===product.slug){assert.equal(doc('#landingOptions').length,1);assert.equal(doc('#productLandingEditorial details').length,3);}
  }
});
test('le bouton éditorial vise les vrais coloris avant le favori et ne déclenche aucune action d’achat',()=>{
  const events={},state={focus:'',scrolls:0};
  const color={focus(){state.focus='color';}},wishlist={focus(){state.focus='wishlist';}};
  const options={scrollIntoView(){state.scrolls++;},querySelector(selector){return selector==='.color-option'?color:wishlist;}};
  const button={getAttribute:()=> 'landingOptions',closest:selector=>selector==='[data-landing-target]'?button:null};
  const document={body:{classList:{contains:()=>true}},getElementById:()=>options,addEventListener:(name,fn)=>events[name]=fn};
  const window={document,HN_MEDIA:media,HN_COLORS:require('../public/js/colors'),matchMedia:()=>({matches:true}),addEventListener(){}};
  vm.runInNewContext(fs.readFileSync('public/js/product-landing.js','utf8'),{window});events.click({target:button});
  assert.equal(state.focus,'color');assert.equal(state.scrolls,1);
});
