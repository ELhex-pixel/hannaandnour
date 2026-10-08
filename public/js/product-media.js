(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HN_MEDIA = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function norm(value) { return String(value == null ? '' : value).trim().normalize('NFKC').toLowerCase(); }
  function validUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 2000 || /[\x00-\x1f\x7f\\]/.test(value)) return false;
    if (/^\/?images\//.test(value)) return value.split('/').indexOf('..') < 0;
    try { var url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password; } catch (e) { return false; }
  }
  function entries(product) {
    var list = [], gallery = Array.isArray(product.gallery) ? product.gallery : [];
    gallery.forEach(function (value) {
      var src = typeof value === 'string' ? value : value && value.src;
      if (!validUrl(src) || list.some(function (item) { return item.src === src; })) return;
      list.push({ src: src, color: typeof value === 'object' && typeof value.color === 'string' ? value.color.trim() : '' });
    });
    if (validUrl(product.image) && !list.some(function (item) { return item.src === product.image; })) list.unshift({ src: product.image, color: '' });
    return list;
  }
  function select(product, color) {
    var list = entries(product), selected = norm(color);
    var matches = selected ? list.filter(function (item) { return norm(item.color) === selected; }) : [];
    var general = list.filter(function (item) { return !item.color; });
    var visible = matches.length ? matches.concat(general) : general;
    if (!selected) visible = list;
    var preferred = visible.filter(function (item) { return item.src === product.image && (!matches.length || norm(item.color) === selected); })[0];
    if (preferred) visible = [preferred].concat(visible.filter(function (item) { return item !== preferred; }));
    return { images: visible.map(function (item) { return item.src; }), matched: matches.length > 0, color: color || '' };
  }
  function clean(gallery, colors, image) {
    if (!Array.isArray(gallery) || gallery.length > 100) throw new Error('La galerie doit contenir au maximum 100 photos.');
    var list = [], names = Array.isArray(colors) ? colors : [];
    gallery.forEach(function (value) {
      var src = typeof value === 'string' ? value.trim() : value && typeof value.src === 'string' ? value.src.trim() : '';
      var color = typeof value === 'object' && value && value.color !== undefined ? value.color : '';
      if (!validUrl(src) || typeof color !== 'string' || color.length > 80) throw new Error('Photo ou coloris invalide.');
      color = color.trim();
      if (color) {
        var canonical = names.filter(function (name) { return norm(name) === norm(color); })[0];
        if (!canonical) throw new Error('Le coloris d’une photo doit figurer dans les coloris de la fiche.');
        color = canonical;
      }
      if (list.some(function (item) { return (typeof item === 'string' ? item : item.src) === src; })) throw new Error('Une photo figure plusieurs fois dans la galerie.');
      list.push(color ? { src: src, color: color } : src);
    });
    if (!validUrl(image)) throw new Error('URL de l’image principale invalide.');
    if (!list.some(function (item) { return (typeof item === 'string' ? item : item.src) === image; })) list.unshift(image);
    if (list.length > 100) throw new Error('La galerie doit contenir au maximum 100 photos, principale comprise.');
    return list;
  }
  return { norm: norm, entries: entries, select: select, clean: clean, validUrl: validUrl };
});
