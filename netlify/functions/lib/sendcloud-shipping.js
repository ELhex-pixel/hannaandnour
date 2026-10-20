const BASE='https://panel.sendcloud.sc/api/v3';
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const pickup=require('../../../public/js/pickup-points');
function error(){return new Error('Service d’expédition indisponible ou réponse non confirmée.');}
async function bytes(response,max){
  if(!response.body||Number(response.headers.get('content-length'))>max)throw error();
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const row=await reader.read();if(row.done)break;size+=row.value.byteLength;if(size>max)throw error();chunks.push(Buffer.from(row.value));}return Buffer.concat(chunks);}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function createShippingClient({env=process.env,fetchImpl=globalThis.fetch}={}){
  const publicKey=env.SENDCLOUD_PUBLIC_KEY,secret=env.SENDCLOUD_SECRET_KEY;
  async function request(method,path,{body,params,pdf=false}={}){
    if(typeof publicKey!=='string'||typeof secret!=='string'||!publicKey||!secret||publicKey.length>512||secret.length>512||/[\s:]/.test(publicKey)||/\s/.test(secret))throw error();
    const allowed=method==='GET'?/^\/(?:addresses\/sender-addresses(?:\/[1-9]\d*)?|shipments|parcels\/[1-9]\d*\/documents\/label)$/.test(path):method==='POST'&&['/shipping-options','/shipments/announce'].includes(path);
    if(!allowed)throw error();
    const url=new URL(BASE+path);Object.entries(params||{}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    let response;try{response=await fetchImpl(url.href,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000),headers:{Accept:pdf?'application/pdf':'application/json',Authorization:'Basic '+Buffer.from(publicKey+':'+secret).toString('base64'),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}catch{throw error();}
    if(!response.ok&&!(path==='/shipments/announce'&&response.status===409)){await response.body?.cancel().catch(()=>{});throw error();}
    const content=await bytes(response,pdf?3*1024*1024:2*1024*1024);
    if(pdf){if(!/^application\/pdf\b/i.test(response.headers.get('content-type')||'')||content.subarray(0,5).toString()!=='%PDF-')throw error();return content;}
    let value;try{value=JSON.parse(content.toString('utf8'));}catch{throw error();}
    if(!value||typeof value!=='object')throw error();
    return{data:Object.hasOwn(value,'data')?value.data:response.status===409?value:null,incomplete:/rel\s*=\s*"?next\b/i.test(response.headers.get('link')||'')};
  }
  async function senders(){const {data,incomplete}=await request('GET','/addresses/sender-addresses',{params:{page_size:100}});if(!Array.isArray(data))throw error();return{senders:data.filter(s=>Number.isSafeInteger(s.id)&&s.id>0&&s.country_code==='FR'&&pickup.postal('FR',s.postal_code)).map(s=>({id:s.id,name:s.company_name||s.name||'',address_line_1:s.address_line_1||'',house_number:s.house_number||'',city:s.city||'',postal_code:s.postal_code,country_code:'FR'})),incomplete};}
  async function sender(id){if(!Number.isSafeInteger(id)||id<1)throw error();const {data}=await request('GET','/addresses/sender-addresses/'+id);if(!data||data.id!==id||data.country_code!=='FR'||!pickup.postal('FR',data.postal_code)||!data.name||!data.address_line_1||!data.city)throw error();const result={};for(const name of ['name','company_name','address_line_1','house_number','address_line_2','postal_code','city','country_code','phone_number','email'])if(typeof data[name]==='string')result[name]=data[name];return result;}
  async function options(body){const {data}=await request('POST','/shipping-options',{body});if(!Array.isArray(data)||data.length>200)throw error();return data;}
  async function existing(operation){if(!ID.test(operation))throw error();const {data,incomplete}=await request('GET','/shipments',{params:{external_reference_id:'hn-label-'+operation,page_size:2}});if(!Array.isArray(data)||data.length>1||incomplete)throw error();if(data.length&&data[0].external_reference_id!=='hn-label-'+operation)throw error();return data[0]||null;}
  async function announce(body){if(!ID.test(String(body.external_reference_id||'').replace(/^hn-label-/,'')))throw error();return(await request('POST','/shipments/announce',{body})).data;}
  async function label(id,size){if(!Number.isSafeInteger(id)||id<1||!['A4','A6'].includes(size))throw error();return request('GET','/parcels/'+id+'/documents/label',{params:{paper_size:size,dpi:72},pdf:true});}
  return{senders,sender,options,existing,announce,label};
}
module.exports={createShippingClient};
