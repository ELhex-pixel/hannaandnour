// Read the complete active catalogue, never infer filters from one product page.
// Only public facet fields are read; a partial/failed read is not an empty list.
const {publicRead,queryResult}=require('./public-read');
async function catalogFacets(sb){
  return publicRead('catalog_facets',async signal=>{
    const rows=[];let total=null;
    for(let offset=0;offset<2000;offset+=500){
      const result=queryResult(await sb.from('products')
        .select('id,category,sizes,occasions,price_cents',{count:'exact'})
        .eq('active',true).is('catalog_deleted_at',null).order('id')
        .range(offset,offset+499).abortSignal(signal));
      if(!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count<0||result.count>2000||(total!==null&&total!==result.count))throw Error('Incomplete facets');
      total=result.count;rows.push(...result.data);
      if(rows.length===total)break;
      if(result.data.length!==500||offset===1500)throw Error('Incomplete facets');
    }
    if(rows.length!==total||new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Incomplete facets');
    const values={categories:new Set(),sizes:new Set(),occasions:new Set()};let min=null,max=null;
    for(const row of rows){
      if(typeof row.category!=='string'||!row.category.trim()||!Array.isArray(row.sizes)||!Array.isArray(row.occasions)||!Number.isSafeInteger(row.price_cents)||row.price_cents<1)throw Error('Invalid facets');
      values.categories.add(row.category.trim());
      for(const field of ['sizes','occasions'])for(const value of row[field]){
        if(typeof value!=='string'||value.length>80)throw Error('Invalid facet value');
        if(value.trim())values[field].add(value.trim());
      }
      min=min===null?row.price_cents:Math.min(min,row.price_cents);max=max===null?row.price_cents:Math.max(max,row.price_cents);
    }
    return{categories:[...values.categories].sort(),sizes:[...values.sizes].sort(),occasions:[...values.occasions].sort(),min_price_cents:min,max_price_cents:max,total};
  });
}
module.exports={catalogFacets};
