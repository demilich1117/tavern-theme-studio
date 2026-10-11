import { readdir, readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { STUDIO_VERSION } from '../shared/version.js';
const root = path.resolve(import.meta.dirname, '..');
async function check(folder, recursive = true) {
  for (const item of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const file = path.join(folder, item.name);
    if (item.isDirectory() && recursive) await check(file);
    else if (/\.(?:js|mjs|cjs)$/.test(file)) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit', windowsHide: true });
  }
}
await check('', false);
for (const folder of ['shared', 'public', 'connector', 'scripts', 'tests']) await check(folder);
if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; Get-ChildItem -LiteralPath scripts -Filter '*.ps1' | ForEach-Object { $parseErrors=$null; [System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$null,[ref]$parseErrors) | Out-Null; if($parseErrors){throw ($parseErrors | Out-String)} }"], { cwd: root, stdio: 'inherit', windowsHide: true });
const manifest = JSON.parse(await readFile(path.join(root, 'connector/manifest.json')));
for (const key of ['display_name', 'js', 'author', 'version']) if (!manifest[key]) throw new Error(`Manifest missing ${key}`);
await access(path.join(root, manifest.js));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
if (pkg.version !== manifest.version || pkg.version !== STUDIO_VERSION || !((await readFile(path.join(root, 'public/index.html'), 'utf8')).includes(`>${pkg.version}</span>`))) throw new Error('Version mismatch');
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('Lockfile version mismatch');
if (pkg.license !== 'MIT') throw new Error('Missing code license declaration');
await access(path.join(root, 'LICENSE')); await access(path.join(root, 'THIRD-PARTY-NOTICES.md'));
console.log('JavaScript syntax and connector manifest: OK');
