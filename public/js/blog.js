/* Blog cards share their renderer with the pre-rendered public pages. */
(function () {
  'use strict';
  var HN = window.HN, content = window.HN_CONTENT;
  if (!HN || !content) return;
  var PAGE_SIZE = 6, posts = [], shown = 0, received = false;
  var grid = document.querySelector('.blog-grid'), more = document.getElementById('blogMoreBtn');
  if (!grid) return;
  function renderMore() {
    var next = Math.min(posts.length, shown + PAGE_SIZE), html = '';
    for (var i = shown; i < next; i++) html += content.postCardHTML(posts[i], HN.lang(), HN.tr, window.location.protocol === 'file:');
    grid.insertAdjacentHTML('beforeend', html);
    shown = next;
    if (more) more.style.display = shown >= posts.length ? 'none' : '';
  }
  function reset(count) {
    grid.textContent = ''; shown = 0;
    if (!posts.length) {
      var empty = document.createElement('p'); empty.setAttribute('data-i18n', 'blogEmpty'); empty.textContent = HN.tr('blogEmpty'); grid.appendChild(empty);
      if (more) more.style.display = 'none';
    } else do { renderMore(); } while (shown < Math.min(count, posts.length));
  }
  function init() {
    fetch(HN.api('blog'), { cache: 'no-store', signal: AbortSignal.timeout(12000) })
      .then(function (res) { if (!res.ok) throw new Error('Articles unavailable'); return res.json(); })
      .then(function (data) { posts = (data.posts || []).filter(function (post) { return content.validSlug(post.slug); }); received = true; reset(PAGE_SIZE); })
      .catch(function () { if (window.location.protocol !== 'file:') HN.loadError(grid, init, 'postLoadError'); if (more) more.style.display = 'none'; });
  }
  if (more) more.addEventListener('click', renderMore);
  document.addEventListener('langchange', function () { if (received) reset(shown || PAGE_SIZE); });
  init();
})();
