/* Device-level exclusion only. No admin token, identity or IP is shared/stored here. */
(function () {
  'use strict';
  var key = 'hn-analytics-excluded', memory = false, persistent = true;
  function adminSession() { try { return !!sessionStorage.getItem('hn-admin-token'); } catch (error) { return false; } }
  function saved() { try { return localStorage.getItem(key) === '1'; } catch (error) { persistent = false; return memory; } }
  function state() { return { excluded: memory || saved() || adminSession(), device: memory || saved(), session: adminSession(), persistent: persistent }; }
  function changed() { document.dispatchEvent(new CustomEvent('hn:analytics-preference')); }
  function exclude() {
    memory = true;
    try { localStorage.setItem(key,'1'); persistent = localStorage.getItem(key) === '1'; } catch (error) { persistent = false; }
    changed();
  }
  function include() {
    try { localStorage.removeItem(key); memory = false; persistent = true; } catch (error) { persistent = false; }
    changed();
  }
  function internalPage(pathname) { return /^\/(?:fr\/|en\/|ar\/)?(?:admin|stock|print)(?:\.html)?\/?$/i.test(pathname || ''); }
  function shouldTrack() {
    return !internalPage(window.location.pathname) && !document.body?.hasAttribute('data-preview') && !state().excluded;
  }
  window.HN_ANALYTICS = { state: state, exclude: exclude, include: include, shouldTrack: shouldTrack };
  // A restored admin session marks this browser across tabs and later logouts.
  if (adminSession()) exclude();
  window.addEventListener('storage',function(event) { if (event.key === key || event.key === null) { memory = false; changed(); } });
})();
