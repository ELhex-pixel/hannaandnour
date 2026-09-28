/**
 * Shared color knowledge for Hanna & Nour (admin + site).
 * - `list`   : curated colors, used for the admin picker suggestions and for
 *              localized labels (FR/EN/AR) on the product page.
 * - `palette`: every known name/alias -> hex, so any stored color name renders
 *              with its real swatch wherever it appears.
 */
(function () {
  'use strict';

  var DEFAULT_HEX = '#A67C00';

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  var list = [
    { en: 'White',        fr: 'Blanc',          ar: 'أبيض',          hex: '#FFFFFF' },
    { en: 'Cream',        fr: 'Crème',          ar: 'كريمي',         hex: '#F1E7D3', aliases: ['creme'] },
    { en: 'Ivory',        fr: 'Ivoire',         ar: 'عاجي',          hex: '#FFFFF0' },
    { en: 'Pearl',        fr: 'Perle',          ar: 'لؤلؤي',         hex: '#F2EBE0' },
    { en: 'Beige',        fr: 'Beige',          ar: 'بيج',           hex: '#D9CCB2' },
    { en: 'Champagne',    fr: 'Champagne',      ar: 'شمبانيا',       hex: '#C9A227' },
    { en: 'Gold',         fr: 'Or',             ar: 'ذهبي',          hex: '#A67C00', aliases: ['doré', 'dore', 'golden'] },
    { en: 'Silver',       fr: 'Argent',         ar: 'فضي',           hex: '#C0C0C0' },
    { en: 'Bronze',       fr: 'Bronze',         ar: 'برونزي',        hex: '#6E5A1C' },
    { en: 'Copper',       fr: 'Cuivre',         ar: 'نحاسي',         hex: '#B87333' },
    { en: 'Black',        fr: 'Noir',           ar: 'أسود',          hex: '#1A1A1A' },
    { en: 'Gray',         fr: 'Gris',           ar: 'رمادي',         hex: '#808080', aliases: ['grey'] },
    { en: 'Charcoal',     fr: 'Anthracite',     ar: 'فحمي',          hex: '#404040' },
    { en: 'Espresso',     fr: 'Espresso',       ar: 'بني داكن',      hex: '#3B362E', aliases: ['café', 'cafe'] },
    { en: 'Brown',        fr: 'Marron',         ar: 'بني',           hex: '#6E5A1C', aliases: ['brun', 'camel'] },
    { en: 'Taupe',        fr: 'Taupe',          ar: 'رمادي بني',     hex: '#A79A8C' },
    { en: 'Sand',         fr: 'Sable',          ar: 'رملي',          hex: '#DECC9C' },
    { en: 'Nude',         fr: 'Nude',           ar: 'عاري',          hex: '#D2A58F' },
    { en: 'Bordeaux',     fr: 'Bordeaux',       ar: 'عنابي',         hex: '#7A2E2E', aliases: ['baurdeaux', 'maroon', 'winered'] },
    { en: 'Burgundy',     fr: 'Bourgogne',      ar: 'بورجندي',       hex: '#6E2542', aliases: ['burgundy'] },
    { en: 'Red',          fr: 'Rouge',          ar: 'أحمر',          hex: '#B23B3B' },
    { en: 'Terracotta',   fr: 'Terracotta',     ar: 'تراكوتا',       hex: '#B0603F' },
    { en: 'Rust',         fr: 'Rouille',        ar: 'صدئي',          hex: '#9C4E2E' },
    { en: 'Pink',         fr: 'Rose',           ar: 'وردي',          hex: '#E8A2B0', aliases: ['rose clair'] },
    { en: 'Blush',        fr: 'Rose poudré',    ar: 'وردي فاتح',     hex: '#E8B4B8', aliases: ['rose poudre'] },
    { en: 'Coral',        fr: 'Corail',         ar: 'مرجاني',        hex: '#F07A6B' },
    { en: 'Orange',       fr: 'Orange',         ar: 'برتقالي',       hex: '#C96A2B' },
    { en: 'Yellow',       fr: 'Jaune',          ar: 'أصفر',          hex: '#D9B23B', aliases: ['mustard', 'moutarde'] },
    { en: 'Olive',        fr: 'Olive',          ar: 'زيتوني',        hex: '#7A7A3D', aliases: ['olive green', 'olivegreen'] },
    { en: 'Green',        fr: 'Vert',           ar: 'أخضر',          hex: '#3D7A5C' },
    { en: 'Forest',       fr: 'Vert forêt',     ar: 'أخضر غامق',     hex: '#2F5233', aliases: ['forest green', 'vert foret'] },
    { en: 'Emerald',      fr: 'Émeraude',       ar: 'زمردي',         hex: '#3D7A5C', aliases: ['emeraude'] },
    { en: 'Mint',         fr: 'Menthe',         ar: 'نعناعي',        hex: '#A8C3A0', aliases: ['light green', 'vert clair'] },
    { en: 'Sage',         fr: 'Sauge',          ar: 'حكيمي',         hex: '#8A9A7B' },
    { en: 'Teal',         fr: 'Sarcelle',       ar: 'سيرولي',        hex: '#2E6E6E', aliases: ['teal blue'] },
    { en: 'Turquoise',    fr: 'Turquoise',      ar: 'فيروزي',        hex: '#3FB8AF' },
    { en: 'Blue',         fr: 'Bleu',           ar: 'أزرق',          hex: '#3B5B9E' },
    { en: 'Navy',         fr: 'Bleu marine',    ar: 'كحلي',          hex: '#1F2A56', aliases: ['navy blue', 'bleu nuit', 'navyblue', 'kholi'] },
    { en: 'Royal blue',   fr: 'Bleu roi',       ar: 'أزرق ملكي',     hex: '#4169E1', aliases: ['royalblue', 'royal blue'] },
    { en: 'Sky blue',     fr: 'Bleu ciel',      ar: 'أزرق سماوي',    hex: '#87CEEB', aliases: ['skyblue', 'sky blue'] },
    { en: 'Light blue',   fr: 'Bleu clair',     ar: 'أزرق فاتح',     hex: '#ADD8E6', aliases: ['lightblue', 'light blue'] },
    { en: 'Lavender',     fr: 'Lavande',        ar: 'لافندر',        hex: '#BBA5D8', aliases: ['lavande'] },
    { en: 'Purple',       fr: 'Violet',         ar: 'بنفسجي',        hex: '#6B4A8A', aliases: ['violet', 'pourpre', 'lilas'] },
    { en: 'Plum',         fr: 'Prune',          ar: 'برقوقي',        hex: '#5E3A64', aliases: ['prune'] },
    { en: 'Lilac',        fr: 'Lilas',          ar: 'ليلكي',         hex: '#C8A2C8' },
    { en: 'Wine',         fr: 'Vin',            ar: 'نبيتي',         hex: '#722F37', aliases: ['vin'] },
    { en: 'Multicolor',   fr: 'Multicolore',    ar: 'متعدد الألوان', hex: '#9B9B9B', aliases: ['multicolor', 'multicolour'] }
  ];

  // Extra bare name -> hex entries so every historically used color name keeps
  // resolving even when it is not part of the curated list above.
  var EXTRA = {
    white: '#FFFFFF', cream: '#F1E7D3', beige: '#D9CCB2', gold: '#A67C00',
    bronze: '#6E5A1C', espresso: '#3B362E', black: '#1A1A1A', champagne: '#C9A227',
    ivory: '#FFFFF0', charcoal: '#404040', emerald: '#3D7A5C', blush: '#E8B4B8',
    nude: '#D2A58F', sage: '#8A9A7B', brown: '#6E5A1C', blue: '#3B5B9E',
    navy: '#1F2A56', 'navy blue': '#1F2A56', marine: '#1F4E79', green: '#3D7A5C',
    forest: '#2F5233', violet: '#6B4A8A', purple: '#6B4A8A', rose: '#C97B84',
    pink: '#E8A2B0', gray: '#808080', grey: '#808080', orange: '#C96A2B',
    red: '#B23B3B', maroon: '#7A2E2E', burgundy: '#6E2542', silver: '#C0C0C0',
    teal: '#2E6E6E', mint: '#A8C3A0', terracotta: '#B0603F', sand: '#DECC9C',
    taupe: '#A79A8C', plum: '#5E3A64', olive: '#7A7A3D', rust: '#9C4E2E',
    pearl: '#F2EBE0', yellow: '#D9B23B', peach: '#F6C9AE', lavender: '#BBA5D8',
    coral: '#F07A6B', turquoise: '#3FB8AF', copper: '#B87333', camel: '#C19A6B',
    khaki: '#B5A25E', wine: '#722F37', lilac: '#C8A2C8', indigo: '#3F51B5',
    mustard: '#D9B34A', bordeaux: '#7A2E2E', magenta: '#C2185B', rosegold: '#B76E79',
    'rose gold': '#B76E79', 'royal blue': '#4169E1', royalblue: '#4169E1',
    'sky blue': '#87CEEB', skyblue: '#87CEEB', mintgreen: '#A8C3A0',
    olivegreen: '#7A7A3D', multicolor: '#9B9B9B',
    blanc: '#FFFFFF', 'crème': '#F1E7D3', or: '#A67C00', 'doré': '#A67C00',
    noir: '#1A1A1A', argent: '#C0C0C0', ivoire: '#FFFFF0', anthracite: '#404040',
    'émeraude': '#3D7A5C', 'rose poudré': '#E8B4B8', marron: '#6E5A1C',
    brun: '#6E5A1C', bleu: '#3B5B9E', 'bleu marine': '#1F2A56', 'bleu nuit': '#1F2A56',
    'bleu roi': '#4169E1', 'bleu ciel': '#87CEEB', 'bleu clair': '#ADD8E6',
    vert: '#3D7A5C', 'vert forêt': '#2F5233', gris: '#808080', rose: '#C97B84',
    rouge: '#B23B3B', violet: '#6B4A8A', pourpre: '#6B4A8A', orange: '#C96A2B',
    jaune: '#D9B23B', sauge: '#8A9A7B', prune: '#5E3A64', olive: '#7A7A3D',
    sable: '#DECC9C', taupe: '#A79A8C', menthe: '#A8C3A0', sarcelle: '#2E6E6E',
    rouille: '#9C4E2E', moutarde: '#D9B34A', 'pêche': '#F6C9AE', lavande: '#BBA5D8',
    corail: '#F07A6B', turquoise: '#3FB8AF', cannelle: '#9C4A2E', perle: '#F2EBE0',
    'écru': '#EADFC8', baurdeaux: '#7A2E2E', 'peach': '#F6C9AE', 'rose gold': '#B76E79',
    'أبيض': '#FFFFFF', 'أسود': '#1A1A1A', 'أزرق': '#3B5B9E', 'أحمر': '#B23B3B',
    'أخضر': '#3D7A5C', 'أصفر': '#D9B23B', 'وردي': '#E8A2B0', 'برتقالي': '#C96A2B',
    'بنفسجي': '#6B4A8A', 'رمادي': '#808080', 'بني': '#6E5A1C', 'ذهبي': '#A67C00',
    'فضي': '#C0C0C0', 'بيج': '#D9CCB2', 'زيتوني': '#7A7A3D', 'فيروزي': '#3FB8AF',
    'عنابي': '#7A2E2E', 'كحلي': '#1F2A56', 'كريمي': '#F1E7D3', 'عاجي': '#FFFFF0',
    'وردي فاتح': '#E8B4B8', 'أزرق داكن': '#1F2A56', 'أزرق فاتح': '#ADD8E6'
  };

  var palette = {};
  Object.keys(EXTRA).forEach(function (k) { palette[norm(k)] = EXTRA[k]; });

  var index = {};
  list.forEach(function (e) {
    var names = [e.en, e.fr, e.ar].concat(e.aliases || []);
    names.forEach(function (n) { if (n) index[norm(n)] = e; });
  });

  function entry(name) {
    return index[norm(name)] || null;
  }

  function hex(name) {
    var s = String(name == null ? '' : name).trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
    var n = norm(s);
    if (palette[n]) return palette[n];
    var e = index[n];
    return (e && e.hex) || DEFAULT_HEX;
  }

  function has(name) {
    var n = norm(name);
    return !!palette[n] || !!index[n];
  }

  function label(name, lang) {
    var e = entry(name);
    if (!e) return String(name == null ? '' : name);
    if (lang === 'ar' && e.ar) return e.ar;
    if (lang === 'fr' && e.fr) return e.fr;
    return e.en || e.fr || String(name == null ? '' : name);
  }

  window.HN_COLORS = {
    list: list,
    palette: palette,
    hex: hex,
    has: has,
    label: label,
    entry: entry,
    norm: norm
  };
})();