(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HN_JOURNAL=factory();})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  var topics=['Style','Silhouettes','Bien choisir','Couleurs','Entretien','Inspirations'];
  var images=['capsule','superpositions','confort','couleurs','entretien','occasions'].map(function(name){return '/images/journal-'+name+'.webp';});
  return{topics:topics,images:images};
});
