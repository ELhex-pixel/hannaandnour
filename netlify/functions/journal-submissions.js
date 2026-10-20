const {json,getSupabase,isConfigured,readBody,requireUser,getBearer,rateLimit,CORS_HEADERS}=require('./shared');
const {customerSubmissions}=require('./lib/blog-community');
exports.handler=async function(event){
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS_HEADERS};
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  if(!isConfigured())return json(503,{error:'blog_submission_unavailable'});
  try{
    const sb=getSupabase(),auth=await requireUser(sb,getBearer(event));if(!auth.ok)return json(401,{error:'not_authenticated'});
    const body=readBody(event);if(!['submit','listMine'].includes(body.action))return json(400,{error:'blog_submission_invalid'});
    const limited=await rateLimit(sb,event,'journal:'+body.action,body.action==='submit'?10:60,body.action==='submit'?3600:600,auth.user.id);if(limited)return limited;
    return customerSubmissions(sb,auth.user,body);
  }catch{return json(503,{error:'blog_submission_unavailable'});}
};
