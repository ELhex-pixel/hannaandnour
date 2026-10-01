function decodeImage(base64, maxBytes) {
  const raw = String(base64 || '').replace(/^data:image\/(jpeg|png|webp);base64,/, '');
  if (!raw || raw.length > Math.ceil(maxBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error('Image invalide ou trop lourde');
  const data = Buffer.from(raw, 'base64');
  if (!data.length || data.length > maxBytes) throw new Error('Image invalide ou trop lourde');
  if (data.length > 3 && data.subarray(0, 3).toString('hex') === 'ffd8ff') return { data, mime: 'image/jpeg', ext: '.jpg' };
  if (data.length > 8 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { data, mime: 'image/png', ext: '.png' };
  if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return { data, mime: 'image/webp', ext: '.webp' };
  throw new Error('Image JPG, PNG ou WebP requise');
}
module.exports = { decodeImage };
