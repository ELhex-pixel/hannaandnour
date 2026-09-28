/**
 * Blog page: renders the article grid from /api/blog (admin-managed).
 * Offline / API unavailable: keeps the static markup as a fallback.
 * Each card links to blog-post.html?slug=<slug>.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;

  var PAGE_SIZE = 6;
  var posts = [];
  var shown = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function card(p) {
    var initial = (p.author || '?').replace(/[^A-Za-zÀ-ÿ]/g, '').charAt(0).toUpperCase() || 'A';
    return '<article class="blog-card">' +
      '<a href="blog-post.html?slug=' + esc(p.slug) + '" class="blog-card-image" style="display:block;">' +
      '<img src="' + esc(p.image || 'images/hero.jpg') + '" alt="' + esc(p.title) + '">' +
      '</a>' +
      '<div class="blog-card-content">' +
      (p.category ? '<span class="blog-card-category">' + esc(p.category) + '</span>' : '') +
      '<h2 class="blog-card-title"><a href="blog-post.html?slug=' + esc(p.slug) + '" style="color:inherit; text-decoration:none;">' + esc(p.title) + '</a></h2>' +
      '<p class="blog-card-excerpt">' + esc(p.excerpt || '') + '</p>' +
      '<div class="blog-card-meta">' +
      '<div class="blog-card-author">' +
      '<span class="blog-author-avatar">' + initial + '</span>' +
      '<span>' + esc(p.author || '') + '</span>' +
      '</div>' +
      '<span>' + fmtDate(p.published_at) + ' &bull; ' + (parseInt(p.read_minutes, 10) || 5) + ' ' +
      window.I18n && window.I18n.t ? window.I18n.t('minRead') : 'min' +
      '</span>' +
      '</div></div></article>';
  }

  function renderMore() {
    var grid = document.querySelector('.blog-grid');
    var moreBtn = document.getElementById('blogMoreBtn');
    if (!grid) return;
    var next = Math.min(posts.length, shown + PAGE_SIZE);
    var html = '';
    for (var i = shown; i < next; i++) html += card(posts[i]);
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    while (tmp.firstChild) grid.appendChild(tmp.firstChild);
    shown = next;
    if (moreBtn) moreBtn.style.display = shown >= posts.length ? 'none' : '';
  }

  function init() {
    HN.api = HN.api || function (p) { return '/.netlify/functions/' + p; };
    fetch(HN.api('blog'))
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (d) {
        posts = (d.posts || []).slice();
        if (!posts.length) return;
        var grid = document.querySelector('.blog-grid');
        if (!grid) return;
        var moreBtn = document.getElementById('blogMoreBtn');
        if (moreBtn) {
          moreBtn.style.display = 'none';
          moreBtn.addEventListener('click', renderMore);
        }
        grid.innerHTML = '';
        shown = 0;
        if (posts.length > PAGE_SIZE && moreBtn) moreBtn.style.display = '';
        renderMore();
      })
      .catch(function () { /* offline: static markup stays */ });
  }

  init();
})();