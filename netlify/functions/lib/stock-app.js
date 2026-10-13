const { json } = require('../shared');
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const errors = {
  physical_invalid:[400,'Sélection ou paiement externe invalide.'],
  physical_config:[409,'Vérifiez la devise et la TVA dans les réglages admin.'],
  physical_unavailable:[409,'Une variante a été désactivée ou retirée du catalogue.'],
  physical_stock:[409,'Stock insuffisant. Actualisez le panier de vente.'],
  physical_quote_changed:[409,'Les prix, la TVA ou le stock ont changé. Recalculez puis confirmez le nouveau récapitulatif.'],
  physical_operation_mismatch:[409,'Cet identifiant correspond à une autre vente. Reprenez la tentative initiale.']
};
async function stockApp(sb, action, body) {
  try {
    if (action === 'listStockVariants') {
      const page = Number.isInteger(body.page) && body.page >= 1 && body.page <= 10000 ? body.page : 1;
      const {data,error,count} = await sb.from('product_variants').select('id,color,size,stock,active,barcode,products!inner(id,slug,name_fr,name_en,price_cents,active,catalog_deleted_at)',{count:'exact'}).eq('active',true).is('products.catalog_deleted_at',null).order('product_id').order('id').range((page-1)*20,page*20-1);
      if (error || !Number.isInteger(count)) throw error || new Error('Missing count');
      return json(200,{variants:data || [],total:count,page});
    }
    if (action === 'stockLookup') {
      if (!['barcode','qr'].includes(body.kind) || typeof body.code !== 'string') return json(400,{error:'Type de code invalide.'});
      if (body.kind === 'qr' ? !ID.test(body.code) : !/^[\x21-\x7e]{1,80}$/.test(body.code)) return json(400,{error:'Code invalide.'});
      const response = await sb.from('product_variants').select('id,color,size,stock,active,barcode,products(id,slug,name_fr,name_en,price_cents,active,catalog_deleted_at)').eq(body.kind === 'qr' ? 'id' : 'barcode',body.code).maybeSingle();
      if (response.error) throw response.error;
      if (!response.data) return json(404,{error:'Variante introuvable.'});
      return json(200,{variant:response.data});
    }
    if (action === 'listPhysicalSales') {
      const page = Number.isInteger(body.page) && body.page >= 1 && body.page <= 10000 ? body.page : 1;
      const {data,error,count} = await sb.from('orders').select('id,order_number,total_cents,currency,paid_at,external_payment_method,order_items(product_name,variant,quantity)',{count:'exact'}).eq('sale_channel','physical').order('paid_at',{ascending:false}).order('id').range((page-1)*20,page*20-1);
      if (error || !Number.isInteger(count)) throw error || new Error('Missing count');
      return json(200,{orders:data || [],total:count,page});
    }
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50 || body.items.some(i => !i || !ID.test(i.variant_id || '') || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 100) || new Set(body.items.map(i=>i.variant_id.toLowerCase())).size !== body.items.length) return json(400,{error:'Choisissez de 1 à 50 variantes avec une quantité entière de 1 à 100.'});
    const items = body.items.map(i=>({variant_id:i.variant_id.toLowerCase(),quantity:i.quantity})).sort((a,b)=>a.variant_id.localeCompare(b.variant_id));
    let result;
    if (action === 'quotePhysicalSale') result = await sb.rpc('quote_physical_sale',{p_items:items});
    else if (action === 'recordPhysicalSale') {
      if (!ID.test(body.operation_id || '') || body.confirmation !== 'ENCAISSE' || !['cash','card','other'].includes(body.payment_method) || typeof body.note !== 'string' || body.note.length > 300 || !body.quote || !Number.isInteger(body.quote.total_cents)) return json(400,{error:'Confirmez le montant réellement encaissé et le moyen de paiement.'});
      result = await sb.rpc('record_physical_sale',{p_operation:body.operation_id,p_items:items,p_quote:body.quote,p_method:body.payment_method,p_note:body.note});
    } else return json(400,{error:'Action inconnue.'});
    if (result.error) {
      const failure = errors[result.error.message];
      return failure ? json(failure[0],{error:failure[1],code:result.error.message}) : json(503,{error:'Résultat non confirmé. Réessayez exactement la même opération.'});
    }
    if (!result.data || (action === 'recordPhysicalSale' && (result.data.operation_id !== body.operation_id || result.data.total_cents !== body.quote.total_cents || result.data.currency !== body.quote.currency))) return json(503,{error:'Confirmation incomplète. Reprenez la même opération.'});
    return json(200,{result:result.data});
  } catch (error) { return json(503,{error:'Service indisponible. Une opération incertaine doit être reprise avec le même identifiant.'}); }
}
module.exports = { stockApp };
