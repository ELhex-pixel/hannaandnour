/**
 * POST /api/chat
 * Chatbot de la boutique Hanna & Nour.
 *
 * Moteur : FAQ par règles multilingue (fr/en/ar) alimentée par les réglages
 * admin (tarifs de livraison, délai de retours, devises) ; si aucune règle ne
 * correspond, bascule automatiquement vers un LLM (OpenAI ou OpenRouter) dès
 * que OPENAI_API_KEY / OPENROUTER_API_KEY est configuré côté Netlify. Sans
 * clé, une réponse de repli oriente vers le contact — le bot reste utilisable.
 *
 * La clé API ne quitte jamais le serveur ; le client n'envoie que { message, lang }.
 */
const { json, getSupabase, isConfigured, readBody, getSetting } = require('./shared');

const CONTACT_EMAIL = 'care@hannaandnour.com';
const CONTACT_SUBJECT = encodeURIComponent('Question depuis le chat');
const SUPPORTED = ['fr', 'en', 'ar'];

// ---------- Helpers ----------

// Minuscules + suppression des accents (é->e) puis nettoyage (garde lettres
// latines, chiffres et lettres arabes). Les variantes arabes (أ/إ/آ -> ا,
// ة -> ه, ى -> ي, harakat/tatweel retirés) sont unifiées pour que
// "أين طلبي" matche le mot-clé "اين طلبي".
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u060C\u061B\u061F\u0640\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function moneyStr(cents, currency, lang) {
  const v = (parseInt(cents, 10) || 0) / 100;
  const amount = (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
  const sym = (currency && currency.symbol) || '$';
  if (lang === 'fr') return amount + ' ' + sym;
  if (lang === 'ar') return amount + ' ' + (sym === '$' ? 'دولارًا' : sym);
  return sym + amount;
}

// Coût du retrait en point relais, lu depuis les réglages admin (même source
// que le checkout : total affiché = total facturé).
function pickupCostStr(ctx) {
  const cents = parseInt(ctx.shipping.pickup_cents, 10) || 0;
  if (cents <= 0) {
    return ctx.lang === 'fr' ? 'gratuit' : ctx.lang === 'en' ? 'free' : 'مجاني';
  }
  return moneyStr(cents, ctx.currency, ctx.lang);
}

function settingsWithDefaults(row) {
  const base = {
    standard_cents: 699,
    express_cents: 1200,
    nextday_cents: 2500,
    pickup_cents: 0,
    free_threshold_cents: 7500,
    returns_days: 30,
    pickup_enabled: true
  };
  if (!row || typeof row !== 'object') return base;
  return Object.assign(base, row);
}

async function buildContext(sb) {
  const ctx = {
    lang: 'fr',
    shipping: settingsWithDefaults(null),
    currency: { code: 'usd', symbol: '$' },
    promo: null,
    products: []
  };
  try {
    const row = await getSetting(sb, 'shipping', null);
    ctx.shipping = settingsWithDefaults(row);
  } catch (e) { console.error('chat: shipping settings', e.message); }
  try {
    const cur = await getSetting(sb, 'currency', null);
    const code = String(cur && cur.code || '').toLowerCase();
    if (code === 'usd' || code === 'eur') ctx.currency = { code, symbol: code === 'eur' ? '\u20AC' : '$' };
  } catch (e) { /* keep default */ }
  try {
    const { data: promo } = await sb
      .from('promo_codes')
      .select('code, percent_off, active')
      .eq('code', 'WELCOME15')
      .maybeSingle();
    if (promo && promo.active) ctx.promo = promo;
  } catch (e) { /* table absente : pas de promo */ }
  try {
    const { data: products } = await sb
      .from('products')
      .select('slug, name_en, name_fr, price_cents')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(8);
    ctx.products = (products || []).map((p) => ({
      slug: p.slug,
      name_fr: p.name_fr || p.name_en || p.slug,
      name_en: p.name_en || p.name_fr || p.slug,
      price_cents: parseInt(p.price_cents, 10) || 0
    }));
  } catch (e) { /* catalogue indisponible */ }
  return ctx;
}

// ---------- FAQ par règles ----------

const link = (text, url) => ({ text, url });

const RULES = [
  {
    id: 'greeting',
    keywords: {
      fr: ['bonjour', 'salut', 'bonsoir', 'coucou', 'hello', 'salam', 'bienvenue', 'yo'],
      en: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'salam', 'welcome'],
      ar: ['مرحبا', 'اهلا', 'السلام', 'السلام عليكم', 'صباح الخير', 'مساء الخير']
    },
    reply: (ctx) => ({
      text: ctx.lang === 'fr'
        ? 'Bonjour \uD83D\uDC4B Bienvenue chez Hanna & Nour ! Je peux vous renseigner sur la livraison, les retours, les tailles, le suivi de commande ou nos codes promo. Que puis-je faire pour vous ?'
        : ctx.lang === 'en'
          ? 'Hello \uD83D\uDC4B Welcome to Hanna & Nour! I can help with shipping, returns, sizes, order tracking or promo codes. How can I help you today?'
          : 'مرحبًا \uD83D\uDC4B أهلاً بك في حنا ونور! يمكنني مساعدتك في التوصيل والإرجاع والمقاسات وتتبع الطلب أو رموز الخصم. كيف يمكنني مساعدتك؟'
    })
  },
  {
    id: 'free_shipping',
    keywords: {
      fr: ['livraison gratuite', 'livraison offerte', 'gratuite', 'franco'],
      en: ['free shipping', 'free delivery', 'shipping free'],
      ar: ['توصيل مجاني', 'شحن مجاني', 'التوصيل مجانا', 'الشحن مجاني']
    },
    reply: (ctx) => {
      const s = ctx.shipping;
      if (s.free_threshold_cents > 0) {
        const text = ctx.lang === 'fr'
          ? 'Livraison offerte d\u00e8s ' + moneyStr(s.free_threshold_cents, ctx.currency, 'fr') + ' d\u2019achat (hors retrait en point relais, factur\u00e9 \u00e0 part).'
          : ctx.lang === 'en'
            ? 'Free shipping on all orders over ' + moneyStr(s.free_threshold_cents, ctx.currency, 'en') + ' (relay-point pickup is billed separately).'
            : 'توصيل مجاني للطلبات التي تزيد عن ' + moneyStr(s.free_threshold_cents, ctx.currency, 'ar') + ' (الاستلام من نقطة التوصيل يُدفع بشكل منفصل).';
        return { text };
      }
      const text = ctx.lang === 'fr'
        ? 'Actuellement, la livraison est payante mais le seuil de gratuit\u00e9 peut \u00e9voluer : regardez le bandeau en haut du site.'
        : ctx.lang === 'en'
          ? 'At the moment standard shipping applies, keep an eye on the banner at the top of the site for free-shipping offers.'
          : 'حاليًا يشمل التوصيل رسومًا، لكن قد يتغير حد التوصيل المجاني: تابع الشريط أعلى الموقع.';
      return { text };
    }
  },
  {
    id: 'shipping',
    keywords: {
      fr: ['livraison', 'livrer', 'expedition', 'expedie', 'frais de port', 'mode de livraison', 'comment livrez'],
      en: ['shipping', 'deliver', 'delivery', 'postage', 'how do you ship'],
      ar: ['التوصيل', 'الشحن', 'توصيل', 'شحن', 'كيفية الشحن']
    },
    reply: (ctx) => {
      const s = ctx.shipping;
      const free = s.free_threshold_cents > 0;
      const text = ctx.lang === 'fr'
        ? 'Livraison \u2014 Standard : ' + moneyStr(s.standard_cents, ctx.currency, 'fr') + ' (5\u20137 jours ouvr\u00e9s)' +
          (s.express_cents > 0 ? ', Express : ' + moneyStr(s.express_cents, ctx.currency, 'fr') + ' (2\u20133 jours)' : '') +
          (s.nextday_cents > 0 ? ', Lendemain avant 21h : ' + moneyStr(s.nextday_cents, ctx.currency, 'fr') : '') +
          (free ? '. Et c\u2019est gratuit d\u00e8s ' + moneyStr(s.free_threshold_cents, ctx.currency, 'fr') + ' d\u2019achat !' : '.') +
          (s.pickup_enabled ? ' Retrait en point relais : ' + pickupCostStr(ctx) + '.' : '')
        : ctx.lang === 'en'
          ? 'Shipping \u2014 Standard: ' + moneyStr(s.standard_cents, ctx.currency, 'en') + ' (5\u20137 business days)' +
            (s.express_cents > 0 ? ', Express: ' + moneyStr(s.express_cents, ctx.currency, 'en') + ' (2\u20133 days)' : '') +
            (s.nextday_cents > 0 ? ', Next-day before 9pm: ' + moneyStr(s.nextday_cents, ctx.currency, 'en') : '') +
            (free ? '. And it\u2019s free on orders over ' + moneyStr(s.free_threshold_cents, ctx.currency, 'en') + '!' : '.') +
            (s.pickup_enabled ? ' Relay-point pickup: ' + pickupCostStr(ctx) + '.' : '')
          : 'التوصيل — العادي: ' + moneyStr(s.standard_cents, ctx.currency, 'ar') + ' (5–7 أيام عمل)' +
            (s.express_cents > 0 ? '، السريع: ' + moneyStr(s.express_cents, ctx.currency, 'ar') + ' (2–3 أيام)' : '') +
            (s.nextday_cents > 0 ? '، التوصيل في اليوم التالي قبل ٩ مساءً: ' + moneyStr(s.nextday_cents, ctx.currency, 'ar') : '') +
            (free ? '. والتوصيل مجاني للطلبات فوق ' + moneyStr(s.free_threshold_cents, ctx.currency, 'ar') + '!' : '.') +
            (s.pickup_enabled ? ' الاستلام من نقطة التوصيل: ' + pickupCostStr(ctx) + '.' : '');
      return { text, links: [link(ctx.lang === 'fr' ? 'Livraison & retours' : ctx.lang === 'en' ? 'Shipping & returns' : 'التوصيل والإرجاع', 'terms.html')] };
    }
  },
  {
    id: 'delivery_time',
    keywords: {
      fr: ['delai', 'delais', 'combien de temps', 'quand', 'arrive', 'recevoir ma commande', 'jours'],
      en: ['how long', 'when will', 'when do', 'arrive', 'take to arrive', 'business days'],
      ar: ['مدة', 'كم من الوقت', 'متى', 'يصل', 'وصول الطلب', 'أيام عمل']
    },
    reply: (ctx) => {
      const s = ctx.shipping;
      const text = ctx.lang === 'fr'
        ? 'D\u00e9lais indicatifs : Standard 5\u20137 jours ouvr\u00e9s, Express 2\u20133 jours, Lendemain avant 21h' +
          (s.pickup_enabled ? ' Retrait en point relais : pr\u00eat sous 24\u201348 h (vous \u00eates pr\u00e9venu par email).' : '.')
        : ctx.lang === 'en'
          ? 'Estimated times: Standard 5\u20137 business days, Express 2\u20133 days, Next-day before 9pm' +
            (s.pickup_enabled ? ' Relay-point pickup: ready within 24\u201348h (you\u2019ll get an email).' : '.')
          : 'المدد التقريبية: العادي 5–7 أيام عمل، السريع 2–3 أيام، اليوم التالي قبل ٩ مساءً' +
            (s.pickup_enabled ? ' الاستلام من نقطة التوصيل: جاهز خلال 24–48 ساعة (ستصلك رسالة).' : '.');
      return { text };
    }
  },
  {
    id: 'returns',
    keywords: {
      fr: ['retour', 'retours', 'remboursement', 'rembourse', 'echange', 'echanger'],
      en: ['return', 'returns', 'refund', 'refunded', 'exchange'],
      ar: ['إرجاع', 'استرجاع', 'استرداد', 'الارجاع', 'ارجاع', 'تبديل']
    },
    reply: (ctx) => {
      const days = parseInt(ctx.shipping.returns_days, 10) || 30;
      const text = ctx.lang === 'fr'
        ? 'Retours faciles sous ' + days + ' jours apr\u00e8s r\u00e9ception. \u00c9crivez-nous \u00e0 ' + CONTACT_EMAIL + ' avec votre num\u00e9ro de commande : nous vous envoyons la proc\u00e9dure et l\u2019\u00e9tiquette. Articles neufs, avec leurs \u00e9tiquettes. Remboursement d\u00e8s r\u00e9ception de l\u2019article.'
        : ctx.lang === 'en'
          ? 'Easy returns within ' + days + ' days of delivery. Email us at ' + CONTACT_EMAIL + ' with your order number and we\u2019ll send the steps and a return label. Items must be unused, with tags. Refund issued once we receive the item.'
          : 'إرجاع سهل خلال ' + days + ' يومًا من الاستلام. راسلنا على ' + CONTACT_EMAIL + ' مع رقم طلبك وسنرسل لك الخطوات وملصق الإرجاع. يجب أن تكون القطع جديدة مع البطاقات. يُرد المبلغ فور استلام القطعة.';
      return { text, links: [link(ctx.lang === 'fr' ? 'Livraison & retours' : ctx.lang === 'en' ? 'Shipping & returns' : 'التوصيل والإرجاع', 'terms.html'), link(ctx.lang === 'fr' ? 'Nous \u00e9crire' : ctx.lang === 'en' ? 'Email us' : 'راسلنا', 'mailto:' + CONTACT_EMAIL + '?subject=' + CONTACT_SUBJECT)] };
    }
  },
  {
    id: 'tracking',
    keywords: {
      fr: ['suivi', 'suivre ma commande', 'suivi de commande', 'ou est ma commande', 'tracabilite', 'numero de suivi', 'ma commande arrive'],
      en: ['tracking', 'track order', 'track my order', 'where is my order', 'order status', 'tracking number'],
      ar: ['تتبع', 'تتبع الطلب', 'حالة الطلب', 'اين طلبي', 'وين طلبي', 'رقم التتبع']
    },
    reply: (ctx) => {
      const text = ctx.lang === 'fr'
        ? 'Le suivi se fait depuis votre compte : connectez-vous sur la page Compte, rubrique \u00ab Mes commandes \u00bb. Vous recevez aussi un email d\u2019exp\u00e9dition avec le num\u00e9ro de suivi d\u00e8s que votre commande part. Besoin d\u2019aide ? ' + CONTACT_EMAIL
        : ctx.lang === 'en'
          ? 'Track your order from your account: sign in on the Account page, \u201cMy Orders\u201d section. You\u2019ll also receive a shipping email with the tracking number once your order ships. Need help? ' + CONTACT_EMAIL
          : 'يمكنك تتبع طلبك من حسابك: سجّل الدخول في صفحة الحساب، قسم «طلباتي». كما ستصلك رسالة شحن برقم التتبع فور إرسال طلبك. تحتاج مساعدة؟ ' + CONTACT_EMAIL;
      return { text, links: [link(ctx.lang === 'fr' ? 'Mon compte' : ctx.lang === 'en' ? 'My account' : 'حسابي', 'account.html')] };
    }
  },
  {
    id: 'sizes',
    keywords: {
      fr: ['taille', 'tailles', 'guide des tailles', 'mesure', 'quel taille', 'bien tailler', 'fit'],
      en: ['size', 'sizes', 'size guide', 'measurement', 'what size', 'fit'],
      ar: ['مقاس', 'المقاس', 'دليل المقاسات', 'قياس', 'ما المقاس', 'مقاسات']
    },
    reply: (ctx) => {
      const text = ctx.lang === 'fr'
        ? 'Chaque fiche produit pr\u00e9cise les mesures et la coupe. Notre guide des tailles est disponible sur la page Livraison & retours. En cas de doute, \u00e9crivez-nous : nous vous conseillerons la bonne taille.'
        : ctx.lang === 'en'
          ? 'Each product page lists measurements and fit. Our size guide is on the Shipping & Returns page. Not sure? Email us and we\u2019ll help you pick the right size.'
          : 'كل صفحة منتج توضح القياسات والقصّة. دليل المقاسات متاح في صفحة التوصيل والإرجاع. إن كنت مترددًا راسلنا وسنساعدك في اختيار المقاس المناسب.';
      return { text, links: [link(ctx.lang === 'fr' ? 'Guide des tailles' : ctx.lang === 'en' ? 'Size guide' : 'دليل المقاسات', 'terms.html')] };
    }
  },
  {
    id: 'payment',
    keywords: {
      fr: ['paiement', 'payer', 'moyen de paiement', 'carte', 'visa', 'mastercard', 'paypal', 'secur', 'klarna', 'apple pay'],
      en: ['payment', 'pay', 'card', 'visa', 'mastercard', 'paypal', 'secure', 'klarna', 'apple pay'],
      ar: ['الدفع', 'دفع', 'بطاقة', 'فيزا', 'ماستركارد', 'بايبال', 'امن', 'كلارنا', 'ابل باي']
    },
    reply: (ctx) => {
      const text = ctx.lang === 'fr'
        ? 'Paiement 100 % s\u00e9curis\u00e9 via Stripe : Visa, Mastercard, American Express, PayPal, Apple Pay et Klarna (paiement en 4 fois sans frais). Vos donn\u00e9es bancaires ne sont jamais stock\u00e9es sur le site.'
        : ctx.lang === 'en'
          ? '100% secure payments via Stripe: Visa, Mastercard, American Express, PayPal, Apple Pay and Klarna (pay in 4 interest-free installments). Your bank details are never stored on the site.'
          : 'دفع آمن 100% عبر Stripe: فيزا، ماستركارد، أمريكان إكسبريس، بايبال، أبل باي وكلارنا (ادفع على 4 دفعات بدون فوائد). بياناتك البنكية لا تُحفظ أبدًا في الموقع.';
      return { text };
    }
  },
  {
    id: 'promo',
    keywords: {
      fr: ['promo', 'promotion', 'code promo', 'code de reduction', 'coupon', 'reduction', 'welcome15', 'avoir', 'offre'],
      en: ['promo', 'promotion', 'promo code', 'discount', 'coupon', 'code', 'welcome15', 'deal', 'offer'],
      ar: ['خصم', 'كود', 'كوبون', 'تخفيض', 'عرض', 'كود خصم', 'ويس كام']
    },
    reply: (ctx) => {
      if (ctx.promo) {
        const text = ctx.lang === 'fr'
          ? 'Oui ! Utilisez le code ' + ctx.promo.code + ' \u00e0 la caisse pour ' + ctx.promo.percent_off + ' % de r\u00e9duction sur votre commande.'
          : ctx.lang === 'en'
            ? 'Yes! Use code ' + ctx.promo.code + ' at checkout to save ' + ctx.promo.percent_off + '% on your order.'
            : 'نعم! استخدم الكود ' + ctx.promo.code + ' عند الدفع للحصول على خصم ' + ctx.promo.percent_off + '٪ على طلبك.';
        return { text };
      }
      const text = ctx.lang === 'fr'
        ? 'Consultez la page Promotions : les codes actifs y sont list\u00e9s, et certaines offres s\u2019appliquent automatiquement au panier.'
        : ctx.lang === 'en'
          ? 'Check the Promotions page: active codes are listed there, and some offers apply automatically to your cart.'
          : 'تفقد صفحة العروض: الرموز النشطة مدرجة هناك، وبعض العروض تُطبق تلقائيًا على السلة.';
      return { text, links: [link(ctx.lang === 'fr' ? 'Promotions' : ctx.lang === 'en' ? 'Promotions' : 'العروض', 'shop.html')] };
    }
  },
  {
    id: 'pickup',
    keywords: {
      fr: ['retrait', 'point de retrait', 'point relais', 'relais', 'retirer en boutique', 'en boutique', 'magasin', 'boutique', 'point livraison', 'ou est votre magasin'],
      en: ['pickup', 'in-store', 'store pickup', 'relay point', 'pickup point', 'parcel', 'collect', 'shop location', 'where is your store'],
      ar: ['استلام', 'استلام من المتجر', 'نقطة التوصيل', 'نقطة استلام', 'نقطة', 'المتجر', 'عنوان المتجر']
    },
    reply: (ctx) => {
      if (!ctx.shipping.pickup_enabled) {
        const text = ctx.lang === 'fr'
          ? 'Le retrait n\u2019est pas propos\u00e9 pour le moment ; nous livrons \u00e0 domicile.'
          : ctx.lang === 'en'
            ? 'Pickup is not available right now; we deliver to your door.'
            : 'الاستلام غير متاح حاليًا؛ نوصّل إلى باب منزلك.';
        return { text };
      }
      const cost = pickupCostStr(ctx);
      const text = ctx.lang === 'fr'
        ? 'Nous n\u2019avons pas de boutique physique : nous livrons \u00e0 domicile et proposons le retrait en point relais. \u00c0 l\u2019\u00e9tape livraison, choisissez \u00ab Retrait \u2014 point relais \u00bb et indiquez le point de votre choix. Co\u00fbt : ' + cost + '.'
        : ctx.lang === 'en'
          ? 'We don\u2019t have a physical store: we ship to your door and offer relay-point pickup. At the delivery step, choose \u201cPickup \u2014 relay point\u201d and select your point. Cost: ' + cost + '.'
          : 'ليس لدينا متجر فعلي: نوصّل إلى باب منزلك ونوفر الاستلام من نقطة التوصيل. في خطوة التوصيل اختاري «استلام — نقطة التوصيل» وحددي النقطة. التكلفة: ' + cost + '.';
      return { text };
    }
  },
  {
    id: 'catalog',
    keywords: {
      fr: ['produit', 'produits', 'catalogue', 'collection', 'hijab', 'abaya', 'tenue de priere', 'robe', 'accessoire', 'que vendez', 'quoi'],
      en: ['product', 'products', 'catalog', 'collection', 'hijab', 'abaya', 'prayer wear', 'dress', 'accessory', 'what do you sell', 'what do you have'],
      ar: ['منتجات', 'المنتجات', 'كتالوج', 'مجموعة', 'حجاب', 'عباية', 'ثياب الصلاة', 'فستان', 'إكسسوارات', 'ماذا تبيعون', 'ماذا لديكم']
    },
    reply: (ctx) => {
      const text = ctx.lang === 'fr'
        ? 'Hanna & Nour, c\u2019est la mode modeste \u00e9l\u00e9gante pour femme : hijabs (soie, mousseline, coton premium), abayas, tenues de pri\u00e8re, robes et accessoires. D\u00e9couvrez nos collections !'
        : ctx.lang === 'en'
          ? 'Hanna & Nour is elegant modest fashion for women: hijabs (silk, chiffon, premium cotton), abayas, prayer wear, dresses and accessories. Explore our collections!'
          : 'حنا ونور هي أزياء محتشمة أنيقة للمرأة: حجابات (حرير، شيفون، قطن فاخر)، عباءات، ثياب صلاة، فساتين وإكسسوارات. اكتشفي مجموعاتنا!';
      return { text, links: [link(ctx.lang === 'fr' ? 'Boutique' : ctx.lang === 'en' ? 'Shop' : 'المتجر', 'shop.html'), link(ctx.lang === 'fr' ? 'Collections' : ctx.lang === 'en' ? 'Collections' : 'المجموعات', 'collections.html')] };
    }
  },
  {
    id: 'contact',
    keywords: {
      fr: ['contact', 'contacter', 'email', 'assistance', 'aide', 'joindre', 'parler a quelqu un', 'humain', 'equipe', 'envoyer un message'],
      en: ['contact', 'email', 'support', 'help', 'reach', 'human', 'agent', 'team', 'message'],
      ar: ['اتصال', 'تواصل', 'بريد', 'مساعدة', 'الدعم', 'موظف', 'فريق', 'رسالة']
    },
    reply: (ctx) => {
      const text = ctx.lang === 'fr'
        ? 'Notre \u00e9quipe vous r\u00e9pond en g\u00e9n\u00e9ral sous 24 h : ' + CONTACT_EMAIL + ' ou via le formulaire de contact. Pr\u00e9cisez votre num\u00e9ro de commande pour une r\u00e9ponse plus rapide.'
        : ctx.lang === 'en'
          ? 'Our team usually replies within 24h: ' + CONTACT_EMAIL + ' or via the contact form. Include your order number for a faster answer.'
          : 'فريقنا يرد عادة خلال 24 ساعة: ' + CONTACT_EMAIL + ' أو عبر نموذج الاتصال. أضف رقم طلبك للحصول على رد أسرع.';
      return { text, links: [link(ctx.lang === 'fr' ? 'Formulaire de contact' : ctx.lang === 'en' ? 'Contact form' : 'نموذج الاتصال', 'contact.html'), link('Email', 'mailto:' + CONTACT_EMAIL + '?subject=' + CONTACT_SUBJECT)] };
    }
  },
  {
    id: 'size_advice',
    keywords: {
      fr: ['que prendre', 'quelle taille prendre', 'lequel choisir'],
      en: ['which size', 'what should i order'],
      ar: ['أي مقاس اختار']
    },
    reply: (ctx) => {
      const text = ctx.lang === 'fr'
        ? 'En cas d\u2019h\u00e9sitation, prenez la taille au-dessus : nos coupes sont ajust\u00e9es. Et rappelez-vous, les \u00e9changes sont possibles sous ' + (parseInt(ctx.shipping.returns_days, 10) || 30) + ' jours. \u00c9crivez-nous avec vos mensurations, on vous oriente !'
        : ctx.lang === 'en'
          ? 'Between two sizes, size up: our cuts run fitted. And remember exchanges are possible within ' + (parseInt(ctx.shipping.returns_days, 10) || 30) + ' days. Send us your measurements and we\u2019ll point you the right way!'
          : 'بين مقاسين، اختاري الأكبر: قصّاتنا مضبوطة. وتذكري أن الاستبدال ممكن خلال ' + (parseInt(ctx.shipping.returns_days, 10) || 30) + ' يومًا. أرسلي لنا قياساتك وسنساعدك!';
      return { text };
    }
  },
  {
    id: 'end',
    keywords: {
      fr: ['non', 'c est tout', 'ca suffit', 'rien d autre', 'pas d autre question', 'aucune question'],
      en: ['no', 'nothing else', 'that s all', 'that is all', 'no more questions', 'i m done', 'no thanks'],
      ar: ['لا', 'لا شيء', 'لا مزيد', 'انتهى', 'مالي سؤال', 'خلاص']
    },
    reply: (ctx) => ({
      text: ctx.lang === 'fr'
        ? 'Avec plaisir ! Merci de votre visite chez Hanna & Nour, à bientôt ! \uD83D\uDE0A\n\nConversation terminée — notre équipe reste joignable à care@hannaandnour.com.'
        : ctx.lang === 'en'
          ? 'You\u2019re welcome! Thank you for visiting Hanna & Nour, see you soon! \uD83D\uDE0A\n\nConversation closed — our team remains reachable at care@hannaandnour.com.'
          : 'على الرحب والسعة! شكرًا لزيارتك حنا ونور، إلى اللقاء! \uD83D\uDE0A\n\nانتهت المحادثة — فريقنا يبقى متاحًا على care@hannaandnour.com.'
    })
  },
  {
    id: 'thanks',
    keywords: {
      fr: ['merci', 'merci beaucoup'],
      en: ['thank', 'thanks', 'thank you'],
      ar: ['شكرا', 'شكرًا', 'جزاك الله', 'تسلم']
    },
    reply: (ctx) => ({
      text: ctx.lang === 'fr'
        ? 'Avec plaisir ! Si vous avez d\u2019autres questions, je suis l\u00e0. \uD83D\uDE0A'
        : ctx.lang === 'en'
          ? 'You\u2019re welcome! If you have any other questions, I\u2019m here. \uD83D\uDE0A'
          : 'على الرحب والسعة! إن كان لديك أي سؤال آخر، أنا هنا. \uD83D\uDE0A'
    })
  },
  {
    id: 'affirm',
    keywords: {
      fr: ['oui', 'd accord', 'daccord', 'oka', 'tres bien', 'bien sur', 'vas y', 'dac'],
      en: ['yes', 'yeah', 'yep', 'sure', 'ok', 'of course', 'go ahead'],
      ar: ['نعم', 'ايوه', 'اكيد', 'حسنا', 'طيب', 'بالتاكيد', 'تمام']
    },
    reply: (ctx) => ({
      text: ctx.lang === 'fr'
        ? 'Tr\u00e8s bien — allez-y, quelle est votre question ? \uD83D\uDE0A'
        : ctx.lang === 'en'
          ? 'Great — go ahead, what\u2019s your question? \uD83D\uDE0A'
          : 'حسنًا — تفضل، ما هو سؤالك؟ \uD83D\uDE0A'
    })
  }
];

// Question de suivi ajoutée après chaque réponse utile (pas après l'accueil,
// la clôture ou une confirmation).
const FOLLOW_UP = {
  fr: 'Une autre question ? R\u00e9pondez oui ou non.',
  en: 'Any other question? Answer yes or no.',
  ar: 'هل لديك سؤال آخر؟ أجب بنعم أو لا.'
};

// Suggestions de suivi par règle + langue.
const SUGGESTIONS = {
  shipping: { fr: ['Quels sont les délais ?', 'Le retrait est-il gratuit ?'], en: ['How long does delivery take?', 'Is pickup free?'], ar: ['كم تستغرق مدة التوصيل؟', 'هل الاستلام مجاني؟'] },
  returns: { fr: ['Dans quel délai puis-je retourner ?', 'Comment suivre mon remboursement ?'], en: ['How long do I have to return?', 'How do I track my refund?'], ar: ['كم مدة الإرجاع؟', 'كيف أتابع رد المبلغ؟'] },
  tracking: { fr: ['Où est ma commande ?', 'Quel est mon numéro de suivi ?'], en: ['Where is my order?', 'What is my tracking number?'], ar: ['أين طلبي؟', 'ما هو رقم التتبع؟'] },
  sizes: { fr: ['Quelle taille prendre ?', 'Puis-je échanger ?'], en: ['Which size should I take?', 'Can I exchange?'], ar: ['أي مقاس أناسب؟', 'هل يمكن الاستبدال؟'] },
  payment: { fr: ['Quels moyens de paiement ?', 'Le paiement est-il sécurisé ?'], en: ['Which payment methods?', 'Is payment secure?'], ar: ['ما وسائل الدفع؟', 'هل الدفع آمن؟'] },
  promo: { fr: ['Y a-t-il un code promo ?', 'Comment appliquer un code ?'], en: ['Is there a promo code?', 'How do I apply a code?'], ar: ['هل يوجد كود خصم؟', 'كيف أطبق الكود؟'] },
  pickup: { fr: ['Combien co\u00fbte le point relais ?', 'O\u00f9 puis-je retirer ma commande ?'], en: ['How much is relay-point pickup?', 'Where can I collect my order?'], ar: ['كم تكلف نقطة التوصيل؟', 'أين أستلم طلبي؟'] },
  contact: { fr: ['Quelle est votre adresse email ?', 'Parler à un conseiller'], en: ['What is your email?', 'Talk to an agent'], ar: ['ما هو بريدكم؟', 'التحدث مع موظف'] },
  catalog: { fr: ['Que vendez-vous ?', 'Voir la collection'], en: ['What do you sell?', 'See the collection'], ar: ['ماذا تبيعون؟', 'مشاهدة المجموعة'] },
  greeting: { fr: ['Quels sont les délais de livraison ?', 'Comment faire un retour ?', 'Suivre ma commande'], en: ['Shipping times?', 'How do returns work?', 'Track my order'], ar: ['مدد التوصيل؟', 'كيف يتم الإرجاع؟', 'تتبع طلبي'] },
  free_shipping: { fr: ['Combien pour la livraison gratuite ?'], en: ['What is the free-shipping threshold?'], ar: ['ما حد التوصيل المجاني؟'] },
  delivery_time: { fr: ['Livraison express, c\u2019est quoi ?'], en: ['What is express delivery?'], ar: ['ما هو التوصيل السريع؟'] },
  thanks: { fr: ['Quels sont les délais ?'], en: ['What are the delays?'], ar: ['ما هي المدد؟'] },
  size_advice: { fr: ['Quelle taille prendre ?'], en: ['Which size?'], ar: ['أي مقاس؟'] }
};

const GENERIC_SUGGESTIONS = {
  fr: ['Quels sont les délais de livraison ?', 'Comment faire un retour ?', 'Suivre ma commande'],
  en: ['What are the shipping times?', 'How do returns work?', 'Track my order'],
  ar: ['ما هي مدد التوصيل؟', 'كيف يتم الإرجاع؟', 'تتبع طلبي']
};

function matchCount(message, list) {
  let n = 0;
  for (const kw of list) {
    if (!kw) continue;
    const nk = normalize(kw);
    if (!nk) continue;
    // Mot-clé latin : frontière de mot, sinon "hi" matcherait "shipping".
    if (/^[a-z0-9 ]+$/.test(nk)) {
      const esc = nk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])').test(message)) n++;
    } else if (message.indexOf(nk) >= 0) {
      n++;
    }
  }
  return n;
}

// Trouve la meilleure règle pour le message (toutes langues confondues).
function findRule(rawMessage) {
  const message = normalize(rawMessage);
  if (!message) return null;
  let best = null;
  let bestScore = 0;
  for (const rule of RULES) {
    let score = 0;
    for (const lng of SUPPORTED) {
      score += matchCount(message, rule.keywords[lng] || []);
    }
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }
  return bestScore > 0 ? { rule: best, score: bestScore } : null;
}

// Construit la réponse complète d'une règle : texte final (avec la question de
// suivi « Une autre question ? » après chaque réponse utile), source, id,
// liens et suggestions. Renvoie null si aucune règle ne correspond.
function answer(rawMessage, ctx) {
  const found = findRule(rawMessage);
  if (!found) return null;
  const id = found.rule.id;
  const res = found.rule.reply(ctx);
  let reply = res.text;
  let source = 'faq';
  let suggestions = (SUGGESTIONS[id] && SUGGESTIONS[id][ctx.lang]) || GENERIC_SUGGESTIONS[ctx.lang];
  if (id === 'end') {
    source = 'end';
    suggestions = [];
  } else if (id !== 'greeting' && id !== 'affirm') {
    reply = reply + '\n\n' + FOLLOW_UP[ctx.lang];
  }
  return { reply, source, id, links: res.links || [], suggestions };
}

function fallbackReply(lang) {
  if (lang === 'en') {
    return 'I\u2019m sorry, I don\u2019t have the answer to that one. For anything specific, our team replies within 24h at ' + CONTACT_EMAIL + ' \u2014 or browse the FAQ on the Contact page.';
  }
  if (lang === 'ar') {
    return 'آسف، لا أملك إجابة عن هذا السؤال. لأي استفسار محدد، فريقنا يرد خلال 24 ساعة على ' + CONTACT_EMAIL + ' — أو تصفحي الأسئلة الشائعة في صفحة الاتصال.';
  }
  return 'D\u00e9sol\u00e9, je n\u2019ai pas la r\u00e9ponse \u00e0 cette question. Pour toute demande pr\u00e9cise, notre \u00e9quipe r\u00e9pond sous 24 h \u00e0 ' + CONTACT_EMAIL + ' \u2014 ou consultez la FAQ sur la page Contact.';
}

// ---------- LLM (optionnel : OpenAI ou OpenRouter) ----------

function systemPrompt(ctx) {
  const s = ctx.shipping;
  const cur = ctx.currency;
  const std = moneyStr(s.standard_cents, cur, ctx.lang);
  const exp = moneyStr(s.express_cents, cur, ctx.lang);
  const next = moneyStr(s.nextday_cents, cur, ctx.lang);
  const free = moneyStr(s.free_threshold_cents, cur, ctx.lang);
  const days = parseInt(s.returns_days, 10) || 30;
  const promo = ctx.promo ? 'Code ' + ctx.promo.code + ' = ' + ctx.promo.percent_off + '% de réduction.' : 'Aucun code actif pour le moment.';
  const products = ctx.products.map((p) => (ctx.lang === 'fr' ? p.name_fr : p.name_en) + ' — ' + moneyStr(p.price_cents, cur, ctx.lang)).join(' ; ') || 'N/A';
  const lines = [
    'Tu es l\u2019assistant de la boutique en ligne Hanna & Nour (mode modeste pour femme : hijabs, abayas, tenues de prière, robes, accessoires). Site : hannanour.netlify.app. Paiement sécurisé via Stripe (Visa, Mastercard, Amex, PayPal, Apple Pay, Klarna).',
    'Livraison : standard ' + std + ' (5–7 j ouvrés), express ' + exp + ' (2–3 j), lendemain avant 21h ' + next + (s.pickup_enabled ? ', retrait gratuit en boutique.' : '.'),
    'Livraison gratuite dès ' + free + '.',
    'Retours sous ' + days + ' jours : ' + CONTACT_EMAIL + '.',
    'Promo : ' + promo,
    'Produits (aprox.) : ' + products,
    'Réponds en ' + (ctx.lang === 'fr' ? 'français' : ctx.lang === 'en' ? 'English' : 'العربية') + ', en texte brut (pas de markdown, pas d\u2019émojis de mise en forme), maximum 120 mots, ton chaleureux. Si tu ne sais pas, oriente vers ' + CONTACT_EMAIL + '.'
  ];
  return lines.join('\n');
}

async function askAI(message, ctx) {
  const openAiKey = process.env.OPENAI_API_KEY;
  const routerKey = process.env.OPENROUTER_API_KEY;
  if (!openAiKey && !routerKey) return null;

  const url = openAiKey
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://openrouter.ai/api/v1/chat/completions';
  const payload = {
    model: openAiKey
      ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
      : (process.env.OPENROUTER_MODEL || 'auto'),
    messages: [
      { role: 'system', content: systemPrompt(ctx) },
      { role: 'user', content: message }
    ],
    max_tokens: 250,
    temperature: 0.4
  };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (openAiKey || routerKey),
        ...(routerKey ? { 'HTTP-Referer': 'https://hannanour.netlify.app', 'X-Title': 'Hanna & Nour Chat' } : {})
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) {
      console.error('chat: LLM error', res.status);
      return null;
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const reply = String(content || '').trim();
    return reply.length >= 2 ? reply : null;
  } catch (e) {
    console.error('chat: LLM failed:', e.message);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- Handler ----------

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = readBody(event);
    const message = String(body.message || '').trim().slice(0, 600);
    const lang = SUPPORTED.indexOf(body.lang) >= 0 ? body.lang : 'fr';
    if (!message) {
      return json(400, { error: 'message is required' });
    }
    if (!isConfigured()) {
      return json(503, { error: 'Supabase is not configured' });
    }
    const sb = getSupabase();
    const ctx = await buildContext(sb);
    ctx.lang = lang;

    const ans = answer(message, ctx);
    if (ans) {
      return json(200, ans);
    }

    const ai = await askAI(message, ctx);
    if (ai) {
      return json(200, { reply: ai + '\n\n' + FOLLOW_UP[lang], source: 'ai', suggestions: GENERIC_SUGGESTIONS[lang] });
    }

    return json(200, {
      reply: fallbackReply(lang) + '\n\n' + FOLLOW_UP[lang],
      source: 'fallback',
      suggestions: GENERIC_SUGGESTIONS[lang],
      links: [link(lang === 'fr' ? 'Nous contacter' : lang === 'en' ? 'Contact us' : 'اتصل بنا', 'contact.html')]
    });
  } catch (err) {
    console.error('chat.js error:', err);
    return json(500, { error: err.message || 'Internal error' });
  }
};

// Exposé pour les tests unitaires (jamais appelé en prod).
exports._chat = { normalize, findRule, answer, fallbackReply, GENERIC_SUGGESTIONS, FOLLOW_UP, askAI };