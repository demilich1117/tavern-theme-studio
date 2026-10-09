import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { STUDIO_VERSION } from '../shared/version.js';
import { zipFiles } from './zip.js';
const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, ['scripts/package-connector.js'], { cwd: root, stdio: 'inherit', windowsHide: true });
const paths = new Set(['package.json', 'package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'README.md', 'AGENTS.md', 'start.cmd', 'examples/starter.theme.json', 'dist/tavern-theme-studio-connector.zip']);
for (const f of await readdir(root)) if (f.endsWith('.js')) paths.add(f);
for (const f of await readdir(path.join(root, 'public'))) if (f.endsWith('.js') || ['index.html', 'style.css', 'workspace.css', 'favicon.svg', 'demo.html', 'demo.css'].includes(f)) paths.add('public/' + f);
async function tree(folder) {
  for (const item of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const file = `${folder}/${item.name}`;
    if (item.isSymbolicLink()) throw new Error('Package cannot contain symlinks: ' + file);
    if (item.isDirectory()) await tree(file); else paths.add(file);
  }
}
for (const folder of ['shared', 'connector']) await tree(folder);
for (const file of ['api.md', 'annotations-assets.md', 'native-lab.md', 'source-build.md', 'resources-and-runner.md', 'layouts-and-geometry.md', 'decorations.md', 'design.md', 'release.md', 'theme-analysis.md']) paths.add('docs/' + file);
for (const file of ['cli.js', 'doctor.js', 'start-native-lab.js', 'package-connector.js']) paths.add('scripts/' + file);
// Lockfile defines the complete installed runtime closure; include original
// package licenses and hashes, never development caches or workspace data.
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [folder, info] of Object.entries(lock.packages)) {
  if (!folder || info.dev) continue;
  if (!/^node_modules\/[\w./@-]+$/.test(folder) || folder.split('/').includes('..')) throw new Error('Invalid dependency path');
  const installed = JSON.parse(await readFile(path.join(root, folder, 'package.json')));
  if (installed.version !== info.version || (await lstat(path.join(root, folder))).isSymbolicLink()) throw new Error('Run npm ci before packaging: ' + folder);
  await tree(folder);
}
const manifest = { version: STUDIO_VERSION, format: 'tavern-theme-studio-core', files: [] }, files = [];
for (const file of [...paths].sort()) {
  const bytes = await readFile(path.join(root, file === 'README.md' ? 'docs/installation.md' : file));
  files.push(['tavern-theme-studio/' + file, bytes]);
  manifest.files.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
files.push(['tavern-theme-studio/package-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))]);
const output = path.join(root, 'output/releases'); await mkdir(output, { recursive: true });
const file = path.join(output, `tavern-theme-studio-${STUDIO_VERSION}-core.zip`), zip = zipFiles(files);
await writeFile(file, zip);
await writeFile(file + '.sha256', createHash('sha256').update(zip).digest('hex') + '  ' + path.basename(file) + '\n');
console.log(JSON.stringify({ file, files: files.length, bytes: zip.length, bundledRuntimeDependencies: true, excluded: ['.local', 'output', '.git', 'large theme examples'] }, null, 2));
