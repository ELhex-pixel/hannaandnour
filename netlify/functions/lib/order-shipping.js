const {json}=require('../shared');
const {createHash,createHmac,timingSafeEqual}=require('crypto');
const parcelRules=require('../../../public/js/shipping-parcel');
const pickupRules=require('../../../public/js/pickup-points');
const {createShippingClient}=require('./sendcloud-shipping');
const {createClient}=require('./sendcloud');
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
function sign(value,secret){if(!secret)throw new Error('Missing server configuration');return createHmac('sha256',secret).update(canonical(value)).digest('hex');}
function signed(quote,signature,secret){if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))return false;return timingSafeEqual(Buffer.from(signature),Buffer.from(sign(quote,secret)));}
function problem(code,message,status=409){return Object.assign(new Error(message),{shipping:true,code,status});}
function money(value){const text=String(value);if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;const [whole,fraction='']=text.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));return Number.isSafeInteger(cents)&&cents>=0&&cents<=100000000?cents:null;}
function eligible(g){return !!g&&g.status==='paid'&&g.sale_channel==='online'&&g.shipping_status==='new'&&!!g.prepared_at&&g.refunded_cents===0&&!g.stock_issue&&!g.inventory_reserved&&!g.admin_archived&&!g.refund_busy&&!g.tracking_number&&(!g.carrier||g.carrier==='mondialrelay')&&g.return_count===0&&typeof g.customer_name==='string'&&!!g.customer_name.trim()&&typeof g.phone==='string'&&!!g.phone.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g.email||'')&&Number.isSafeInteger(g.total_cents)&&g.total_cents>=0&&g.delivery_type==='pickup'&&g.pickup_point_data&&pickupRules.selection({id:g.pickup_point_data.id,country_code:g.pickup_point_data.address?.country_code,fingerprint:g.pickup_point_data.fingerprint})&&g.currency==='eur'&&Array.isArray(g.items)&&g.items.length>0&&g.items.every(i=>i.quantity>0&&i.quantity===i.prepared_quantity&&i.stock_debited===true);}
function options(rows,parcel,type){
  const result=[],seen=new Set();
  for(const row of rows){
    const f=row.functionalities,r=row.requirements;
    if(row.carrier?.code!=='mondial_relay'||typeof row.code!=='string'||!row.code.startsWith('mondial_relay:')||row.code.length>240||typeof row.name!=='string'||row.name.length>200||!Number.isSafeInteger(row.contract?.id)||row.contract.id<1||!f||f.returns!==false||f.labelless!==false||f.form_factor!=='parcel'||!['dropoff','pickup_dropoff'].includes(f.first_mile)||!(type==='locker'?['locker','locker_or_service_point']:['service_point','locker_or_service_point']).includes(f.last_mile)||!r||r.export_documents!==false||!Array.isArray(r.fields)||r.fields.some(field=>!['to_email','to_telephone','length','width','height'].includes(field))||row.quote_error||!Array.isArray(row.quotes))continue;
    const quotes=row.quotes.filter(q=>{
      if(!q.weight?.min||!q.weight?.max)return row.quotes.length===1;
      const min=Number(q.weight.min.value),max=Number(q.weight.max.value);return q.weight.min.unit==='kg'&&q.weight.max.unit==='kg'&&Number.isFinite(min)&&Number.isFinite(max)&&parcel.weight_g/1000>=min&&parcel.weight_g/1000<max;
    });
    if(quotes.length!==1||quotes[0].price?.total?.currency!=='EUR')continue;
    const cents=money(quotes[0].price.total.value),key=row.code+'|'+row.contract.id;
    if(cents===null||seen.has(key))continue;seen.add(key);result.push({code:row.code,name:row.name,contract_id:row.contract.id,price_cents:cents,currency:'EUR',last_mile:f.last_mile});
  }
  return result.slice(0,40);
}
function recipient(g){const p=g.pickup_point_data.address;return{name:g.customer_name,address_line_1:p.street,house_number:p.house_number||'',postal_code:p.postal_code,city:p.city,country_code:p.country_code,email:g.email,phone_number:g.phone};}
function optionBody(g,sender,parcel){
  function address(value){return{country_code:value.country_code,postal_code:value.postal_code,city:value.city,address_line_1:[value.house_number,value.address_line_1].filter(Boolean).join(' ')};}
  const measured=parcelRules.provider(parcel);
  return{from_address:address(sender),to_address:address(recipient(g)),to_service_point:{id:String(g.pickup_point_data.id)},parcels:[{weight:measured.weight,dimensions:measured.dimensions}],carrier_code:'mondial_relay',calculate_quotes:true};
}
function summary(row){return row?{id:row.id,order_id:row.order_id,state:row.state,request:row.request,result:row.result||null}:null;}
function normalize(value){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');}
function shipmentResult(shipment,record){
  const request=record.provider_request,quote=record.request.quote;
  if(!shipment||typeof shipment.id!=='string'||!ID.test(shipment.id)||shipment.external_reference_id!==request.external_reference_id||shipment.order_number!==request.order_number||shipment.ship_with?.properties?.shipping_option_code!==request.ship_with.properties.shipping_option_code||shipment.ship_with.properties.contract_id!==request.ship_with.properties.contract_id||shipment.carrier?.code!=='mondial_relay'||String(shipment.to_service_point?.id)!==request.to_service_point.id||!Array.isArray(shipment.parcels)||shipment.parcels.length!==1)throw new Error('Unconfirmed shipment identity');
  for(const address of ['from_address','to_address'])for(const field of ['name','address_line_1','house_number','postal_code','city','country_code']){
    const clean=value=>field==='postal_code'?normalize(value).replace(/\s/g,''):normalize(value);
    if(clean(shipment[address]?.[field])!==clean(request[address][field]))throw new Error('Unconfirmed shipment address');
  }
  if(shipment.total_order_price?.currency!=='EUR'||money(shipment.total_order_price.value)!==money(request.total_order_price.value))throw new Error('Unconfirmed shipment value');
  const p=shipment.parcels[0],wanted=request.parcels[0];
  if(!Number.isSafeInteger(p.id)||p.id<1||p.weight?.unit!=='kg'||Number(p.weight.value)!==Number(wanted.weight.value)||p.dimensions?.unit!=='cm'||['length','width','height'].some(k=>Number(p.dimensions[k])!==Number(wanted.dimensions[k])))throw new Error('Unconfirmed parcel');
  const result={operation_id:record.id,shipment_id:shipment.id,parcel_id:p.id,estimate_cents:quote.option.price_cents,currency:'EUR',tracking_number:typeof p.tracking_number==='string'?p.tracking_number.slice(0,150):''};
  if(p.status?.code==='ANNOUNCEMENT_FAILED')return{...result,state:'failed'};
  if(p.status?.code==='CANCELLED'||!Array.isArray(shipment.errors)||shipment.errors.length||!Number.isFinite(Date.parse(p.announced_at))||!result.tracking_number||!Array.isArray(p.documents)||!p.documents.some(d=>d.document_type==='label'||d.type==='label'))throw new Error('Shipment not announced');
  return{...result,state:'ready'};
}
async function adminOrderShipping(sb,action,body,{client=createShippingClient(),pickupClient=createClient(),secret=process.env.ADMIN_PASSWORD,now=()=>Date.now()}={}){
  let recorded=false;
  try{
    if(!ID.test(body.order_id||''))throw problem('shipping_invalid','Commande invalide.',400);
    async function guard(){const{data,error}=await sb.rpc('shipping_order_guard',{p_order:body.order_id});if(error||!data)throw new Error('Order unavailable');return data;}
    async function active(){const{data,error}=await sb.from('order_shipping_operations').select('*').eq('order_id',body.order_id).in('state',['pending','ready']).order('created_at',{ascending:false}).limit(1);if(error||!Array.isArray(data))throw new Error('Shipping journal unavailable');return data[0]||null;}
    async function checkedPoint(g){const p=g.pickup_point_data,checked=await pickupClient.verifyCheckoutPoint({id:p.id,country_code:p.address.country_code,fingerprint:p.fingerprint});if(!checked.point)throw problem('shipping_quote_changed','Le relais doit être vérifié à nouveau avant l’affranchissement.');}
    async function selected(g,sender,q){const available=options(await client.options(optionBody(g,sender,q.parcel)),q.parcel,g.pickup_point_data.type);return available.find(row=>canonical(row)===canonical(q.option));}
    if(action==='getOrderShipping'){
      const g=await guard(),operation=await active();
      const senders=operation||!eligible(g)?{senders:[],incomplete:false}:await client.senders();
      return json(200,{eligible:eligible(g),order_number:g.order_number,point:g.pickup_point_data?{name:g.pickup_point_data.name,address:g.pickup_point_data.address}:null,...senders,operation:summary(operation)});
    }
    if(action==='downloadOrderShippingLabel'){
      const operation=await active();if(!operation||operation.state!=='ready'||!operation.result)throw problem('shipping_label_unavailable','Étiquette non disponible.');
      const pdf=await client.label(operation.result.parcel_id,body.paper_size==='A4'?'A4':'A6');
      return json(200,{pdf_base64:pdf.toString('base64'),filename:'etiquette-'+body.order_id+'.pdf'});
    }
    if(action==='quoteOrderShipping'){
      if(!parcelRules.valid(body.parcel)||!Number.isSafeInteger(body.sender_id)||body.sender_id<1)throw problem('shipping_invalid','Renseignez l’expéditeur, le poids et les trois dimensions du colis.',400);
      const parcel=Object.fromEntries(['packaging','weight_g','length_mm','width_mm','height_mm'].map(key=>[key,body.parcel[key]]));
      if(await active())throw problem('shipping_order_busy','Une étiquette existe ou reste à confirmer pour cette commande.');
      const g=await guard();if(!eligible(g))throw problem('shipping_order_unavailable','La commande doit être payée, contrôlée dans Préparer les colis et sans retour ou remboursement en cours.');
      const sender=await client.sender(body.sender_id);await checkedPoint(g);
      const available=options(await client.options(optionBody(g,sender,parcel)),parcel,g.pickup_point_data.type),expires=new Date(now()+10*60000).toISOString();
      return json(200,{options:available.map(option=>{const quote={order_id:body.order_id,sender_id:body.sender_id,parcel,option,guard_hash:hash(g),sender_hash:hash(sender),expires_at:expires};return{quote,signature:sign(quote,secret)};})});
    }
    if(action!=='createOrderShipping'||!ID.test(body.operation_id||'')||body.confirmation!=='CREER_ETIQUETTE'||!body.quote||body.quote.order_id!==body.order_id)throw problem('shipping_invalid','Confirmez le service et le tarif de l’étiquette.',400);
    const id=body.operation_id.toLowerCase(),request={quote:body.quote,signature:body.signature,confirmation:body.confirmation};
    const old=await sb.from('order_shipping_operations').select('*').eq('id',id).maybeSingle();if(old.error)throw new Error('Journal unavailable');
    let record=old.data,fresh=false;
    if(record){recorded=true;if(record.order_id!==body.order_id||canonical(record.request)!==canonical(request))throw problem('shipping_operation_mismatch','Reprenez le contenu initial de cette demande.');}
    else{
      const q=body.quote;if(!parcelRules.valid(q.parcel)||!signed(q,body.signature,secret)||!Number.isFinite(Date.parse(q.expires_at))||Date.parse(q.expires_at)<now())throw problem('shipping_quote_changed','Le devis a expiré ou changé. Recalculez les services.');
      const g=await guard();if(!eligible(g))throw problem('shipping_order_unavailable','La commande n’est plus disponible pour cet affranchissement.');
      if(hash(g)!==q.guard_hash)throw problem('shipping_quote_changed','La commande a changé. Recalculez les services.');
      const sender=await client.sender(q.sender_id);if(hash(sender)!==q.sender_hash)throw problem('shipping_quote_changed','L’expéditeur a changé. Recalculez les services.');
      await checkedPoint(g);if(!await selected(g,sender,q))throw problem('shipping_quote_changed','Le service ou son tarif a changé. Recalculez et confirmez.');
      const payload={from_address:sender,to_address:recipient(g),to_service_point:{id:String(g.pickup_point_data.id)},ship_with:{type:'shipping_option_code',properties:{shipping_option_code:q.option.code,contract_id:q.option.contract_id}},order_number:g.order_number,total_order_price:{value:(g.total_cents/100).toFixed(2),currency:'EUR'},external_reference_id:'hn-label-'+id,parcels:[parcelRules.provider(q.parcel)],label_details:{mime_type:'application/pdf',dpi:72}};
      const claimed=await sb.rpc('claim_order_shipping',{p_id:id,p_order:body.order_id,p_request:request,p_provider_request:payload,p_guard:g});
      if(claimed.error){if(['shipping_quote_changed','shipping_order_busy','shipping_order_unavailable'].includes(claimed.error.message))throw problem(claimed.error.message,'La commande ou sa préparation a changé. Actualisez avant de confirmer.');throw new Error('Claim unavailable');}
      record=claimed.data;if(!record||record.id!==id)throw new Error('Claim unconfirmed');recorded=true;fresh=true;
    }
    if(record.state!=='pending')return json(200,{operation:summary(record)});
    let shipment=await client.existing(id);
    if(!shipment){
      if(!fresh){const g=await guard();if(!eligible(g)||hash(g)!==record.request.quote.guard_hash||Date.parse(record.request.quote.expires_at)<now())throw new Error('Reconciliation required');await checkedPoint(g);if(!await selected(g,record.provider_request.from_address,record.request.quote))throw new Error('Price requires reconciliation');}
      shipment=await client.announce(record.provider_request);
    }
    const result=shipmentResult(shipment,record),finished=await sb.rpc('finish_order_shipping',{p_id:id,p_result:result});
    if(finished.error||!finished.data||finished.data.id!==id||!['ready','failed'].includes(finished.data.state))throw new Error('Confirmation unavailable');
    return json(200,{operation:summary(finished.data)});
  }catch(error){
    if(error.shipping&&(!recorded||error.code==='shipping_operation_mismatch'))return json(error.status,{code:error.code,error:error.message});
    return json(503,{code:recorded?'shipping_pending':'shipping_unavailable',error:recorded?'Résultat non confirmé. Vérifiez ou réessayez la même demande, sans créer une nouvelle étiquette.':'Services d’expédition indisponibles. Actualisez pour réessayer.'});
  }
}
module.exports={adminOrderShipping,canonical,hash,sign,options,eligible,shipmentResult};
