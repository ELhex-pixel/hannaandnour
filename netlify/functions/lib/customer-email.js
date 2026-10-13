// Customer-facing mail only. Order language is saved in Stripe metadata;
// old orders without this metadata retain French. No financial data is changed.
const SUPPORTED = ['fr', 'en', 'ar'];
const colors = require('../../../public/js/colors');
const sizes = require('../../../public/js/product-sizes');
const locale = value => SUPPORTED.includes(value) ? value : 'fr';
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const isolate = value => '<span dir="ltr" style="direction:ltr;unicode-bidi:isolate;display:inline-block;">' + esc(value) + '</span>';
const COPY = {
  fr: {
    brand:'Hanna & Nour', hello:'Bonjour', thanks:'Merci de votre confiance.', question:'Une question ? Répondez simplement à cet email.', account:'Mon compte', number:'Numéro de commande', subtotal:'Sous-total', discount:'Remise', shipping:'Livraison', tax:'Taxe', total:'Total', address:'Adresse de livraison', pickup:'Point relais', standard:'Standard', express:'Express', next_day:'Le lendemain',
    paidTitle:'Commande confirmée', paidText:'Votre paiement a bien été accepté. Voici le récapitulatif de votre commande.',
    shippedTitle:'Votre commande est expédiée !', shippedText:'Votre commande a quitté notre atelier.', tracking:'Numéro de suivi',
    reviewTitle:'Votre commande est livrée, merci !', reviewText:'Votre avis aide les autres à choisir. Notez vos articles en quelques étoiles et quelques mots.', reviewButton:'Donner mon avis sur',
    cancelTitle:'Votre commande a été annulée', cancelText:'Nous sommes navrés de ne pas pouvoir confirmer votre commande.', defective:'Un article s’est révélé défectueux.', out_of_stock:'Un article n’est plus disponible.', other:'Une indisponibilité imprévue est survenue.', refunded:'Le remboursement de votre paiement a déjà été lancé.', refundPending:'Si un paiement a été effectué, celui-ci vous sera intégralement remboursé dans les plus brefs délais.',
    refundTitle:'Remboursement confirmé', refundText:'Un remboursement a été confirmé pour votre commande.', refundDelay:'Le délai d’apparition dépend de votre moyen de paiement.',
    cartTitle:'Votre panier vous attend', cartText:'Vous avez commencé une commande qui n’a pas encore été finalisée. Reprenez où vous en étiez.', cartButton:'Reprendre mon panier',
    pendingTitle:'Rappel : votre commande est en attente de règlement', pendingText:'Votre commande est toujours en attente de paiement. Si vous l’avez déjà réglée, ignorez ce message.', pendingButton:'Finaliser ma commande', restoreInfo:'Ce lien personnel permet de reprendre votre panier pendant 72 heures après sa création. Les prix et disponibilités seront vérifiés à nouveau.',
    recoveryTitle:'Réinitialiser votre mot de passe', recoveryText:'Vous avez demandé un nouveau mot de passe pour votre compte.', recoveryButton:'Choisir un nouveau mot de passe', recoveryInfo:'Ce lien est temporaire et à usage unique. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.',
    claimTitle:'Confirmation de vos commandes', claimText:'Votre code de confirmation', claimInfo:'Il expire dans 10 minutes. Ne le partagez pas.'
  },
  en: {
    brand:'Hanna & Nour', hello:'Hello', thanks:'Thank you for your trust.', question:'Any questions? Simply reply to this email.', account:'My account', number:'Order number', subtotal:'Subtotal', discount:'Discount', shipping:'Shipping', tax:'Tax', total:'Total', address:'Shipping address', pickup:'Pickup point', standard:'Standard', express:'Express', next_day:'Next day',
    paidTitle:'Order confirmed', paidText:'Your payment has been accepted. Here is your order summary.',
    shippedTitle:'Your order has shipped!', shippedText:'Your order has left our workshop.', tracking:'Tracking number',
    reviewTitle:'Your order has arrived, thank you!', reviewText:'Your review helps others choose. Rate your items with a few stars and a few words.', reviewButton:'Review',
    cancelTitle:'Your order has been cancelled', cancelText:'We are sorry that we cannot confirm your order.', defective:'An item was found to be defective.', out_of_stock:'An item is no longer available.', other:'An unexpected availability issue occurred.', refunded:'Your payment refund has already been initiated.', refundPending:'If a payment was made, it will be fully refunded as soon as possible.',
    refundTitle:'Refund confirmed', refundText:'A refund has been confirmed for your order.', refundDelay:'The time it takes to appear depends on your payment method.',
    cartTitle:'Your cart is waiting', cartText:'You started an order that has not been completed. Pick up where you left off.', cartButton:'Return to my cart',
    pendingTitle:'Reminder: your order is awaiting payment', pendingText:'Your order is still awaiting payment. If you have already paid, ignore this message.', pendingButton:'Complete my order', restoreInfo:'This personal link restores your cart for 72 hours after it was created. Prices and availability will be checked again.',
    recoveryTitle:'Reset your password', recoveryText:'You requested a new password for your account.', recoveryButton:'Choose a new password', recoveryInfo:'This link is temporary and can only be used once. If you did not request this, ignore this email: your password will remain unchanged.',
    claimTitle:'Confirm your orders', claimText:'Your confirmation code', claimInfo:'It expires in 10 minutes. Do not share it.'
  },
  ar: {
    brand:'هناء و نور', hello:'مرحباً', thanks:'شكراً لثقتكم بنا.', question:'هل لديكم سؤال؟ يمكنكم الرد مباشرة على هذا البريد الإلكتروني.', account:'حسابي', number:'رقم الطلب', subtotal:'المجموع الفرعي', discount:'الخصم', shipping:'التوصيل', tax:'الضريبة', total:'المجموع', address:'عنوان التوصيل', pickup:'نقطة الاستلام', standard:'عادي', express:'سريع', next_day:'اليوم التالي',
    paidTitle:'تم تأكيد الطلب', paidText:'تم قبول دفعتكم بنجاح. إليكم ملخص طلبكم.',
    shippedTitle:'تم شحن طلبكم!', shippedText:'غادر طلبكم ورشتنا وهو في طريقه إليكم.', tracking:'رقم التتبع',
    reviewTitle:'تم توصيل طلبكم، شكراً لكم!', reviewText:'يساعد تقييمكم الآخرين على الاختيار. قيّموا المنتجات ببضع نجوم وكلمات.', reviewButton:'تقييم',
    cancelTitle:'تم إلغاء طلبكم', cancelText:'نعتذر لعدم تمكننا من تأكيد طلبكم.', defective:'تبيّن وجود عيب في أحد المنتجات.', out_of_stock:'لم يعد أحد المنتجات متوفراً.', other:'حدثت مشكلة غير متوقعة في توفر المنتجات.', refunded:'تم البدء بالفعل في استرداد دفعتكم.', refundPending:'إذا تم الدفع، فسيتم استرداد المبلغ كاملاً في أقرب وقت ممكن.',
    refundTitle:'تم تأكيد استرداد المبلغ', refundText:'تم تأكيد استرداد مبلغ لطلبكم.', refundDelay:'يعتمد موعد ظهور المبلغ على وسيلة الدفع المستخدمة.',
    cartTitle:'سلة التسوق بانتظاركم', cartText:'بدأتم طلباً لم يكتمل بعد. يمكنكم متابعة التسوق من حيث توقفتم.', cartButton:'العودة إلى سلة التسوق',
    pendingTitle:'تذكير: طلبكم بانتظار الدفع', pendingText:'لا يزال طلبكم بانتظار الدفع. إذا كنتم قد دفعتم بالفعل، فتجاهلوا هذه الرسالة.', pendingButton:'إكمال الطلب', restoreInfo:'يتيح هذا الرابط الشخصي استعادة سلتكم خلال 72 ساعة من إنشائها. سيتم التحقق من الأسعار والتوفر مجدداً.',
    recoveryTitle:'إعادة تعيين كلمة المرور', recoveryText:'طلبتم كلمة مرور جديدة لحسابكم.', recoveryButton:'اختيار كلمة مرور جديدة', recoveryInfo:'هذا الرابط مؤقت ويُستخدم مرة واحدة فقط. إذا لم تطلبوا ذلك، فتجاهلوا هذه الرسالة؛ ستبقى كلمة المرور دون تغيير.',
    claimTitle:'تأكيد طلباتكم', claimText:'رمز التأكيد الخاص بكم', claimInfo:'تنتهي صلاحيته خلال 10 دقائق. لا تشاركوه مع أحد.'
  }
};

async function orderLocale(order, session, retrieve) {
  function fromSession(value) {
    return value && value.metadata && value.metadata.order_id === order.id && SUPPORTED.includes(value.metadata.lang) ? value.metadata.lang : null;
  }
  const current = fromSession(session);
  if (current) return current;
  if (!order.stripe_session_id || !process.env.STRIPE_SECRET_KEY) return 'fr';
  try {
    const fetchSession = retrieve || (id => {
      const Stripe = require('stripe');
      return new Stripe(process.env.STRIPE_SECRET_KEY, { timeout:5000, maxNetworkRetries:0 }).checkout.sessions.retrieve(id);
    });
    return fromSession(await fetchSession(order.stripe_session_id)) || 'fr';
  } catch (error) { console.error('Customer email language unavailable'); return 'fr'; }
}

function message(type, lang, data = {}) {
  lang = locale(lang);
  const c = COPY[lang], order = data.order || {}, origin = data.siteUrl || 'https://hannanour.com';
  const p = value => '<p style="line-height:1.7;">' + value + '</p>';
  const link = (href, label) => '<a href="' + esc(href) + '" style="display:inline-block;padding:12px 20px;background:#9b753e;color:#fff;border-radius:12px;text-decoration:none;">' + esc(label) + '</a>';
  const account = origin + '/' + lang + '/account.html';
  const money = cents => isolate((Number(cents || 0) / 100).toFixed(2) + ' ' + String(order.currency || 'usd').toUpperCase());
  let body = '', title = c[type + 'Title'];
  if (!title) throw new Error('Unknown customer email');
  if (order.customer_name) body += p(esc(c.hello) + ' <bdi>' + esc(order.customer_name) + '</bdi>,');
  if (order.order_number) body += p(esc(c.number) + ' : <strong>' + isolate(order.order_number) + '</strong>');
  if (type === 'paid') {
    body += p(esc(c.paidText));
    const rows = (data.items || []).map(it => {
      const variant = String(it.variant || '').split(' / ').map(value => sizes.unique(value) ? { fr:'Taille unique', en:'One Size', ar:'مقاس واحد' }[lang] : colors.label(value, lang)).join(' / ');
      let image = '';
      try { const url = new URL(it.image, origin + '/'); if (it.image && url.protocol === 'https:') image = '<img src="' + esc(url.href) + '" alt="" width="52" height="70" style="border-radius:8px;object-fit:cover;vertical-align:middle;"> '; } catch (error) {}
      return '<tr><td style="padding:10px 0;border-bottom:1px solid #efe7d8;">' + image + '<bdi>' + esc(it.product_name) + '</bdi>' + (variant ? '<br><bdi>' + esc(variant) + '</bdi>' : '') + ' × ' + esc(it.quantity) + '</td><td style="padding:10px;white-space:nowrap;">' + money(it.unit_price_cents * it.quantity, order.currency) + '</td></tr>';
    }).join('');
    body += '<table dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '" style="width:100%;border-collapse:collapse;">' + rows;
    const total = (label, amount) => '<tr><td style="padding:6px 0;">' + esc(label) + '</td><td style="padding:6px 10px;">' + amount + '</td></tr>';
    body += total(c.subtotal, money(order.subtotal_cents));
    if (order.discount_cents > 0) body += total(c.discount, '−' + money(order.discount_cents)) + (order.promo_code ? '<tr><td colspan="2">' + isolate(order.promo_code) + '</td></tr>' : '');
    body += total(c.shipping + ' (' + (c[order.shipping_method] || c.standard) + ')', money(order.shipping_cents));
    if (order.tax_cents > 0) body += total(c.tax, money(order.tax_cents));
    body += total(c.total, '<strong>' + money(order.total_cents) + '</strong>') + '</table>';
    const address = order.delivery_type === 'pickup' ? [c.pickup, order.pickup_point] : [order.address1, order.address2, order.postal_code, order.city, order.state, order.country];
    body += p('<strong>' + esc(c.address) + '</strong><br>' + address.filter(Boolean).map(value => '<bdi>' + esc(value) + '</bdi>').join('<br>') + (order.phone ? '<br>' + isolate(order.phone) : ''));
  } else if (type === 'shipped') {
    body += p(esc(c.shippedText));
    if (data.tracking) body += p(esc(c.tracking) + ' : ' + isolate(data.tracking));
    body += p(link(account, c.account));
  } else if (type === 'review') {
    body += p(esc(c.reviewText));
    for (const item of data.items || []) if (item.product_slug) body += p(link(origin + '/' + lang + '/review.html?slug=' + encodeURIComponent(item.product_slug) + '&order=' + encodeURIComponent(order.order_number), c.reviewButton + ' ' + (item.product_name || '')));
    body += p(link(account, c.account));
  } else if (type === 'cancel') {
    body += p(esc(c.cancelText)) + p(esc(c[data.reason] || c.other));
    if (data.comment) body += p('<bdi>' + esc(data.comment) + '</bdi>');
    body += p(esc(data.refunded ? c.refunded : c.refundPending));
  } else if (type === 'refund') {
    body += p(esc(c.refundText) + ' <strong>' + isolate((data.amount_cents / 100).toFixed(2) + ' ' + String(data.currency).toUpperCase()) + '</strong>') + p(esc(c.refundDelay));
  } else if (type === 'cart' || type === 'pending') {
    body += p(esc(c[type + 'Text'])) + p(link(origin + '/' + lang + '/cart.html?restore=' + encodeURIComponent(order.cart_restore_token), c[type + 'Button'])) + p(esc(c.restoreInfo));
  } else if (type === 'recovery') {
    body += p(esc(c.recoveryText)) + p(link(data.href, c.recoveryButton)) + p(esc(c.recoveryInfo));
  } else if (type === 'claim') {
    body += p(esc(c.claimText) + ' : <strong>' + isolate(data.code) + '</strong>') + p(esc(c.claimInfo));
  }
  body += p(esc(c.thanks)) + p(esc(c.question));
  return {
    subject: title + (order.order_number ? ' — ' + order.order_number : '') + ' — ' + c.brand,
    html: '<!doctype html><html lang="' + lang + '" dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '"><head><meta charset="utf-8"></head><body style="margin:0;background:#f6f1e8;padding:24px;"><div lang="' + lang + '" dir="' + (lang === 'ar' ? 'rtl' : 'ltr') + '" style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px;font-family:Arial,Tahoma,sans-serif;color:#221f1a;text-align:' + (lang === 'ar' ? 'right' : 'left') + ';"><h1 style="font-size:22px;color:#9b753e;">' + esc(c.brand) + '</h1><h2 style="font-size:20px;">' + esc(title) + '</h2>' + body + '</div></body></html>'
  };
}
module.exports = { locale, orderLocale, message };
