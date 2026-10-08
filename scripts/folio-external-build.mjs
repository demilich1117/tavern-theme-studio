// Portable builder, also distributed as source/build.mjs in the external edition.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const manifest = JSON.parse(await readFile(new URL('source/assets.json', root), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.commit, /^[a-f0-9]{40}$/);
let css = await readFile(new URL('source/theme.template.css', root), 'utf8');
for (const asset of manifest.assets) {
  assert(css.includes(asset.marker), `Missing marker: ${asset.marker}`);
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert(asset.url.startsWith(`https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/assets/`));
  assert(!/[\s"'()<>]/.test(asset.url), 'Invalid artwork URL');
  css = css.replaceAll(asset.marker, asset.url);
}
assert(!/__\w+__/.test(css), 'Unresolved asset marker');
assert(!/data:image|tts-asset:|127\.0\.0\.1|localhost/i.test(css), 'Unexpected embedded or local artwork');
const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
assert.equal(urls.length, manifest.assets.length);
assert(urls.every(url => manifest.assets.some(asset => asset.url === url)));

if (process.argv.includes('--verify-urls')) {
  const results = await Promise.allSettled(manifest.assets.map(async asset => {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(30000) });
    assert(response.ok, `${asset.originalFile}: HTTP ${response.status}`);
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'image/webp');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, asset.bytes, `${asset.originalFile}: size changed`);
    assert.equal(sha(bytes), asset.sha256, `${asset.originalFile}: content changed`);
    return { url: asset.url, bytes: bytes.length, sha256: sha(bytes), status: response.status };
  }));
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(failures.length, 0, failures.map(result => result.reason.message).join('\n'));
  await mkdir(new URL('validation/', root), { recursive: true });
  await writeFile(new URL('validation/urls.json', root), JSON.stringify({ checkedAt: new Date().toISOString(), commit: manifest.commit, assets: results.map(result => result.value) }, null, 2));
}

const theme = { ...JSON.parse(await readFile(new URL('source/theme-fields.json', root), 'utf8')), custom_css: css };
const project = { schemaVersion: 2, name: theme.name, baseTheme: theme, rules: { base: {}, mobile: {} }, variableEdits: {}, customCss: '' };
for (const [file, value] of Object.entries({
  'moonveil-external.theme.json': JSON.stringify(theme, null, 2),
  'moonveil-external.studio.json': JSON.stringify(project, null, 2),
  'theme.css': css,
})) await writeFile(new URL(file, root), value);

const sums = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Release must not contain symbolic links');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(new URL(entry.name + '/', directory), relative + '/');
    else if (relative !== 'SHA256SUMS.txt') sums.push(`${sha(await readFile(new URL(entry.name, directory)))}  ${relative}`);
  }
}
await walk(root);
await writeFile(new URL('SHA256SUMS.txt', root), sums.sort().join('\n') + '\n');
console.log(JSON.stringify({ theme: theme.name, images: urls.length, cssCharacters: css.length, themeBytes: Buffer.byteLength(JSON.stringify(theme, null, 2)) }));
