/**
 * Print page: Invoice / packing slip / courier label for a paid order.
 * Requires the admin token (sessionStorage['hn-admin-token']) to fetch the order.
 */
(function () {
  'use strict';

  var API = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';

  function token() {
    try { return sessionStorage.getItem('hn-admin-token') || ''; } catch (e) { return ''; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function money(cents) {
    return '$' + ((parseInt(cents, 10) || 0) / 100).toFixed(2);
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('fr-FR');
  }

  var STORE = {
    name: 'Hanna & Nour',
    tagline: 'Modest Fashion for the Modern Woman',
    email: 'care@hannaandnour.com',
    site: 'https://hannaandnour.netlify.app'
  };

  function customerAddress(o) {
    var parts = [];
    parts.push(o.customer_name);
    if (o.delivery_type === 'pickup') {
      parts.push('Retrait : ' + (o.pickup_point || 'point relais'));
    } else {
      parts.push(o.address1);
      if (o.address2) parts.push(o.address2);
      parts.push(o.city + (o.state ? ', ' + o.state : '') + ' ' + o.postal_code);
      parts.push(o.country);
    }
    if (o.phone) parts.push('T\u00e9l : ' + o.phone);
    return parts.map(esc).join('<br>');
  }

  function itemsTable(o) {
    return '<table class="info"><thead><tr><th>Article</th><th>Qte</th><th>Prix unitaire</th><th>Total</th></tr></thead><tbody>' +
      (o.order_items || []).map(function (it) {
        return '<tr><td>' + esc(it.product_name) + '</td><td>' + (parseInt(it.quantity, 10) || 1) + '</td><td>' + money(it.unit_price_cents) + '</td><td>' + money(it.unit_price_cents * it.quantity) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function totalsTable(o) {
    var rows =
      '<tr><td>Sous-total</td><td style="text-align:right;">' + money(o.subtotal_cents) + '</td></tr>' +
      (o.discount_cents > 0 ? '<tr><td>Remise' + (o.promo_code ? ' (' + esc(o.promo_code) + ')' : '') + '</td><td style="text-align:right;">&minus;' + money(o.discount_cents) + '</td></tr>' : '') +
      '<tr><td>Livraison</td><td style="text-align:right;">' + money(o.shipping_cents) + '</td></tr>' +
      (o.tax_cents > 0 ? '<tr><td>Taxe</td><td style="text-align:right;">' + money(o.tax_cents) + '</td></tr>' : '') +
      '<tr class="total"><td>Total</td><td style="text-align:right;">' + money(o.total_cents) + '</td></tr>';
    return '<table class="totals">' + rows + '</table>';
  }

  function docHead(o, type) {
    return '<div class="doc-head">' +
      '<div><h1>Hanna &amp; Nour</h1><div class="doc-type">' + type + '</div></div>' +
      '<div style="text-align:right; font-size:12px;">' +
      '<p style="margin:0;"><strong>' + esc(o.order_number) + '</strong></p>' +
      '<p style="margin:2px 0 0; color:var(--muted);">Date : ' + fmtDate(o.created_at) + '</p>' +
      (o.paid_at ? '<p style="margin:0; color:var(--muted);">Pay\u00e9e le : ' + fmtDate(o.paid_at) + '</p>' : '') +
      '</div></div>';
  }

  function renderInvoice(o) {
    var shippingLabel = o.shipping_method === 'pickup' ? 'Retrait / point relais' : (o.shipping_method === 'express' ? 'Express' : o.shipping_method === 'next_day' ? 'J+1' : 'Standard');
    return '<div class="sheet">' +
      docHead(o, 'Facture') +
      '<div class="grid2">' +
      '<div class="block"><p class="label">Factur\u00e9 &agrave;</p><p style="line-height:1.5;">' + customerAddress(o) + '</p></div>' +
      '<div class="block"><p class="label">Mode d\u2019exp\u00e9dition</p><p>' + shippingLabel + '<br>' +
      (o.status === 'paid' ? 'Paiement : accept\u00e9' : 'Paiement : ' + (o.status === 'refunded' ? 'rembours\u00e9' : 'en attente')) + '</p></div>' +
      '</div>' +
      itemsTable(o) +
      totalsTable(o) +
      '<div class="sig">Merci de votre confiance. Pour toute question : ' + STORE.email + ' &middot; ' + STORE.site + '</div>' +
      '</div>';
  }

  function renderPacking(o) {
    var rows = (o.order_items || []).map(function (it) {
      return '<tr><td>' + esc(it.product_name) + '</td><td style="text-align:center;">' + (parseInt(it.quantity, 10) || 1) + '</td></tr>';
    }).join('');
    return '<div class="sheet">' +
      docHead(o, 'Bon de livraison') +
      '<div class="grid2">' +
      '<div class="block"><p class="label">Pr\u00e9par\u00e9 pour</p><p style="line-height:1.5;">' + customerAddress(o) + '</p></div>' +
      '<div class="block"><p class="label">Exp\u00e9di\u00e9 depuis</p><p style="line-height:1.5;">Hanna &amp; Nour<br>' + STORE.email + '</p></div>' +
      '</div>' +
      '<table class="info"><thead><tr><th>Article</th><th style="text-align:center;">Quantit\u00e9</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="sig">Toutes les pi\u00e8ces ont \u00e9t\u00e9 v\u00e9rifi\u00e9es avant envoi.</div>' +
      '</div>';
  }

  function renderLabel(o) {
    var tracking = o.tracking_number || o.order_number;
    return '<div class="sheet label">' +
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<span class="label-logo">Hanna &amp; Nour</span>' +
      '<span style="font-size:9px; color:var(--muted);">Commande ' + esc(o.order_number) + '</span>' +
      '</div>' +
      '<div class="label-addr">' +
      '<p class="label" style="margin-bottom:2px;">' + (o.delivery_type === 'pickup' ? 'Retrait / point relais' : 'Livraison') + '</p>' +
      '<p style="margin:0; line-height:1.5;">' + customerAddress(o) + '</p>' +
      '</div>' +
      '<div class="label-barcode"><svg id="barcode"></svg></div>' +
      '<div style="text-align:center;" class="track">' + esc(tracking) + '</div>' +
      '<div class="label-footer"><span>Hanna &amp; Nour</span><span>' + esc(o.email) + '</span><span>' + fmtDate(o.created_at) + '</span></div>' +
      '</div>';
  }

  function drawBarcode(text) {
    try {
      if (window.JsBarcode) {
        JsBarcode('#barcode', String(text).replace(/[^\x20-\x7E]/g, ''), {
          format: 'CODE128', width: 2.2, height: 70, displayValue: true, fontSize: 14, margin: 0
        });
      }
    } catch (e) { /* no barcode library */ }
  }

  function init() {
    var params = new URLSearchParams(window.location.search);
    var doc = params.get('doc') || 'invoice';
    var orderId = params.get('order') || '';
    document.getElementById('toolbarInfo').textContent = 'Impression : ' + (doc === 'invoice' ? 'Facture' : doc === 'packing' ? 'Bon de livraison' : 'Étiquette');

    if (!orderId || !token()) {
      document.getElementById('sheetHolder').innerHTML = '<div class="sheet"><p>Session expir\u00e9e. Rouvrez depuis l\u2019espace admin.</p></div>';
      return;
    }

    fetch(API + '/admin?action=getOrder&id=' + encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token()))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.order) throw new Error('Commande introuvable');
        var holder = document.getElementById('sheetHolder');
        if (doc === 'invoice') holder.innerHTML = renderInvoice(data.order);
        else if (doc === 'packing') holder.innerHTML = renderPacking(data.order);
        else holder.innerHTML = renderLabel(data.order);
        if (doc === 'label' && document.getElementById('barcode')) {
          drawBarcode(data.order.tracking_number || data.order.order_number);
        }
        if (doc === 'label') {
          holder.style.height = '105mm';
        }
      })
      .catch(function (err) {
        document.getElementById('sheetHolder').innerHTML = '<div class="sheet"><p>Impossible de charger la commande : ' + esc(err.message) + '</p></div>';
      });

    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
  }

  init();
})();