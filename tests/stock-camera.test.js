const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function camera(){
  const state={formats:[],controls:[],callbacks:[],streamsStopped:0,resolve:null};
  class Reader{
    constructor(hints){state.formats.push(hints.get('formats'));}
    static releaseAllStreams(){state.streamsStopped++;}
    decodeFromConstraints(constraints,video,callback){assert.equal(constraints.audio,false);assert.equal(constraints.video.facingMode.ideal,'environment');state.callbacks.push(callback);return new Promise(resolve=>{state.resolve=()=>{const control={stops:0,stop(){this.stops++;}};state.controls.push(control);resolve(control);};});}
  }
  const window={};
  vm.runInNewContext(fs.readFileSync('public/js/stock-codes-engine.js','utf8'),{window,Map,require:name=>name==='@zxing/browser'?{BrowserMultiFormatReader:Reader}:name==='@zxing/library'?{BarcodeFormat:{QR_CODE:'qr',CODE_128:'code128',EAN_13:'ean13',EAN_8:'ean8',UPC_A:'upca',UPC_E:'upce'},DecodeHintType:{POSSIBLE_FORMATS:'formats'}}:{toDataURL:async()=>''}});
  return {codes:window.HN_STOCK_ENGINE,state};
}
test('la caméra filtre QR stock vs code-barres vente et arrête le scan après une lecture',async()=>{
  const mock=camera(),found=[];
  const start=mock.codes.start('stock',{},text=>found.push(text));mock.state.resolve();await start;
  assert.deepEqual(Array.from(mock.state.formats[0]),['qr']);
  mock.state.callbacks[0]({getText:()=> 'local-stock'},null,mock.state.controls[0]);
  mock.state.callbacks[0]({getText:()=> 'duplicate'},null,mock.state.controls[0]);
  assert.deepEqual(found,['local-stock']);assert(mock.state.controls[0].stops>=1);
  const sale=mock.codes.start('sale',{},()=>{});mock.state.resolve();await sale;
  assert(mock.state.formats[1].includes('code128'));assert(!mock.state.formats[1].includes('qr'));mock.codes.stop();
  assert(mock.state.streamsStopped>=2);
});
test('une autorisation caméra tardive après fermeture ne démarre pas un scan ni une lecture',async()=>{
  const mock=camera(),found=[];
  const start=mock.codes.start('stock',{},text=>found.push(text));mock.codes.stop();mock.state.resolve();await start;
  assert.equal(mock.state.controls[0].stops,1);mock.state.callbacks[0]({getText:()=> 'late'},null,mock.state.controls[0]);assert.deepEqual(found,[]);
});
