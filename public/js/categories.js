/* Canonical clothing categories shared by admin, storefront and server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_CATEGORIES = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var groups = [
    { id: 'outfits', label: 'Ensembles et pièces complètes' },
    { id: 'tops', label: 'Hauts' },
    { id: 'outerwear', label: 'Vestes et manteaux' },
    { id: 'bottoms', label: 'Bas' },
    { id: 'collections', label: 'Accessoires et autres collections' }
  ];
  var definitions = [
    ['set','catSets','Ensembles','outfits'],['dress','catDresses','Robes','outfits'],['jumpsuit','catJumpsuits','Combinaisons','outfits'],['tracksuit','catTracksuits','Survêtements','outfits'],
    ['top','catTops','Hauts','tops'],['tshirt','catTshirts','T-shirts','tops'],['shirt','catShirts','Chemises','tops'],['blouse','catBlouses','Blouses et tuniques','tops'],['knitwear','catKnitwear','Pulls et maille','tops'],['cardigan','catCardigans','Gilets et cardigans','tops'],['sweatshirt','catSweatshirts','Sweats','tops'],['hoodie','catHoodies','Sweats à capuche','tops'],
    ['jacket','catJackets','Vestes et blazers','outerwear'],['coat','catCoats','Manteaux','outerwear'],['cape','catCapes','Capes et ponchos','outerwear'],['vest','catVests','Vestes sans manches','outerwear'],
    ['trousers','catTrousers','Pantalons','bottoms'],['jeans','catJeans','Jeans','bottoms'],['skirt','catSkirts','Jupes','bottoms'],['shorts','catShorts','Shorts et bermudas','bottoms'],
    ['accessory','catAccessories','Accessoires','collections'],['hijab','catHijabs','Hijabs','collections'],['abaya','catAbayas','Abayas','collections'],['prayer','catPrayerWear','Tenues de prière','collections']
  ].map(function (entry) { return { code: entry[0], key: entry[1], label: entry[2], group: entry[3] }; });
  var lookup = Object.create(null);
  definitions.forEach(function (entry) { lookup[entry.code] = entry; });
  return {
    groups: groups, definitions: definitions, codes: definitions.map(function (entry) { return entry.code; }),
    has: function (code) { return typeof code === 'string' && Object.prototype.hasOwnProperty.call(lookup, code); },
    key: function (code) { return lookup[code] ? lookup[code].key : 'allProducts'; },
    label: function (code) { return lookup[code] ? lookup[code].label : String(code || ''); }
  };
});
