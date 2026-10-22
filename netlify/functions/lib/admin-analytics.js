const { json } = require('../shared');
const activity = require('./activity-periods');
const { internalPath } = require('./analytics-path');
const DAY = 86400000;
function canonicalPath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 2000) return '(page non renseignée)';
  try {
    const url = new URL(raw,'https://hannanour.com');
    if (url.origin !== 'https://hannanour.com') return '(page non renseignée)';
    let route = url.pathname, lang = route.match(/^\/(fr|en|ar)(?=\/)/)?.[1] || 'fr';
    route = route.replace(/^\/(fr|en|ar)(?=\/)/,'');
    if (route === '/') route = '/index.html';
    else if (/^\/(index|shop|collections|product|blog|blog-post|about|account|cart|checkout|success|contact|terms|privacy|size-guide|review|reset)(?:\.html)?\/?$/.test(route)) route = route.replace(/(?:\.html)?\/?$/,'.html');
    else if (/^\/(products|articles)\/[a-z0-9_-]+(?:\.html)?\/?$/.test(route)) route = route.replace(/(?:\.html)?\/?$/,'.html');
    else return url.pathname;
    return '/' + lang + route;
  } catch (error) { return '(page non renseignée)'; }
}
function summarize(events, now = Date.now(), reporting) {
  const summary = {};
  for (const [period,days] of [['all',0],['d7',7],['d30',30]]) {
    const counts = {pageview:0,product_view:0,add_to_cart:0,checkout_attempt:0,purchase:0};
    const products = new Map(), paths = new Map();
    for (const event of events) {
      if (event.event_type !== 'purchase' && internalPath(event.path)) continue;
      const date = Date.parse(event.created_at);
      if (!activity.includes(event.created_at,reporting)) continue;
      if (!Number.isFinite(date) || date > now || (days && date < now-days*DAY)) continue;
      if (Object.hasOwn(counts,event.event_type)) counts[event.event_type]++;
      if (event.event_type === 'product_view' && event.product_slug) products.set(event.product_slug,(products.get(event.product_slug)||0)+1);
      if (event.event_type === 'pageview') { const key=canonicalPath(event.path); paths.set(key,(paths.get(key)||0)+1); }
    }
    function top(values,key) { return [...values].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10).map(([name,views])=>({[key]:name,views})); }
    summary[period] = {counts,topProducts:top(products,'slug'),topPaths:top(paths,'path')};
  }
  return summary;
}
async function adminAnalytics(sb,body={}) {
  try {
    const reporting=await activity.reportingWindow(sb,body);
    const events = []; let limited = false;
    for (let offset=0;!reporting.empty&&offset<20000;offset+=1000) {
      const query=sb.from('analytics_events').select('id,event_type,product_slug,path,created_at');
      const {data,error}=await activity.constrain(query,'created_at',reporting).order('created_at',{ascending:false}).order('id').range(offset,offset+999);
      if (error) throw error;
      events.push(...(data||[]));
      if ((data||[]).length<1000) break;
      if (offset===19000) limited=true;
    }
    return json(200,{summary:summarize(events,Date.now(),reporting),limited,reporting});
  } catch (error) { return activity.failure(error)||json(503,{error:'Statistiques des visites indisponibles. Réessayez.'}); }
}
module.exports={canonicalPath,summarize,adminAnalytics};
