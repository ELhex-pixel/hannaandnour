const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : file.endsWith('.js') ? [file] : [];
  });
}
let failed = false;
for (const file of ['public/js', 'netlify/functions', 'scripts', 'tests'].flatMap(walk)) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
}
if (failed) process.exit(1);
console.log('Syntaxe JavaScript vérifiée.');
