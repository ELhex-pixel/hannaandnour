// Bundled locally by scripts/build.js; works on iPhone without BarcodeDetector.
const { BrowserMultiFormatReader } = require('@zxing/browser');
const { BarcodeFormat, DecodeHintType } = require('@zxing/library');
const QRCode = require('qrcode');
let generation = 0, controls = null, reader = null;
function stop() { generation++; if (controls) controls.stop(); controls = null; if (reader) BrowserMultiFormatReader.releaseAllStreams(); reader = null; }
async function start(mode, video, found) {
  stop();
  const current = generation;
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, mode === 'stock' ? [BarcodeFormat.QR_CODE] : [BarcodeFormat.CODE_128,BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E]]]);
  reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts:250 });
  const result = await reader.decodeFromConstraints({ audio:false,video:{ facingMode:{ideal:'environment'} } },video,(value,error,control) => {
    if (!value || current !== generation) return;
    control.stop(); stop(); found(value.getText());
  });
  if (current !== generation) result.stop(); else controls = result;
}
window.HN_STOCK_ENGINE = { start,stop,qr: text => QRCode.toDataURL(text,{errorCorrectionLevel:'M',width:400,margin:4}) };
