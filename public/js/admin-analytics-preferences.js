(function () {
  'use strict';
  var preferences = window.HN_ANALYTICS, status = document.getElementById('analyticsDeviceStatus');
  var exclude = document.getElementById('excludeAnalyticsDevice'), include = document.getElementById('includeAnalyticsDevice');
  if (!preferences || !status || !exclude || !include) return;
  function render() {
    var value = preferences.state();
    status.textContent = value.device ? 'Ce navigateur est exclu : vos pages vues, consultations, ajouts au panier et essais de paiement ne sont plus envoyés dans les statistiques de visites.' : value.session ? 'Votre session administrateur est exclue. Après déconnexion, ce navigateur pourra de nouveau être compté.' : 'Ce navigateur est compté comme un navigateur de visiteur.';
    if (value.device && !value.persistent) status.textContent += ' Le stockage est indisponible : l’exclusion ne peut pas être garantie dans les autres onglets ou après fermeture.';
    exclude.hidden = value.device; include.hidden = !value.device;
  }
  exclude.addEventListener('click',function () { preferences.exclude(); render(); });
  include.addEventListener('click',function () {
    if (!window.confirm('Réactiver le comptage de ce navigateur ? Tant qu’une session admin y est détectée, elle restera exclue. Les autres navigateurs déjà exclus gardent leur réglage.')) return;
    preferences.include(); render();
  });
  document.addEventListener('hn:analytics-preference',render);
  document.addEventListener('hn:admin-logout',render);
  render();
})();
