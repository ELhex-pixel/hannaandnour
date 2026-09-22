/**
 * Contact form (contact.html): submits the message to the Netlify function,
 * which stores it in Supabase (seen in the /admin "Messages" tab) and forwards
 * it by email as best-effort.
 */
(function () {
  'use strict';

  var HN = window.HN;
  if (!HN) return;
  var tr = HN.tr;

  var form = document.getElementById('contactForm');
  if (!form) return;
  var btn = document.getElementById('contactSubmitBtn');
  var statusEl = document.getElementById('contactStatus');

  function setStatus(msg, isErr) {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = isErr ? 'var(--color-burgundy)' : 'var(--color-emerald)';
    }
    if (window.hnToast) hnToast(msg, '', isErr ? 'error' : 'success');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var name = document.getElementById('cName').value.trim();
    var email = document.getElementById('cEmail').value.trim();
    var subject = document.getElementById('cSubject').value.trim();
    var message = document.getElementById('cMessage').value.trim();

    if (!name || !email || !message) {
      setStatus(tr('contactRequired'), true);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus(tr('contactInvalidEmail'), true);
      return;
    }

    btn.disabled = true;
    fetch(HN.api('contact'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, subject: subject, message: message })
    })
      .then(function (res) {
        return res.json().then(function (d) { return { status: res.status, data: d }; });
      })
      .then(function (out) {
        if (out.status === 200) {
          setStatus(tr('contactOk'), false);
          form.reset();
        } else {
          throw new Error(out.data.error || 'contact failed');
        }
      })
      .catch(function (err) {
        setStatus(tr('contactErr'), true);
      })
      .finally(function () { btn.disabled = false; });
  });
})();