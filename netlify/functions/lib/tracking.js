function trackingLink(carrier, number) {
  const value = encodeURIComponent(String(number || '').slice(0, 100));
  if (!value) return null;
  const links = {
    colissimo: 'https://www.laposte.fr/outils/suivre-vos-envois?code=',
    chronopost: 'https://www.chronopost.fr/fr/suivi-colis?listeNumerosLT=',
    mondialrelay: 'https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=',
    dhl: 'https://www.dhl.com/fr-fr/home/suivi.html?tracking-id='
  };
  return links[carrier] ? links[carrier] + value : null;
}
module.exports = { trackingLink };
