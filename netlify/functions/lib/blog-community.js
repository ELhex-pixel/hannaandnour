const {json}=require('../shared');
const registry=require('../../../public/js/journal-categories');
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function clean(body,approved=false){
  const output={};for(const [name,min,max] of [['author_name',2,60],['title',5,180],['body',300,20000],...(approved?[['excerpt',20,400]]:[])]){
    if(typeof body[name]!=='string'||body[name].trim().length<min||body[name].trim().length>max)throw new Error('blog_submission_invalid');output[name]=body[name].trim();
  }
  if(!registry.topics.includes(body.category)||!registry.images.includes(body.image))throw new Error('blog_submission_invalid');
  Object.assign(output,{category:body.category,image:body.image});if(!approved){if(!['fr','en','ar'].includes(body.lang))throw new Error('blog_submission_invalid');output.lang=body.lang;}
  return output;
}
function failure(error){const code=error.message||error.code;return ['blog_submission_invalid','blog_submission_mismatch','blog_submission_limit','blog_submission_changed'].includes(code)?json(code==='blog_submission_invalid'?400:409,{code,error:code}):json(503,{error:'blog_submission_unavailable'});}
async function customerSubmissions(sb,user,body){
  try{
    if(body.action==='listMine'){
      const {data,error}=await sb.from('blog_submissions').select('id,title,status,decision_note,published_slug,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(20);if(error)throw error;return json(200,{submissions:data||[]});
    }
    if(body.action!=='submit'||!ID.test(body.operation_id||''))throw new Error('blog_submission_invalid');
    const content=clean(body),result=await sb.rpc('submit_blog_article',{p_id:body.operation_id,p_user:user.id,p_content:content});
    if(result.error)throw result.error;if(!result.data||result.data.id!==body.operation_id||!['pending','approved','rejected'].includes(result.data.status))throw new Error('Unconfirmed');return json(200,{result:result.data});
  }catch(error){return failure(error);}
}
async function adminSubmissions(sb,action,body){
  try{
    if(action==='listBlogSubmissions'){
      const status=['pending','approved','rejected'].includes(body.status)?body.status:'pending',page=Number.isInteger(body.page)&&body.page>0&&body.page<=5000?body.page:1;
      const {data,error,count}=await sb.from('blog_submissions').select('id,author_name,title,category,body,image,lang,status,decision_note,published_slug,created_at,updated_at',{count:'exact'}).eq('status',status).order('created_at',{ascending:false}).order('id').range((page-1)*10,page*10-1);if(error||!Number.isInteger(count))throw new Error('List unavailable');return json(200,{submissions:data||[],total:count,page});
    }
    if(action!=='moderateBlogSubmission'||!ID.test(body.operation_id||'')||!ID.test(body.submission_id||'')||!Number.isFinite(Date.parse(body.expected_updated_at))||!['approve','reject'].includes(body.decision))throw new Error('blog_submission_invalid');
    const request=body.decision==='approve'?{decision:'approve',content:clean(body.content||{},true)}:{decision:'reject',note:typeof body.note==='string'?body.note.trim():''};
    if(body.decision==='reject'&&(request.note.length<3||request.note.length>500))throw new Error('blog_submission_invalid');
    const {data,error}=await sb.rpc('moderate_blog_article',{p_id:body.operation_id,p_submission:body.submission_id,p_expected:body.expected_updated_at,p_request:request});if(error)throw error;
    if(!data||data.operation_id!==body.operation_id||data.submission_id!==body.submission_id)throw new Error('Unconfirmed');return json(200,{result:data});
  }catch(error){return failure(error);}
}
module.exports={clean,customerSubmissions,adminSubmissions};
