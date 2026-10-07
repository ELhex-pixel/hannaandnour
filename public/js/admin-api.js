(function () {
  'use strict';
  var api = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';
  var MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
  var MAX_SOURCE_BYTES = 40 * 1024 * 1024;
  function token() { try { return sessionStorage.getItem('hn-admin-token') || ''; } catch (e) { return ''; } }
  function call(action, data) {
    return fetch(api + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify(Object.assign({ action: action }, data || {})) })
      .then(function (res) { return res.json().then(function (body) { if (!res.ok) { var error = new Error(body.error || 'Erreur serveur'); error.code = body.code; error.status = res.status; throw error; } return body; }); });
  }
  function imageError(file) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return 'Format non accepté : JPG, PNG ou WebP uniquement.';
    if (!Number.isInteger(file.size) || file.size <= 0) return 'Fichier vide ou taille invalide.';
    if (file.size > MAX_SOURCE_BYTES) return 'Photo trop lourde : 40 Mo maximum avant compression.';
    return '';
  }
  function prepareImage(file) {
    var error = imageError(file);
    if (error) return Promise.reject(new Error(error));
    if (file.size <= MAX_UPLOAD_BYTES) return Promise.resolve({ file: file, compressed: false });
    var image, url, canvas, timer;
    return Promise.resolve().then(function () {
      return new Promise(function (resolve, reject) {
        image = new Image();
        url = URL.createObjectURL(file);
        timer = setTimeout(function () { reject(new Error('Lecture de la photo trop longue.')); }, 20000);
        image.onload = function () { clearTimeout(timer); resolve(); };
        image.onerror = function () { clearTimeout(timer); reject(new Error('Photo illisible ou corrompue.')); };
        image.src = url;
      });
    }).then(function () {
      var originalWidth = image.naturalWidth, originalHeight = image.naturalHeight;
      if (!originalWidth || !originalHeight || originalWidth * originalHeight > 50000000 || Math.max(originalWidth, originalHeight) > 16000) throw new Error('Dimensions trop grandes : 50 mégapixels et 16 000 pixels par côté maximum.');
      canvas = document.createElement('canvas');
      var context = canvas.getContext('2d');
      if (!context) throw new Error('Compression indisponible dans ce navigateur.');
      var edge = Math.min(2560, Math.max(originalWidth, originalHeight));
      var qualities = [0.9, 0.82, 0.74], attempt = 0;
      function encode() {
        var scale = edge / Math.max(originalWidth, originalHeight);
        canvas.width = Math.max(1, Math.round(originalWidth * scale));
        canvas.height = Math.max(1, Math.round(originalHeight * scale));
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return new Promise(function (resolve, reject) {
          canvas.toBlob(function (blob) {
            if (!blob || !blob.size) { reject(new Error('Impossible de créer une copie compressée.')); return; }
            resolve(blob);
          }, 'image/webp', qualities[attempt % qualities.length]);
        }).then(function (blob) {
          if (blob.size <= MAX_UPLOAD_BYTES && /^(image\/webp|image\/png)$/.test(blob.type)) {
            var extension = blob.type === 'image/webp' ? '.webp' : '.png';
            var name = String(file.name || 'photo').replace(/\.(jpe?g|png|webp)$/i, '') + '-optimisee' + extension;
            return { file: new File([blob], name, { type: blob.type, lastModified: file.lastModified }), compressed: true, width: canvas.width, height: canvas.height };
          }
          attempt++;
          if (attempt >= 9 || (attempt % qualities.length === 0 && edge <= 1200)) throw new Error('Cette photo reste trop lourde après compression. Réduisez-la manuellement avant de réessayer.');
          if (attempt % qualities.length === 0) edge = Math.max(1200, Math.round(edge * 0.75));
          return encode();
        });
      }
      return encode();
    }).finally(function () {
      if (timer) clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
      if (image) { image.onload = null; image.onerror = null; image.src = ''; }
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    });
  }
  function uploadImages(files, options) {
    options = options || {};
    var list = Array.prototype.slice.call(files || []);
    if (!list.length || list.length > 20) return Promise.reject(new Error('Sélectionnez entre 1 et 20 photos.'));
    var invalid = list.filter(function (file) { return imageError(file); });
    if (invalid.length) return Promise.reject(new Error('Fichiers refusés : ' + invalid.map(function (file) { return (file && file.name || 'Photo') + ' — ' + imageError(file); }).join(' ')));
    var result = { uploaded: 0, compressed: 0, failed: [], stopped: false, total: list.length };
    var index = 0;
    var read = options.read || function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
        reader.onerror = function () { reject(new Error('Lecture du fichier impossible.')); };
        reader.onabort = function () { reject(new Error('Lecture interrompue.')); };
        reader.readAsDataURL(file);
      });
    };
    function active() { return !options.active || options.active(); }
    function next() {
      if (!active() || (options.stop && options.stop())) { result.stopped = true; return result; }
      if (index === list.length) return result;
      var file = list[index++];
      if (options.progress) options.progress(file, index, result, file.size > MAX_UPLOAD_BYTES ? 'compression' : 'upload');
      var prepared;
      return Promise.resolve().then(function () {
        if (!active() || (options.stop && options.stop())) { result.stopped = true; return; }
        return (options.prepare || prepareImage)(file);
      }).then(function (value) {
        if (!active() || (options.stop && options.stop())) { result.stopped = true; return; }
        prepared = value;
        if (!prepared || !prepared.file || imageError(prepared.file) || prepared.file.size > MAX_UPLOAD_BYTES) throw new Error('La copie préparée est invalide ou dépasse encore 4 Mo.');
        if (prepared.compressed && options.compressed) options.compressed(file, prepared.file, index, result);
        return read(prepared.file);
      }).then(function (data) {
        if (!active() || result.stopped || (options.stop && options.stop())) { result.stopped = true; return; }
        return call('uploadImage', { name: prepared.file.name, mime: prepared.file.type, data_base64: data }).then(function (res) {
          if (!active()) { result.stopped = true; return; }
          if (!res.url) throw new Error('URL de la photo manquante.');
          result.uploaded++;
          if (prepared.compressed) result.compressed++;
          if (options.success) options.success(res.url, file, prepared);
        });
      }).catch(function (error) {
        result.failed.push({ name: file.name, error: error.message });
      }).then(next);
    }
    return Promise.resolve().then(next);
  }
  window.HN_ADMIN = { token: token, call: call, uploadImages: uploadImages, prepareImage: prepareImage };
})();
