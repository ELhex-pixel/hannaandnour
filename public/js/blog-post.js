/**
 * Blog post page: renders a single article from /api/blog?slug=<slug>.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function paragraphs(body) {
    if (!body) return '';
    return String(body).split(/\n\s*\n/).map(function (p) {
      var t = p.trim().replace(/\n/g, '<br>');
      return t ? '<p>' + t + '</p>' : '';
    }).join('');
  }

  function render(post) {
    var el = document.getElementById('postContent');
    if (!el) return;
    document.title = post.title + ' | Hanna & Nour';
    var initial = (post.author || '?').replace(/[^A-Za-zÀ-ÿ]/g, '').charAt(0).toUpperCase() || 'A';
    el.innerHTML =
      '<div class="blog-post-header">' +
      '<a href="blog.html" class="blog-card-category">' + esc(post.category || 'Blog') + '</a>' +
      '<h1 class="blog-post-title">' + esc(post.title) + '</h1>' +
      '<div class="blog-post-meta">' +
      '<span>' + esc(post.author || '') + '</span>' +
      '<span>' + fmtDate(post.published_at) + '</span>' +
      '<span>' + (parseInt(post.read_minutes, 10) || 5) + ' min de lecture</span>' +
      '</div></div>' +
      '<figure class="blog-post-figure"><img src="' + esc(post.image || 'images/hero.jpg') + '" alt="' + esc(post.title) + '"></figure>' +
      '<div class="blog-post-body" style="margin-top:var(--spacing-xl);">' + paragraphs(post.body) + '</div>' +
      '<div class="text-center" style="margin-top:var(--spacing-2xl);">' +
      '<a href="blog.html" class="btn btn-secondary">&larr; Retour au blog</a> ' +
      '<a href="shop.html" class="btn btn-primary">D&eacute;couvrir la collection</a>' +
      '</div>';
  }

  function init() {
    var params = new URLSearchParams(window.location.search);
    var slug = params.get('slug') || '';
    if (!slug) {
      var fb = document.getElementById('postFallback');
      if (fb) fb.style.display = '';
      return;
    }
    HN.api = HN.api || function (p) { return '/.netlify/functions/' + p; };
    fetch(HN.api('blog') + '?slug=' + encodeURIComponent(slug))
      .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
      .then(function (d) {
        if (d.post) { render(d.post); return; }
        var fb = document.getElementById('postFallback');
        if (fb) fb.style.display = '';
      })
      .catch(function () {
        var fb = document.getElementById('postFallback');
        if (fb) fb.style.display = '';
      });
  }

  init();
})();