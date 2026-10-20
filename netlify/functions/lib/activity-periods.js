const { json } = require('../shared');
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const failures={activity_period_invalid:[400,'Renseignez un motif et confirmez la nouvelle période.'],activity_period_changed:[409,'La période a changé. Actualisez les chiffres avant de recommencer.'],activity_period_operation_mismatch:[409,'Cette opération correspond à une autre demande. Reprenez son contenu initial.']};
async function latest(sb){
  const {data,error}=await sb.from('admin_activity_periods').select('id,started_at').order('started_at',{ascending:false}).order('id',{ascending:false}).limit(1);
  if(error||!Array.isArray(data)||data.length>1)throw new Error('Period unavailable');
  const row=data[0];if(row&&(!ID.test(row.id)||!Number.isFinite(Date.parse(row.started_at))))throw new Error('Invalid period');
  return row||null;
}
async function reportingWindow(sb,body={}){
  const scope=body.reporting_scope===undefined?'current':body.reporting_scope;
  if(!['current','history','all'].includes(scope))throw Object.assign(new Error(),{code:'activity_period_invalid'});
  const head=await latest(sb),id=head?head.id:'initial';
  if(body.expected_reporting_period!==undefined&&body.expected_reporting_period!==id)throw Object.assign(new Error(),{code:'activity_period_changed'});
  return {id,scope,start:scope==='current'&&head?head.started_at:null,end:scope==='history'&&head?head.started_at:null,empty:scope==='history'&&!head,started_at:head?head.started_at:null};
}
function constrain(query,column,window){if(window.start)query=query.gte(column,window.start);if(window.end)query=query.lt(column,window.end);return query;}
function instant(value){const ms=Date.parse(value);if(!Number.isFinite(ms))return null;const fraction=String(value).match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/);return BigInt(ms)*1000n+BigInt(fraction?fraction[1].padEnd(6,'0').slice(3,6):0);}
function includes(value,window){if(!window)return true;const date=instant(value);return date!==null&&!window.empty&&(!window.start||date>=instant(window.start))&&(!window.end||date<instant(window.end));}
function failure(error){const problem=failures[error.code];return problem?json(problem[0],{code:error.code,error:problem[1]}):null;}
async function adminActivityPeriods(sb,action,body){
  try{
    if(action==='getActivityPeriod')return json(200,{period:await latest(sb)});
    if(action!=='startActivityPeriod'||!ID.test(body.operation_id||'')||(body.previous_id!==null&&!ID.test(body.previous_id||''))||typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.trim().length>300||body.confirmation!=='NOUVELLE_PERIODE')return json(400,{error:'Confirmez la nouvelle période avec un motif valide.'});
    const {data,error}=await sb.rpc('start_admin_activity_period',{p_id:body.operation_id,p_previous:body.previous_id,p_reason:body.reason.trim(),p_confirmation:body.confirmation});
    if(error){const known=failure({code:error.message});if(known)return known;throw error;}
    if(!data||data.operation_id!==body.operation_id||!Number.isFinite(Date.parse(data.started_at)))throw new Error('Unconfirmed');
    return json(200,{result:data});
  }catch(error){return failure(error)||json(503,{error:'Période non confirmée. Réessayez la même opération.'});}
}
module.exports={latest,reportingWindow,constrain,includes,failure,adminActivityPeriods};
