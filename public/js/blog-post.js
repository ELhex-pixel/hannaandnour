/* Fetch the live article, with a pre-rendered public copy for crawlers/no-JS. */
(function () {
  'use strict';
  var HN = window.HN, content = window.HN_CONTENT;
  if (!HN || !content) return;
  var post = null;
  function render() {
    if (!post) return;
    var lang = HN.lang(), el = document.getElementById('postContent');
    el.innerHTML = content.postHTML(post, lang, HN.tr);
    var fallback = document.getElementById('postFallback');
    if (fallback) fallback.style.display = 'none';
    content.applyMetadata(document, content.metadata(document.body.getAttribute('data-site-origin') || window.location.origin, 'post', post, lang), 'post');
    var robots = document.querySelector('meta[name="robots"]');
    if (robots && !document.body.hasAttribute('data-preview')) robots.content = 'index, follow';
  }
  function unavailable(missing) {
    post = null;
    var el = document.getElementById('postContent');
    el.textContent = '';
    if (missing) {
      var fallback = document.getElementById('postFallback');
      if (fallback) fallback.style.display = '';
      var robots = document.querySelector('meta[name="robots"]');
      if (robots) robots.content = 'noindex, follow';
      var schema = document.getElementById('post-jsonld');
      if (schema && schema.parentNode) schema.parentNode.removeChild(schema);
    } else HN.loadError(el, init, 'postLoadError');
  }
  function init() {
    var slug = content.slug(window.location);
    if (!slug) { unavailable(true); return; }
    fetch(HN.api('blog') + '?slug=' + encodeURIComponent(slug), { cache: 'no-store', signal: AbortSignal.timeout(12000) })
      .then(function (r) { if (!r.ok) throw new Error('Article unavailable'); return r.json(); })
      .then(function (data) { if (!data.post) { unavailable(true); return; } post = data.post; render(); })
      .catch(function () { unavailable(false); });
  }
  document.addEventListener('langchange', render);
  init();
})();
