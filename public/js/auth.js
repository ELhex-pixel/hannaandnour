/**
 * Hanna & Nour - Client auth (window.HN_AUTH)
 * Supabase Auth sessions handled server-side via /api/auth.
 * Responsibilities:
 *   - signup / login / logout / session restore (access+refresh tokens)
 *   - merge the local wishlist into the account on login
 *   - push wishlist changes to the account when signed in
 *
 * Loaded after store.js. Toggles hearts normally; the 'hn:wishlist' event
 * (fired by store.js) triggers the account sync when a user is signed in.
 */
(function () {
  'use strict';

  var SESSION_KEY = 'hn-auth';
  var WISH_KEY = 'hn-wishlist';
  var current = null;
  var pushTimer = null;

  function apiUrl() {
    return window.HN && typeof window.HN.api === 'function' ? window.HN.api('auth') : '/.netlify/functions/auth';
  }

  function readLS(key) {
    try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  function writeLS(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function removeLS(key) {
    try { window.localStorage.removeItem(key); } catch (e) {}
  }

  function loadSession() {
    var s = readLS(SESSION_KEY);
    return s && s.access_token ? s : null;
  }

  function saveSession(s) {
    current = s;
    writeLS(SESSION_KEY, s);
  }

  function getToken() {
    return current && current.access_token ? current.access_token : '';
  }

  function emitAuth() {
    try { document.dispatchEvent(new CustomEvent('hn:auth')); } catch (e) {}
  }

  function call(payload, needsAuth) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (needsAuth && token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(apiUrl(), { method: 'POST', headers: headers, body: JSON.stringify(payload || {}) })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.error) {
          var e = new Error(data.error);
          e.code = data.error;
          throw e;
        }
        return data;
      });
  }

  function currentUser() {
    return current ? (current.user || null) : null;
  }

  function isAuthed() {
    return !!getToken();
  }

  /* ---------------- Wishlist sync ---------------- */

  function pushWishlist() {
    if (!isAuthed()) return;
    call({ action: 'wishlist', method: 'POST', slugs: (window.HN && HN.wishlist.list()) || [] }, true)
      .catch(function () { /* sync is best-effort */ });
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushWishlist, 400);
  }

  function refreshLocalWishlist() {
    try {
      document.dispatchEvent(new CustomEvent('hn:wishlist'));
      if (window.HN && HN.updateWishlistHearts) HN.updateWishlistHearts();
    } catch (e) {}
  }

  function mergeWishlistWithAccount(serverSlugs) {
    var local = window.HN && HN.wishlist ? HN.wishlist.list() : [];
    var set = {};
    (serverSlugs || []).concat(local).forEach(function (s) { if (s) set[s] = true; });
    var merged = Object.keys(set);
    writeLS(WISH_KEY, merged);
    refreshLocalWishlist();
    return call({ action: 'wishlist', method: 'POST', slugs: merged }, true)
      .catch(function () {});
  }

  function afterLogin() {
    return call({ action: 'wishlist', method: 'GET' }, true)
      .then(function (d) { return mergeWishlistWithAccount(d.slugs || []); })
      .catch(function () {});
  }

  /* ---------------- Actions ---------------- */

  function login(email, password) {
    return call({ action: 'login', email: email, password: password })
      .then(function (d) {
        saveSession(d.session);
        current.user = d.user;
        writeLS(SESSION_KEY, current);
        emitAuth();
        return afterLogin().then(function () { return currentUser(); });
      });
  }

  function signup(firstName, email, password) {
    return call({ action: 'signup', first_name: firstName, email: email, password: password })
      .then(function (d) {
        saveSession(d.session);
        current.user = d.user;
        writeLS(SESSION_KEY, current);
        emitAuth();
        return afterLogin().then(function () { return currentUser(); });
      });
  }

  function logout() {
    current = null;
    removeLS(SESSION_KEY);
    emitAuth();
    refreshLocalWishlist();
    return Promise.resolve(null);
  }

  // Restore a stored session on page load (me -> refresh -> clear).
  function boot() {
    var sess = loadSession();
    if (!sess) return Promise.resolve(null);
    current = sess;
    return call({ action: 'me' }, true)
      .then(function (d) {
        current.user = d.user;
        writeLS(SESSION_KEY, current);
        emitAuth();
        return currentUser();
      })
      .catch(function () {
        if (!sess.refresh_token) { current = null; removeLS(SESSION_KEY); return null; }
        return call({ action: 'refresh', refresh_token: sess.refresh_token })
          .then(function (d) {
            if (d && d.session && d.session.access_token) {
              saveSession(d.session);
              current.user = d.user;
              writeLS(SESSION_KEY, current);
              emitAuth();
              return currentUser();
            }
            current = null; removeLS(SESSION_KEY);
            return null;
          })
          .catch(function () { current = null; removeLS(SESSION_KEY); return null; });
      });
  }

  // When a heart is toggled (store.js emits 'hn:wishlist'), back it up.
  document.addEventListener('hn:wishlist', function () {
    if (isAuthed()) schedulePush();
  });

  window.HN_AUTH = {
    currentUser: currentUser,
    isAuthed: isAuthed,
    token: getToken,
    login: login,
    signup: signup,
    logout: logout,
    boot: boot,
    ready: boot().catch(function () { return null; })
  };
})();