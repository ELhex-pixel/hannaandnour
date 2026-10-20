(function(){
  'use strict';
  var HN=window.HN,auth=window.HN_AUTH,registry=window.HN_JOURNAL,form=document.getElementById('journalSubmissionForm');if(!HN||!auth||!registry||!form)return;
  var el=function(id){return document.getElementById(id);},revision=0,busy=false,pending=null,owner='';
  function key(){return 'hn-journal-submission-'+owner;}
  function session(){var user=auth.currentUser();return auth.isAuthed()&&user?user.id:'';}
  function status(message){el('journalSubmissionStatus').textContent=message;}
  function lock(){form.querySelectorAll('input,select,textarea,button').forEach(function(node){node.disabled=busy||!!pending||!owner;});el('journalRetry').hidden=!pending;el('journalRetry').disabled=busy;}
  function options(){
    ['journalCategory','journalCover'].forEach(function(id){var select=el(id),saved=select.value;select.textContent='';registry.topics.forEach(function(topic,index){var option=document.createElement('option');option.value=id==='journalCategory'?topic:registry.images[index];option.textContent=HN.tr('journalTopic'+index);select.appendChild(option);});if(saved)select.value=saved;});
    cover();
  }
  function cover(){if(registry.images.indexOf(el('journalCover').value)>=0)el('journalCoverPreview').src=el('journalCover').value;}
  function request(body){return HN.request(HN.api('journal-submissions'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token()},body:JSON.stringify(body)});}
  function list(version,user){return request({action:'listMine'}).then(function(data){if(version!==revision||user!==session())return;var box=el('journalMySubmissionsList');box.textContent='';(data.submissions||[]).forEach(function(row){var wrap=document.createElement('div'),title=document.createElement('strong'),state=document.createElement('p');wrap.className='journal-submission-row';title.textContent=row.title;state.textContent=HN.tr('journalStatus_'+row.status);wrap.appendChild(title);wrap.appendChild(state);if(row.decision_note){var note=document.createElement('p');note.textContent=row.decision_note;wrap.appendChild(note);}if(row.status==='approved'&&row.published_slug){var link=document.createElement('a');link.href=window.HN_CONTENT.path('post',row.published_slug,HN.lang());link.textContent=HN.tr('journalRead');wrap.appendChild(link);}box.appendChild(wrap);});if(!data.submissions.length)box.textContent=HN.tr('journalNoSubmissions');}).catch(function(){if(version===revision&&user===session())el('journalMySubmissionsList').textContent=HN.tr('journalSubmissionError');});}
  function sync(){
    revision++;busy=false;pending=null;owner=session();form.reset();el('journalMySubmissionsList').textContent='';status('');el('journalAuthGate').hidden=!!owner;el('journalContribution').hidden=!owner;el('journalMySubmissions').hidden=!owner;options();
    if(owner){try{var raw=localStorage.getItem(key());pending=raw?JSON.parse(raw):null;if(pending&&(!pending.operation_id||typeof pending.body!=='string'))throw new Error();}catch(error){status(HN.tr('journalSubmissionError'));form.hidden=true;lock();return;}form.hidden=false;if(pending){[['journalAuthor','author_name'],['journalTitleInput','title'],['journalBodyInput','body'],['journalCategory','category'],['journalCover','image']].forEach(function(pair){el(pair[0]).value=pending[pair[1]];});cover();status(HN.tr('journalPendingHelp'));}list(revision,owner);}
    lock();
  }
  function send(){
    if(busy||!owner||owner!==session())return;
    if(!pending){if(!form.reportValidity())return;try{pending={action:'submit',operation_id:window.crypto.randomUUID(),author_name:el('journalAuthor').value.trim(),title:el('journalTitleInput').value.trim(),body:el('journalBodyInput').value.trim(),category:el('journalCategory').value,image:el('journalCover').value,lang:HN.lang()};localStorage.setItem(key(),JSON.stringify(pending));}catch(error){pending=null;status(HN.tr('journalSubmissionError'));return;}}
    var version=revision,user=owner,operation=pending.operation_id;busy=true;lock();status(HN.tr('processing'));
    request(pending).then(function(data){if(version!==revision||user!==session())return;if(!data.result||data.result.id!==operation)throw new Error();localStorage.removeItem(key());pending=null;form.reset();options();status(HN.tr('journalSubmissionSent'));return list(version,user);}).catch(function(error){if(version===revision&&user===session()){if(['blog_submission_invalid','blog_submission_limit'].indexOf(error.message)>=0){try{localStorage.removeItem(key());pending=null;}catch(storageError){}status(HN.tr('journalSubmissionError'));}else status(HN.tr('journalPendingHelp'));}}).finally(function(){if(version===revision&&user===session()){busy=false;lock();}});
  }
  el('journalCover').addEventListener('change',cover);form.addEventListener('submit',function(event){event.preventDefault();send();});el('journalRetry').addEventListener('click',send);document.addEventListener('hn:auth',sync);document.addEventListener('langchange',function(){options();if(owner)list(revision,owner);});options();lock();Promise.resolve(auth.ready).then(sync);
})();
