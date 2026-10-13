import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';
import { createAssetStore } from '../src/asset-store.js';
import { createHubClient } from '../src/hub-client.js';
import { createExportService, dependencies, referenceIndex } from '../src/export-service.js';
import { createProject } from '../shared/core.js';
const temp = () => mkdtemp(path.join(os.tmpdir(), 'tts-release-'));
const image = n => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([n, 0, 1, 0, 0, 0, 0])]);
const item = n => { const bytes = image(n), hash = createHash('sha256').update(bytes).digest('hex'); return { id: hash, hash, path: `assets/test/1/${n}.gif`, name: `image ${n}`, collection: 'test', version: '1', bytes: bytes.length, ext: 'gif', committed: true }; };
const pinned = (n, commit = 'a') => `https://raw.githubusercontent.com/owner/repo/${commit.repeat(40)}/${item(n).path}`;

test('concurrent store puts, deduplication and archive preserve every index entry after restart', async () => {
  const dir = await temp();
  try {
    const store = await createAssetStore(dir), first = await store.put(image(1));
    const results = await Promise.all([store.archive([first.id], true), ...Array.from({ length: 20 }, (_, i) => store.put(image(i + 1))), store.external('https://example.org/image.png')]);
    assert.equal(results.length, 22);
    const reopened = await createAssetStore(dir);
    assert.equal(reopened.list().length, 21); assert.equal(reopened.list().find(a => a.id === first.id).archived, true);
    for (const a of reopened.list().filter(a => a.kind === 'local')) await reopened.read(a.id);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('data directory rejects a second writer and releases locks after close or startup failure', async () => {
  const dir = await temp(), other = await temp(); let app, recovered;
  try {
    app = await createServer({ dataDir: dir, port: 0 });
    const before = await readFile(path.join(dir, 'project.json'));
    await assert.rejects(createServer({ dataDir: dir, port: 0 }), { code: 'STUDIO_DATA_LOCKED' });
    assert.deepEqual(await readFile(path.join(dir, 'project.json')), before);
    await assert.rejects(createServer({ dataDir: other, port: new URL(app.address).port }), { code: 'EADDRINUSE' });
    await assert.rejects(access(path.join(other, '.studio-lock')), { code: 'ENOENT' });
    await app.close();
    recovered = await createServer({ dataDir: dir, port: 0, seedPath: 'does-not-exist.json' });
    assert.deepEqual(await readFile(path.join(dir, 'project.json')), before, 'missing old seed cannot overwrite or prevent reopening an existing project');
  } finally { await app?.close(); await recovered?.close(); await rm(dir, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test('a dead lock owner is recovered without deleting project data', async () => {
  const dir = await temp(); let app;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', `import {acquireDataLock} from ${JSON.stringify(new URL('../src/data-lock.js', import.meta.url).href)}; await acquireDataLock(${JSON.stringify(dir)});`], { windowsHide: true });
    app = await createServer({ dataDir: dir, port: 0 });
    assert.equal((await fetch(app.address + '/api/project')).status, 200);
  } finally { await app?.close(); await rm(dir, { recursive: true, force: true }); }
});
test('legacy runtime without a lock cannot be opened while its process is alive', async () => {
  const dir = await temp();
  try {
    await writeFile(path.join(dir, 'runtime.json'), JSON.stringify({ pid: process.pid, address: 'http://127.0.0.1:19323' }));
    await assert.rejects(createServer({ dataDir: dir, port: 0 }), { code: 'STUDIO_DATA_LOCKED' });
    await assert.rejects(access(path.join(dir, 'project.json')), { code: 'ENOENT' });
    await assert.rejects(access(path.join(dir, '.studio-lock')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CSS dependency audit covers escaped URL, image-set, imports and ignores comments/content', async () => {
  const dir = await temp();
  try {
    const assets = await createAssetStore(dir), service = createExportService(assets, { status: () => ({ assets: [] }) });
    const remoteCss = [String.raw`a{background:u\72l("https://example.org/a.gif")}`, String.raw`a{background:u\72l(https://example.org/a.gif)}`, 'a{background:image-set("https://example.org/a.gif" 1x)}', String.raw`@\69mport "https://example.org/a.css";`];
    for (const css of remoteCss) {
      assert.equal((await service.audit(createProject({ name: 'Regression fixture', custom_css: css }))).remote.length, 1, css);
      await assert.rejects(service.theme(createProject({ name: 'Regression fixture', custom_css: css }), 'offline'), /缺少依赖/);
    }
    assert.deepEqual(dependencies('/* url(https://no.test/a) */ a{content:"url(https://no.test/b)";mask:url(#id)}'), []);
    const stored = await assets.put(image(1));
    const css = `a{background:image-set("${stored.reference}" 1x, u\\72l("${stored.reference.replace('tts-asset', 'tts-\\61sset')}") 2x)}`;
    const result = await service.theme(createProject({ name: 'Regression fixture', custom_css: css }), 'offline');
    assert.equal(dependencies(result.theme.custom_css).length, 1);
    assert.ok(dependencies(result.theme.custom_css).every(r => r.startsWith('data:image/gif;base64,')));
    assert.ok(referenceIndex(createProject({ name: 'Regression fixture', custom_css: css })).some(r => r.reference === stored.reference));
    await assert.rejects(service.theme(createProject({ name: 'Unclosed URL', custom_css: 'a{background:url("unfinished)}' }), 'offline'), /缺少依赖/);
    await assert.rejects(service.theme(createProject({ name: 'Regression fixture', custom_css: 'a{background:src(attr(data-url))}' }), 'offline'), /动态 src/);
    await assert.rejects(service.theme(createProject({ name: 'Dynamic string', custom_css: ':root{--remote:"https://example.org/hidden.gif"}a{background:image-set(var(--remote) 1x)}' }), 'offline'), /动态资源参数/);
    const portable = await assets.portableProject(createProject({ name: 'Escaped backup', custom_css: css }));
    assert.ok(dependencies(portable.baseTheme.custom_css).every(r => r.startsWith('data:image/gif;base64,')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('old project locks survive catalog upgrades; concurrent verifications retain both hashes', async () => {
  const dir = await temp(), original = globalThis.fetch;
  let commit = 'a';
  globalThis.fetch = async url => {
    url = String(url);
    if (url.endsWith('/hub.json')) return Response.json({ repository: 'owner/repo', commit: commit.repeat(40), mode: 'local' });
    if (url.endsWith('/catalog.json')) return Response.json({ schemaVersion: 1, revision: 1, assets: [item(1), item(2)] });
    if ([pinned(1), pinned(2), pinned(1, 'b')].includes(url)) return new Response(image(url.endsWith('1.gif') ? 1 : 2), { headers: { 'Content-Type': 'image/gif' } });
    throw new Error('unexpected network request: ' + url);
  };
  try {
    const assets = await createAssetStore(dir), hub = await createHubClient(dir, assets);
    await hub.refresh('http://127.0.0.1:1');
    await Promise.all([hub.fetchAsset(item(1).id, true), hub.fetchAsset(item(2).id, true)]);
    const project = createProject({ name: 'Regression fixture', custom_css: `a{background:url("${pinned(1)}")}` });
    project.assetRefs = [{ reference: pinned(1), pinnedUrl: pinned(1), hash: item(1).hash }]; // legacy 0.8 lock without size/ext
    commit = 'b'; await hub.refresh();
    assert.equal(hub.status().assets[0].verification, null, 'a verified hash must not imply a different URL is public');
    const service = createExportService(assets, hub);
    assert.ok((await service.theme(project, 'external')).theme.custom_css.includes(pinned(1)));
    assert.ok((await service.theme(project, 'offline')).theme.custom_css.includes('data:image/gif;base64,'));
    assert.equal(hub.locks(project).assets[0].pinnedUrl, pinned(1));
    const reopened = await createHubClient(dir, assets);
    assert.ok(reopened.verification(item(1).hash, pinned(1)));
    assert.ok(reopened.verification(item(2).hash, pinned(2)));
    await assert.rejects(reopened.verifyLock({ ...project.assetRefs[0], hash: item(2).hash }), /不匹配/);
  } finally { globalThis.fetch = original; await rm(dir, { recursive: true, force: true }); }
});

test('HTTP export and upload can overlap without losing assets', async () => {
  const dir = await temp(), original = globalThis.fetch; let app, release, reached;
  const exporting = new Promise(r => { reached = r; }), barrier = new Promise(r => { release = r; });
  globalThis.fetch = async (url, options) => {
    if (String(url) !== pinned(1)) return original(url, options);
    reached(); await barrier; return new Response(image(1), { headers: { 'Content-Type': 'image/gif' } });
  };
  try {
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(createProject({ name: 'Regression fixture', custom_css: `a{background:url("${pinned(1)}")}` })));
    await writeFile(path.join(dir, 'hub-cache.json'), JSON.stringify({ source: 'http://127.0.0.1:1/', assets: [item(1)], config: { repository: 'owner/repo', commit: 'a'.repeat(40) }, checked: {} }));
    app = await createServer({ dataDir: dir, port: 0 });
    const s = await (await original(app.address + '/api/session')).json();
    const exported = original(app.address + '/api/export?mode=external');
    await exporting;
    const uploaded = original(app.address + '/api/assets?name=concurrent', { method: 'POST', headers: { 'X-Studio-Token': s.token }, body: image(2) });
    release();
    assert.deepEqual((await Promise.all([exported, uploaded])).map(r => r.status), [200, 201]);
    assert.equal((await (await original(app.address + '/api/assets')).json()).length, 2);
    assert.equal((await createAssetStore(dir)).list().length, 2);
  } finally { release(); globalThis.fetch = original; await app?.close(); await rm(dir, { recursive: true, force: true }); }
});
