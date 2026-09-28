/**
 * Hanna & Nour - Chatbot flottant
 *
 * Bouton flottant (bas à droite/inset-inline-end) + panneau de chat sur toutes
 * les pages publiques. Le moteur de réponses vit côté serveur (/api/chat) :
 * ce script n'envoie que { message, lang } et affiche la réponse reçue —
 * jamais de HTML serveur injecté (XSS-safe), les liens sont construits ici.
 *
 * UI trilingue (fr/en/ar) via window.HN.lang(), compatible RTL et mode sombre.
 */
(function () {
  'use strict';
  if (window.__HN_CHAT__) return;
  window.__HN_CHAT__ = true;

  var API = (window.HN_CONFIG && window.HN_CONFIG.API_BASE) || '/.netlify/functions';

  var UI = {
    fr: {
      title: 'Hanna & Nour',
      sub: 'Assistant — réponse immédiate',
      intro: 'Bonjour \uD83D\uDC4B Je suis l\u2019assistant de la boutique. Posez-moi une question sur la livraison, les retours, les tailles ou le suivi de commande !',
      ph: '\u00c9crivez votre message\u2026',
      send: 'Envoyer',
      open: 'Ouvrir le chat',
      close: 'Fermer le chat',
      thinking: '…',
      err: 'Désolé, une erreur est survenue. Réessayez ou écrivez-nous à care@hannaandnour.com.',
      chips: ['Livraison & retours', 'Suivre ma commande', 'Y a-t-il un code promo ?']
    },
    en: {
      title: 'Hanna & Nour',
      sub: 'Assistant — instant answers',
      intro: 'Hello \uD83D\uDC4B I\u2019m the store assistant. Ask me anything about shipping, returns, sizes or order tracking!',
      ph: 'Type your message\u2026',
      send: 'Send',
      open: 'Open chat',
      close: 'Close chat',
      thinking: '…',
      err: 'Sorry, something went wrong. Please try again or email care@hannaandnour.com.',
      chips: ['Shipping & returns', 'Track my order', 'Is there a promo code?']
    },
    ar: {
      title: 'حنا ونور',
      sub: 'المساعد — رد فوري',
      intro: 'مرحبًا \uD83D\uDC4B أنا مساعد المتجر. اسأليني عن التوصيل أو الإرجاع أو المقاسات أو تتبع الطلب!',
      ph: 'اكتبي رسالتك\u2026',
      send: 'إرسال',
      open: 'فتح المحادثة',
      close: 'إغلاق المحادثة',
      thinking: '…',
      err: 'عذرًا، حدث خطأ ما. حاولي مجددًا أو راسلينا على care@hannaandnour.com.',
      chips: ['التوصيل والإرجاع', 'تتبع طلبي', 'هل يوجد كود خصم؟']
    }
  };

  function lang() {
    return (window.HN && typeof window.HN.lang === 'function') ? window.HN.lang() : 'fr';
  }
  function tr(key) {
    var d = UI[lang()] || UI.fr;
    return d[key] !== undefined ? d[key] : UI.fr[key];
  }
  function apiPath() {
    return (window.HN && typeof window.HN.api === 'function') ? window.HN.api('chat') : API + '/chat';
  }

  var root = null;
  var body, input, sendBtn, toggleBtn, chipsBox;
  var busy = false;

  function el(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  function open() {
    root.classList.add('hn-chat--open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    toggleBtn.setAttribute('aria-label', tr('close'));
    setTimeout(function () { input.focus(); }, 60);
  }
  function close() {
    root.classList.remove('hn-chat--open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-label', tr('open'));
  }

  function bubble(role, text, opts) {
    var row = el('div', 'hn-chat-msg hn-chat-msg--' + role, body);
    var txt = el('div', 'hn-chat-msg-txt', row);
    txt.textContent = text;
    if (opts && opts.links && opts.links.length) {
      var links = el('div', 'hn-chat-links', row);
      opts.links.forEach(function (l) {
        var a = document.createElement('a');
        a.className = 'hn-chat-link';
        a.textContent = l.text;
        if (/^(https?:|mailto:)/.test(l.url)) {
          a.href = l.url;
          a.target = '_blank';
          a.rel = 'noopener';
        } else {
          a.href = l.url;
        }
        links.appendChild(a);
      });
    }
    body.scrollTop = body.scrollHeight;
    return row;
  }

  function chips(items) {
    chipsBox.innerHTML = '';
    (items || []).slice(0, 4).forEach(function (q) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'hn-chat-chip';
      c.textContent = q;
      c.addEventListener('click', function () { send(q); });
      chipsBox.appendChild(c);
    });
  }

  function send(text) {
    var message = String(text || '').trim();
    if (!message || busy) return;
    input.value = '';
    chipsBox.innerHTML = '';
    bubble('user', message);
    busy = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('hn-chat-btn--wait');
    var thinking = bubble('bot', tr('thinking'));

    fetch(apiPath(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, lang: lang() })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    }).then(function (data) {
      thinking.textContent = '';
      var txt = el('div', 'hn-chat-msg-txt', thinking);
      txt.textContent = data.reply || '';
      if (data.links && data.links.length) {
        var links = el('div', 'hn-chat-links', thinking);
        data.links.forEach(function (l) {
          var a = document.createElement('a');
          a.className = 'hn-chat-link';
          a.textContent = l.text;
          if (/^(https?:|mailto:)/.test(l.url)) { a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; }
          else a.href = l.url;
          links.appendChild(a);
        });
      }
      body.scrollTop = body.scrollHeight;
      chips(data.suggestions || []);
    }).catch(function (err) {
      thinking.textContent = tr('err');
      chips([tr('chips')[0]]);
    }).then(function () {
      busy = false;
      sendBtn.disabled = false;
      sendBtn.classList.remove('hn-chat-btn--wait');
    });
  }

  function createDom() {
    if (!document.body) return;
    root = el('div', 'hn-chat');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', tr('title') + ' chat');

    var panel = el('div', 'hn-chat-panel', root);
    var head = el('div', 'hn-chat-head', panel);
    var titles = el('div', 'hn-chat-titles', head);
    el('div', 'hn-chat-title', titles).textContent = tr('title');
    el('div', 'hn-chat-sub', titles).textContent = tr('sub');
    var closeBtn = el('button', 'hn-chat-close', head);
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', tr('close'));
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    closeBtn.addEventListener('click', close);

    body = el('div', 'hn-chat-body', panel);
    body.setAttribute('aria-live', 'polite');

    chipsBox = el('div', 'hn-chat-chips', panel);

    var form = el('form', 'hn-chat-form', panel);
    input = el('input', 'hn-chat-input', form);
    input.type = 'text';
    input.placeholder = tr('ph');
    input.setAttribute('aria-label', tr('ph'));
    sendBtn = el('button', 'hn-chat-send', form);
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', tr('send'));
    sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';

    toggleBtn = el('button', 'hn-chat-toggle', root);
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-label', tr('open'));
    toggleBtn.innerHTML = '<svg class="hn-chat-toggle-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
    toggleBtn.addEventListener('click', function () {
      root.classList.contains('hn-chat--open') ? close() : open();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      send(input.value);
    });

    bubble('bot', tr('intro'));
    chips(tr('chips'));
    document.body.appendChild(root);
  }

  // Réexécute la langue si le visiteur change de langue en cours de page.
  if (window.HN && typeof window.HN.apply === 'function') {
    var _origApply = window.HN.apply;
    window.HN.apply = function () {
      _origApply.apply(window.HN, arguments);
      if (root) {
        root.setAttribute('aria-label', tr('title') + ' chat');
        input.placeholder = tr('ph');
        toggleBtn.setAttribute('aria-label', root.classList.contains('hn-chat--open') ? tr('close') : tr('open'));
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDom);
  } else {
    createDom();
  }

  window.__HN_CHAT__ = { open: open, close: close, send: send, tr: tr, lang: lang };
})();