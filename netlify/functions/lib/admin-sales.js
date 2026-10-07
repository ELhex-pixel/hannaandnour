const { json, getSetting } = require('../shared');

function salesReport(orders, products, period, threshold, currency, now = new Date()) {
  const days = { d30:30,d90:90,y1:365,all:0 };
  const since = days[period] ? now.getTime()-days[period]*86400000 : 0;
  const monthly = Array.from({ length:12 },(_,index) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11+index,1));
    const key = d.toISOString().slice(0,7);
    return { key,label:key,revenueCents:0,refundedCents:0,unitsSold:0,returnedUnits:0 };
  });
  const totals = { orders:0,unitsSold:0,returnedUnits:0,revenueCents:0,refundedCents:0,returnedCents:0,stockTotal:0,lowStock:0,managedProducts:0,marginKnownCents:0,marginMissingUnits:0,marginKnownUnits:0 };
  const rows = new Map();
  const rowFor = (slug,name) => {
    if (!rows.has(slug)) rows.set(slug,{ slug,name,image:null,stock:null,low:false,sold:0,returned:0,revenueCents:0,returnedCents:0,marginKnownCents:0,marginMissingUnits:0 });
    return rows.get(slug);
  };
  for (const p of products) {
    const row = rowFor(p.slug,p.name_fr || p.name_en || p.slug);
    row.image = p.image;
    const variants = (p.product_variants || []).filter(v => v.active && p.active !== false);
    if ((p.product_variants || []).length) {
      row.stock = variants.reduce((sum,v) => sum+v.stock,0);
      row.low = variants.length > 0 && row.stock <= threshold;
      totals.stockTotal += row.stock;
      totals.managedProducts++;
      if (row.low) totals.lowStock++;
    }
  }
  const excludedCurrencies = new Set();
  for (const order of orders) {
    const date = Date.parse(order.paid_at);
    if (!Number.isFinite(date)) continue;
    if (order.currency !== currency.code) { if (date >= since) excludedCurrencies.add(order.currency); continue; }
    const b = monthly.find(m => m.key === order.paid_at.slice(0,7));
    const returns = order.order_returns || [];
    if (b) { b.revenueCents += order.total_cents; b.refundedCents += order.refunded_cents || 0; b.returnedUnits += returns.reduce((sum,r) => sum+r.quantity,0); }
    if (date < since) {
      if (b) b.unitsSold += (order.order_items || []).reduce((sum,i) => sum+i.quantity,0);
      continue;
    }
    totals.orders++;
    totals.revenueCents += order.total_cents;
    totals.refundedCents += order.refunded_cents || 0;
    for (const item of order.order_items || []) {
      const row = rowFor(item.product_slug,item.product_name || item.product_slug);
      const returned = returns.filter(r => r.order_item_id === item.id);
      const qty = returned.reduce((sum,r) => sum+r.quantity,0);
      const returnValue = returned.reduce((sum,r) => sum+r.total_refund_cents,0);
      const net = item.net_total_cents == null ? Math.round(item.unit_price_cents*item.quantity*Math.max(0,order.subtotal_cents-order.discount_cents)/Math.max(1,order.subtotal_cents)) : item.net_total_cents;
      row.sold += item.quantity; row.returned += qty; row.revenueCents += net; row.returnedCents += returnValue;
      totals.unitsSold += item.quantity; totals.returnedUnits += qty; totals.returnedCents += returnValue;
      if (b) b.unitsSold += item.quantity;
      const cost = Array.isArray(item.order_item_costs) ? item.order_item_costs[0] : item.order_item_costs;
      const unknown = !cost || cost.unit_cost_cents == null || cost.currency !== order.currency || (order.refunded_cents || 0) > 0 || order.status !== 'paid' || returned.some(r => r.sellable_quantity == null);
      if (unknown) { row.marginMissingUnits += item.quantity; totals.marginMissingUnits += item.quantity; }
      else {
        const restocked = returned.reduce((sum,r) => sum+r.sellable_quantity,0);
        const margin = net-returnValue-cost.unit_cost_cents*(item.quantity-restocked);
        row.marginKnownCents += margin; totals.marginKnownCents += margin; totals.marginKnownUnits += item.quantity;
      }
    }
  }
  totals.netRevenueCents = totals.revenueCents-totals.refundedCents;
  totals.netUnits = totals.unitsSold-totals.returnedUnits;
  totals.marginCents = totals.marginMissingUnits || !totals.unitsSold ? null : totals.marginKnownCents;
  for (const row of rows.values()) row.marginCents = row.marginMissingUnits || !row.sold ? null : row.marginKnownCents;
  return { period,threshold,currency,totals,products:[...rows.values()].sort((a,b) => b.sold-a.sold),monthly,excluded_currencies:[...excludedCurrencies] };
}

async function adminSales(sb,body) {
  const period = ['d30','d90','y1','all'].includes(body.period) ? body.period : 'd30';
  const threshold = Number.isInteger(body.threshold) && body.threshold >= 0 ? Math.min(body.threshold,1000000) : 5;
  const stored = await getSetting(sb,'currency',null) || { code:'usd' };
  const code = ['eur','usd'].includes(body.currency) ? body.currency : stored.code;
  const currency = { code,symbol:code === 'eur' ? '€' : '$' };
  const orders = [], products = [];
  let limited = false;
  for (let offset=0; offset<20000; offset+=500) {
    const { data,error } = await sb.from('orders').select('id,status,total_cents,subtotal_cents,discount_cents,refunded_cents,paid_at,currency,order_items(id,product_slug,product_name,unit_price_cents,net_total_cents,quantity,order_item_costs(unit_cost_cents,currency)),order_returns(order_item_id,quantity,total_refund_cents,sellable_quantity)').not('paid_at','is',null).in('status',['paid','refunded','cancelled']).order('paid_at',{ ascending:false }).order('id').range(offset,offset+499);
    if (error) throw error;
    orders.push(...(data || []));
    if ((data || []).length < 500) break;
    if (offset === 19500) limited = true;
  }
  for (let offset=0; offset<10000; offset+=500) {
    const { data,error } = await sb.from('products').select('slug,name_en,name_fr,image,active,product_variants(id,stock,active)').order('id').range(offset,offset+499);
    if (error) throw error;
    products.push(...(data || []));
    if ((data || []).length < 500) break;
    if (offset === 9500) limited = true;
  }
  return json(200,{ ...salesReport(orders,products,period,threshold,currency),limited });
}
module.exports = { salesReport,adminSales };
