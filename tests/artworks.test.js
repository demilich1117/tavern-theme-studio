import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createServer } from '../server.js';
import { createArtworkService } from '../artwork-service.js';
import { createAssetStore } from '../asset-store.js';
import { createExportService } from '../export-service.js';
import { createProject } from '../shared/core.js';
import { projectFingerprint } from '../storage-migrations.js';
import { sourceFingerprint } from '../build-service.js';

const exec = promisify(execFile);
async function cleanup(root) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('tts-artwork-'));
  await rm(root, { recursive: true, force: true });
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-artwork-'));
  const dataDir = path.join(root, 'data'), studioRoot = path.join(root, 'tool'), source = path.join(root, 'source');
  await mkdir(studioRoot); await mkdir(source);
  const assets = await createAssetStore(dataDir), exports = createExportService(assets, { status: () => ({ assets: [] }) });
  const create = () => createArtworkService({ dataDir, studioRoot, home: path.join(root, 'works'), exports, assets });
  return { root, dataDir, studioRoot, source, assets, service: await create(), create };
}
const archive = (project, extra = {}) => ({ project, baseline: { projectId: project.projectId, revision: 3, fingerprint: projectFingerprint(project) }, name: '阅读布局定稿', note: '保留面板里的间距调整。', assertCurrent: async () => {}, ...extra });

test('artwork contains UI edits, source, native theme and hashed assets; mismatched or changing source cannot publish a version', async () => {
  const f = await fixture();
  try {
    const a = await f.assets.put(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00'), 'fixture.gif');
    const project = createProject({ name: 'fictional artwork', custom_css: `:root{--gap:12px}body{background:url('${a.reference}')}` });
    project.rules.base.assistant = { padding: '23px' }; project.customCss = '.extra{color:red}';
    await writeFile(path.join(f.source, 'theme.css'), project.baseTheme.custom_css);
    await writeFile(path.join(f.source, 'design-brief.md'), '虚构测试记录');
    const config = { root: f.source, program: process.execPath, args: ['build.mjs'], watch: ['theme.css'], mode: 'local' };
    const fingerprint = await sourceFingerprint(config, f.dataDir), build = { bound: true, config, status: { state: 'succeeded' }, lastSuccessful: { sourceFingerprint: fingerprint } };
    const saved = await f.service.save(archive(project, { build }));
    const checked = await f.service.verify(project.projectId, saved.id, f.source);
    assert.deepEqual(checked.project, project);
    assert.match(JSON.parse(checked.files.get('theme.json')).custom_css, /padding: 23px/);
    assert.match(JSON.parse(checked.files.get('theme.json')).custom_css, /data:image\/gif;base64/);
    assert.equal(checked.files.get('source/design-brief.md').toString(), '虚构测试记录');
    assert.equal(checked.manifest.source.fingerprint, fingerprint);
    const backup = JSON.parse(checked.files.get('project/manifest.json'));
    const manifest = checked.manifest;
    backup.assets = [];
    const changed = Buffer.from(JSON.stringify(backup));
    await writeFile(path.join(saved.directory, 'project/manifest.json'), changed);
    const entry = manifest.files.find(file => file.path === 'project/manifest.json');
    entry.bytes = changed.length; entry.sha256 = createHash('sha256').update(changed).digest('hex');
    await writeFile(path.join(saved.directory, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(f.service.verify(project.projectId, saved.id, f.source), /缺少工程引用的素材/);
    await writeFile(path.join(f.source, 'theme.css'), 'body{color:blue}');
    await assert.rejects(f.service.save(archive(project, { build })), /尚未同步/);
    build.lastSuccessful.sourceFingerprint = await sourceFingerprint(config, f.dataDir);
    await assert.rejects(f.service.save(archive(project, { build, assertCurrent: async () => { await writeFile(path.join(f.source, 'theme.css'), 'body{color:green}'); } })), /发生变化/);
    assert.equal((await f.service.status(project.projectId, f.source)).versions.length, 1);
    const reopened = await f.create(); assert.equal((await reopened.status(project.projectId)).versions[0].id, saved.id);
  } finally { await cleanup(f.root); }
});

test('dedicated directories reject tool/source overlap, other works and existing files; verification rejects corruption and traversal', async () => {
  const f = await fixture();
  try {
    const project = createProject({ name: 'paths' });
    await assert.rejects(f.service.configure(project.projectId, f.studioRoot), /之外/);
    await assert.rejects(f.service.configure(project.projectId, path.join(f.source, 'archive'), f.source), /重叠/);
    await writeFile(path.join(f.source, 'keep.txt'), 'keep');
    await assert.rejects(f.service.configure(project.projectId, f.source), /空目录/);
    const saved = await f.service.save(archive(project));
    await assert.rejects(f.service.configure(createProject({ name: 'other' }).projectId, path.dirname(path.dirname(saved.directory))), /另一作品/);
    await writeFile(path.join(saved.directory, 'theme.css'), 'corrupt');
    await assert.rejects(f.service.verify(project.projectId, saved.id), /校验失败/);
    const file = path.join(saved.directory, 'manifest.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.files[0].path = '../outside.txt'; await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(f.service.verify(project.projectId, saved.id), /路径无效/);
  } finally { await cleanup(f.root); }
});

test('local Git commits only the chosen version, keeps unrelated staged files, and permits retry after identity failure', async () => {
  const f = await fixture();
  const g = (root, args) => exec('git', ['-C', root, ...args], { windowsHide: true });
  try {
    const project = createProject({ name: 'local git' }), saved = await f.service.save(archive(project));
    const root = path.dirname(path.dirname(saved.directory));
    await g(root, ['init', '-b', 'main']);
    await g(root, ['config', 'user.name', '']); await g(root, ['config', 'user.email', '']);
    const failed = await f.service.commit(project.projectId, saved.id); assert.equal(failed.git.status, 'failed');
    assert.equal((await f.service.verify(project.projectId, saved.id)).manifest.id, saved.id);
    await g(root, ['config', 'user.name', 'Fictional test']); await g(root, ['config', 'user.email', 'test@example.invalid']);
    await g(root, ['config', 'commit.gpgSign', 'false']);
    await writeFile(path.join(root, 'unrelated.txt'), 'unrelated staged data'); await g(root, ['add', '--', 'unrelated.txt']);
    const committed = await f.service.commit(project.projectId, saved.id); assert.equal(committed.git.status, 'committed');
    assert.equal((await g(root, ['diff', '--cached', '--name-only'])).stdout.trim(), 'unrelated.txt');
    assert.doesNotMatch((await g(root, ['ls-tree', '-r', '--name-only', 'HEAD'])).stdout, /unrelated/);
    assert.equal((await f.service.commit(project.projectId, saved.id)).git.commit, committed.git.commit);
    const reopened = await f.create(); assert.equal((await reopened.status(project.projectId)).versions[0].git.commit, committed.git.commit);
    assert.equal((await g(root, ['remote'])).stdout.trim(), '');
  } finally { await cleanup(f.root); }
});

test('HTTP save, restart and restore preserve baseline, reject forged/stale writes and corruption before mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-artwork-'));
  const dataDir = path.join(root, 'data'), artworkHome = path.join(root, 'works'); let app;
  try {
    app = await createServer({ dataDir, artworkHome, port: 0 });
    const read = async p => (await fetch(app.address + p)).json();
    const post = async (route, body, headers = {}) => {
      const s = await read('/api/session'); const response = await fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': s.token, ...headers }, body: JSON.stringify({ projectId: s.projectId, sessionId: s.sessionId, fingerprint: s.fingerprint, revision: s.revision, ...body }) });
      return { status: response.status, data: await response.json() };
    };
    await post('/api/commands', { command: { type: 'set', target: 'assistant', property: 'padding', value: '29px' } });
    const before = await read('/api/project'), saved = await post('/api/artworks', { action: 'save', name: 'HTTP fixture' });
    assert.equal(saved.status, 200); assert.ok(saved.data.snapshotCreated.id);
    assert.equal(saved.data.baseline.fingerprint, before.fingerprint);
    assert.equal((await read('/api/project')).revision, before.revision);
    assert.equal((await post('/api/artworks', { action: 'save', name: 'stale', fingerprint: 'a'.repeat(64) })).status, 409);
    assert.equal((await post('/api/artworks', { action: 'save', name: 'forged' }, { 'X-Studio-Token': 'invalid' })).status, 403);
    await app.close(); app = await createServer({ dataDir, artworkHome, port: 0 });
    assert.equal((await read('/api/artworks')).versions[0].id, saved.data.id);
    await post('/api/commands', { command: { type: 'set', target: 'assistant', property: 'padding', value: '8px' } });
    const restored = await post('/api/artworks', { action: 'restore', id: saved.data.id });
    assert.equal(restored.status, 200); assert.equal(restored.data.project.rules.base.assistant.padding, '29px');
    assert.ok(restored.data.snapshotCreated.id);
    await writeFile(path.join(saved.data.directory, 'project/manifest.json'), '{}');
    const p = await read('/api/project');
    assert.equal((await post('/api/artworks', { action: 'restore', id: saved.data.id })).status, 400);
    assert.deepEqual((await read('/api/project')).project, p.project);
    assert.equal((await readdir(path.join(artworkHome, p.projectId, 'versions'))).length, 1);
  } finally { await app?.close(); await cleanup(root); }
});

test('restoring an artwork pauses bound source synchronization and retains current source plus archived source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-artwork-'));
  const source = path.join(root, 'source'), dataDir = path.join(root, 'data'); let app;
  try {
    await mkdir(source); const sourceFile = path.join(source, 'source.json');
    await writeFile(sourceFile, JSON.stringify({ css: 'body{color:red}' }));
    app = await createServer({ dataDir, artworkHome: path.join(root, 'works'), port: 0 });
    const read = async route => (await fetch(app.address + route)).json();
    const post = async (route, body) => {
      const s = await read('/api/session'), response = await fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': s.token }, body: JSON.stringify({ sessionId: s.sessionId, projectId: s.projectId, revision: s.revision, fingerprint: s.fingerprint, ...body }) });
      const result = await response.json(); assert.equal(response.status, 200, result.error); return result;
    };
    await post('/api/build/configure', { bindingVersion: 0, autoSync: true, config: { root: source, program: process.execPath, args: [path.join(import.meta.dirname, 'fixtures/build-adapter.mjs')], watch: ['source.json'], debounceMs: 50, timeoutMs: 5000 } });
    const end = Date.now() + 10000;
    while ((await read('/api/build')).status.state !== 'succeeded') { assert.ok(Date.now() < end); await new Promise(resolve => setTimeout(resolve, 50)); }
    const saved = await post('/api/artworks', { action: 'save', name: 'with bound source' }); assert.equal(saved.source.included, true);
    await post('/api/build/control', { action: 'auto', enabled: false, bindingVersion: (await read('/api/build')).version });
    await writeFile(sourceFile, JSON.stringify({ css: 'body{color:blue}' }));
    await post('/api/commands', { command: { type: 'set', target: 'assistant', property: 'padding', value: '13px' } });
    await post('/api/artworks', { action: 'restore', id: saved.id });
    assert.equal((await read('/api/build')).paused, true);
    assert.equal((await read('/api/project')).project.baseTheme.custom_css, 'body{color:red}');
    assert.match(await readFile(sourceFile, 'utf8'), /blue/);
    assert.match(await readFile(path.join(saved.directory, 'source/source.json'), 'utf8'), /red/);
  } finally { await app?.close(); await cleanup(root); }
});
