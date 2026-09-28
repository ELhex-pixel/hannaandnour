/**
 * Hanna & Nour - Client configuration
 *
 * The front-end talks only to the Netlify Functions, which hold the Supabase
 * service-role key server-side — no Supabase credentials belong in the browser.
 * API_BASE is usually empty: the site talks to `/.netlify/functions/...`.
 * Set it only if you proxy differently.
 */
window.HN_CONFIG = {
  API_BASE: ''
};