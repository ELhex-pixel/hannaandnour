(function () {
  'use strict';
  var dialog = document.getElementById('adminPhotoDialog');
  if (!dialog) return;
  var entries = [], index = 0, opener = null, revision = 0;
  var el = function (id) { return document.getElementById(id); };
  function render() {
    var entry = entries[index], request = ++revision;
    var image = document.createElement('img'); image.id = 'adminPhotoImage'; image.alt = 'Photo ' + (index + 1) + ' du produit'; image.decoding = 'async';
    el('adminPhotoStage').replaceChildren(image);
    el('adminPhotoStage').classList.remove('is-zoomed'); el('adminPhotoStage').scrollTop = 0; el('adminPhotoStage').scrollLeft = 0;
    el('adminPhotoZoom').setAttribute('aria-pressed', 'false'); el('adminPhotoZoom').textContent = 'Agrandir les détails';
    el('adminPhotoCaption').textContent = 'Photo ' + (index + 1) + ' / ' + entries.length + ' — ' + (entry.color || 'Photo générale / non associée');
    el('adminPhotoStatus').textContent = 'Chargement de la photo…';
    image.onload = function () { if (request === revision && dialog.open) el('adminPhotoStatus').textContent = ''; };
    image.onerror = function () { if (request === revision && dialog.open) el('adminPhotoStatus').textContent = 'Photo indisponible. Vérifiez son adresse ou passez à la photo suivante.'; };
    image.src = entry.src;
    el('adminPhotoPrevious').disabled = entries.length < 2; el('adminPhotoNext').disabled = entries.length < 2;
  }
  function cleanup() {
    revision++; entries = []; var image = el('adminPhotoImage');
    if (image) { image.onload = null; image.onerror = null; image.removeAttribute('src'); }
    el('adminPhotoStatus').textContent = ''; el('adminPhotoCaption').textContent = '';
    if (opener && document.contains(opener) && opener.getClientRects().length) opener.focus();
    opener = null;
  }
  function close() { if (dialog.open) dialog.close(); cleanup(); }
  function move(direction) { if (!entries.length) return; index = (index + direction + entries.length) % entries.length; render(); }
  el('adminPhotoClose').addEventListener('click', close);
  el('adminPhotoPrevious').addEventListener('click', function () { move(-1); });
  el('adminPhotoNext').addEventListener('click', function () { move(1); });
  el('adminPhotoZoom').addEventListener('click', function () {
    var zoomed = el('adminPhotoStage').classList.toggle('is-zoomed');
    this.setAttribute('aria-pressed', zoomed ? 'true' : 'false'); this.textContent = zoomed ? 'Voir la photo entière' : 'Agrandir les détails';
  });
  dialog.addEventListener('close', function () { if (!dialog.open) cleanup(); });
  dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) close(); });
  dialog.addEventListener('keydown', function (event) {
    if (!el('adminPhotoStage').classList.contains('is-zoomed') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); move(event.key === 'ArrowRight' ? 1 : -1); }
  });
  document.addEventListener('hn:product-editor', close);
  document.addEventListener('hn:admin-logout', close);
  window.HN_ADMIN_PHOTOS = {
    open: function (photos, src, trigger) {
      var list = (photos || []).filter(function (photo) { return photo && window.HN_MEDIA.validUrl(photo.src); }).slice(0, 100);
      var selected = list.findIndex(function (photo) { return photo.src === src; });
      if (selected < 0 || !dialog.showModal) return false;
      entries = list.map(function (photo) { return { src: photo.src, color: photo.color }; }); index = selected; opener = trigger || document.activeElement;
      if (!dialog.open) dialog.showModal(); render(); el('adminPhotoClose').focus(); return true;
    }, close: close
  };
})();
