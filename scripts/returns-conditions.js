const conditions = require('../public/js/returns-conditions');
const { publicRead, queryResult } = require('../netlify/functions/lib/public-read');

async function loadReturnsPolicy(sb) {
  if (!sb) return null;
  const result = await publicRead('returns_conditions', async signal => queryResult(await sb.from('settings').select('value').eq('key','return_policy').limit(1).abortSignal(signal)));
  const policy = result.data?.[0]?.value;
  if (!conditions.validPolicy(policy)) throw new Error('Publication bloquée : les conditions de retour nécessitent une politique valide enregistrée dans la boutique.');
  return { days:policy.days,withdrawal_payer:policy.withdrawal_payer,fault_payer:'store' };
}

function renderReturnsPage($, policy, lang) {
  const c = conditions.copy(lang), section = $('#returnConditions');
  section.html(conditions.render(policy,lang));
  if (conditions.validPolicy(policy)) section.attr({'data-policy-days':policy.days,'data-policy-payer':policy.withdrawal_payer});
  else section.removeAttr('data-policy-days data-policy-payer');
  $('h1.page-header-title').text(c.title);
  $('.page-header-breadcrumb span').last().text(c.title);
  $('title').text(c.title+' | '+(lang==='ar'?'هناء و نور':'Hanna & Nour'));
  $('meta[name="description"]').attr('content',c.description);
}

module.exports = {loadReturnsPolicy,renderReturnsPage};
