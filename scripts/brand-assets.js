const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const LOGO = '/images/maison-hanna-nour-logo-512.png';

function ico(buffers, sizes) {
  const header = Buffer.alloc(6 + 16 * buffers.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(buffers.length, 4);
  let offset = header.length;
  buffers.forEach((buffer, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffer.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, ...buffers]);
}

async function buildBrandAssets(destination) {
  const folder = path.join(destination, 'images');
  const logo = await fs.readFile('public/images/maison-hanna-nour-logo.svg');
  const icon = await fs.readFile('public/images/favicon.svg');
  await fs.writeFile(path.join(folder, 'maison-hanna-nour-icon.svg'), icon);
  await Promise.all([512, 1024, 4096].map(size => sharp(logo).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(folder, 'maison-hanna-nour-logo-' + (size === 4096 ? '4k' : size) + '.png'))));
  await Promise.all([96, 180, 192].map(size => sharp(icon).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(folder, 'maison-hanna-nour-icon-' + size + '.png'))));
  const sizes = [16, 32, 48];
  const buffers = await Promise.all(sizes.map(size => sharp(icon).resize(size, size).png().toBuffer()));
  await fs.writeFile(path.join(destination, 'favicon.ico'), ico(buffers, sizes));
}

function brandIcons($) {
  $('head link[rel="icon"], head link[rel="shortcut icon"]').remove();
  $('head').append('<link rel="icon" type="image/png" sizes="96x96" href="/images/maison-hanna-nour-icon-96.png">');
  $('head').append('<link rel="icon" type="image/png" sizes="192x192" href="/images/maison-hanna-nour-icon-192.png">');
  $('head').append('<link rel="icon" type="image/svg+xml" sizes="any" href="/images/maison-hanna-nour-icon.svg">');
  $('head').append('<link rel="shortcut icon" href="/favicon.ico">');
  if (!$('head link[rel="apple-touch-icon"]').length) $('head').append('<link rel="apple-touch-icon" sizes="180x180" href="/images/maison-hanna-nour-icon-180.png">');
}

module.exports = { LOGO, ico, buildBrandAssets, brandIcons };
