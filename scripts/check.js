import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
for (const folder of ['', 'shared', 'public', 'connector', 'scripts', 'tests']) {
  for (const file of await readdir(path.join(root, folder))) {
    if (/\.(?:js|mjs)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, folder, file)], { stdio: 'inherit', windowsHide: true });
  }
}
const manifest = JSON.parse(await readFile(path.join(root, 'connector/manifest.json')));
for (const key of ['display_name', 'js', 'author', 'version']) if (!manifest[key]) throw new Error(`Manifest missing ${key}`);
await access(path.join(root, manifest.js));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
if (pkg.version !== manifest.version) throw new Error('Version mismatch');
console.log('JavaScript syntax and connector manifest: OK');
