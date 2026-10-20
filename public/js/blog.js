(function(){
  'use strict';
  var HN=window.HN,content=window.HN_CONTENT;if(!HN||!content)return;
  var pageSize=6,posts=[],shown=0,topic='',received=false,revision=0;
  var grid=document.querySelector('.blog-grid'),more=document.getElementById('blogMoreBtn'),topics=document.getElementById('journalTopics'),search=document.getElementById('journalSearch');if(!grid)return;
  function text(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function selected(){var query=text(search&&search.value);return posts.filter(function(p){return(!topic||p.category===topic)&&(!query||text(content.localized(p,'title',HN.lang())+' '+content.localized(p,'excerpt',HN.lang())+' '+p.category).indexOf(query)>=0);});}
  function buildTopics(){
    if(!topics)return;topics.textContent='';var list=[''];posts.forEach(function(p){if(p.category&&list.indexOf(p.category)<0)list.push(p.category);});
    list.forEach(function(value){var button=document.createElement('button'),index=window.HN_JOURNAL?window.HN_JOURNAL.topics.indexOf(value):-1;button.type='button';button.textContent=value?(index>=0?HN.tr('journalTopic'+index):value):HN.tr('journalAll');button.setAttribute('aria-pressed',value===topic?'true':'false');button.addEventListener('click',function(){topic=value;buildTopics();render(pageSize);});topics.appendChild(button);});
  }
  function render(count){
    var list=selected();shown=Math.min(count,list.length);grid.innerHTML=list.slice(0,shown).map(function(post){return content.postCardHTML(post,HN.lang(),HN.tr,window.location.protocol==='file:');}).join('');
    if(!list.length){var empty=document.createElement('p');empty.textContent=HN.tr(posts.length?'journalNoResults':'blogEmpty');grid.appendChild(empty);}
    if(more){more.hidden=shown>=list.length;more.style.display=more.hidden?'none':'';}
    var status=document.getElementById('journalResults');if(status)status.textContent=HN.tr('journalResultCount',{visible:shown,total:list.length});
  }
  function init(){var request=++revision;HN.loading(grid,'card',3);if(more)more.hidden=true;
    HN.request(HN.api('blog')).then(function(data){if(request!==revision)return;if(!data||!Array.isArray(data.posts))throw new Error();posts=data.posts.filter(function(post){return content.validSlug(post.slug);});received=true;buildTopics();render(pageSize);HN.loaded(grid);}).catch(function(){if(request===revision)HN.loadError(grid,init,'postLoadError');});
  }
  if(search)search.addEventListener('input',function(){render(pageSize);});if(more)more.addEventListener('click',function(){render(shown+pageSize);});
  document.addEventListener('langchange',function(){if(received){buildTopics();render(shown||pageSize);}});init();
})();
