(function () {
  'use strict';
  var api = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';
  function token() { try { return sessionStorage.getItem('hn-admin-token') || ''; } catch (e) { return ''; } }
  function call(action, data) {
    return fetch(api + '/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: JSON.stringify(Object.assign({ action: action }, data || {})) })
      .then(function (res) { return res.json().then(function (body) { if (!res.ok) { var error = new Error(body.error || 'Erreur serveur'); error.code = body.code; error.status = res.status; throw error; } return body; }); });
  }
  function uploadImages(files, options) {
    options = options || {};
    var list = Array.prototype.slice.call(files || []);
    if (!list.length || list.length > 20) return Promise.reject(new Error('Sélectionnez entre 1 et 20 photos.'));
    var invalid = list.filter(function (file) {
      return !/^image\/(jpeg|png|webp)$/.test(file.type) || !file.size || file.size > 4 * 1024 * 1024;
    });
    if (invalid.length) return Promise.reject(new Error('Fichiers refusés : ' + invalid.map(function (file) { return file.name; }).join(', ') + '. JPG, PNG ou WebP, 4 Mo maximum par photo.'));
    var result = { uploaded: 0, failed: [], stopped: false, total: list.length };
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
      if (options.progress) options.progress(file, index, result);
      return Promise.resolve().then(function () { return read(file); }).then(function (data) {
        if (!active()) { result.stopped = true; return; }
        return call('uploadImage', { name: file.name, mime: file.type, data_base64: data }).then(function (res) {
          if (!active()) { result.stopped = true; return; }
          if (!res.url) throw new Error('URL de la photo manquante.');
          result.uploaded++;
          if (options.success) options.success(res.url, file);
        });
      }).catch(function (error) {
        result.failed.push({ name: file.name, error: error.message });
      }).then(next);
    }
    return Promise.resolve().then(next);
  }
  window.HN_ADMIN = { token: token, call: call, uploadImages: uploadImages };
})();
