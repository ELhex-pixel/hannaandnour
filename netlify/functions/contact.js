/**
 * POST /api/contact
 * Public contact form: stores the message in `contact_messages` (admin inbox)
 * and, as best-effort, forwards it by email to the store address when Resend is
 * configured (RECIPIENT: process.env.CONTACT_EMAIL, default care@hannaandnour.com).
 */
const { json, getSupabase, isConfigured, readBody, sendEmail } = require('./shared');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = readBody(event);

    const name = String(body.name || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().slice(0, 200);
    const subject = String(body.subject || '').trim().slice(0, 200);
    const message = String(body.message || '').trim().slice(0, 10000);

    if (!name || !email || !message) {
      return json(400, { error: 'name, email and message are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'Invalid email' });
    }

    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }
    const sb = getSupabase();

    const { data: row, error } = await sb
      .from('contact_messages')
      .insert({ name, email, subject: subject || null, message })
      .select('id')
      .single();
    if (error) throw error;

    // Best-effort email notification to the store. Resend sandbox only delivers
    // to the account's registered email; a verified domain is required for the
    // real recipient.
    try {
      await sendEmail({
        to: process.env.CONTACT_EMAIL || 'care@hannaandnour.com',
        subject: 'Nouveau message du site : ' + (subject || '(sans objet)'),
        html:
          '<p><strong>De :</strong> ' +
          name.replace(/</g, '&lt;') +
          ' &lt;' + email.replace(/</g, '&lt;') + '&gt;</p>' +
          '<p><strong>Sujet :</strong> ' + (subject || '') + '</p>' +
          '<p><strong>Message :</strong></p><p>' + message.replace(/\n/g, '<br>') + '</p>'
      });
    } catch (mailErr) {
      console.error('Contact email forward failed:', mailErr.message);
    }

    return json(200, { ok: true, id: row.id });
  } catch (err) {
    console.error('contact.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};