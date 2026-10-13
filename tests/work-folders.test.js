import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from '../server.js';
import { migrateWork } from '../src/work-migration.js';
import { resolveDataDirectory } from '../src/work-location.js';
import { buildThemeSource } from '../src/theme-builder.js';
import { projectFingerprint } from '../src/storage-migrations.js';
import { createProject } from '../shared/core.js';
import { createWorkLibrary } from '../src/work-library.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tts-work-'));
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'theme.css'), 'body{background:url("__TEST_ART__");color:red}');
  await writeFile(path.join(source, 'theme-fields.json'), JSON.stringify({ name: 'Fixture' }));
  await writeFile(path.join(source, 'assets.manifest.json'), JSON.stringify({ version: 1, assets: [{ placeholder: '__TEST_ART__', file: 'test.gif' }] }));
  await writeFile(path.join(source, 'test.gif'), Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00'));
  return { root, source, dataDir: path.join(root, 'data'), destination: path.join(root, 'my-work'), pointer: path.join(root, 'pointer.json') };
}
async function cleanup(root) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('tts-work-'));
  await rm(root, { recursive: true, force: true });
}
function client(getApp) {
  const read = async route => { const response = await fetch(getApp().address + route); const data = await response.json(); assert.equal(response.status, 200, data.error); return data; };
  const post = async body => {
    const s = await read('/api/session');
    const response = await fetch(getApp().address + (body.route || '/api/artworks'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': s.token }, body: JSON.stringify({ sessionId: s.sessionId, projectId: s.projectId, fingerprint: s.fingerprint, revision: s.revision, ...body }) });
    return { status: response.status, data: await response.json() };
  };
  const ok = async body => { const result = await post(body); assert.equal(result.status, 200, result.data.error); return result.data; };
  return { read, post, ok };
}

test('copy migration retains edits, assets, snapshots and versions; restarting follows the work and finalization stays immutable', async () => {
  const f = await fixture(); let app;
  const opened = [];
  try {
    app = await createServer({ dataDir: f.dataDir, artworkHome: path.join(f.root, 'archives'), port: 0 });
    const { read, post, ok } = client(() => app);
    await ok({ route: '/api/build/configure', bindingVersion: 0, autoSync: true, config: { root: f.source, program: '$STUDIO_THEME', args: [], watch: ['theme.css', 'theme-fields.json', 'assets.manifest.json', 'test.gif'], debounceMs: 50 } });
    const end = Date.now() + 15000;
    while ((await read('/api/build')).status.state !== 'succeeded') { assert.ok(Date.now() < end); await new Promise(r => setTimeout(r, 50)); }
    await ok({ route: '/api/commands', command: { type: 'set', target: 'assistant', property: 'padding', value: '29px' } });
    const saved = await ok({ action: 'save', name: 'before migration' });
    const before = await read('/api/project'), snapshots = await read('/api/snapshots');
    await assert.rejects(migrateWork(f), /占用|锁/);
    await assert.rejects(access(f.pointer));
    await app.close(); app = null;
    const oldProject = await readFile(path.join(f.dataDir, 'project.json'));
    const oldBinding = await readFile(path.join(f.dataDir, 'source-bindings.json'));
    const migrated = await migrateWork(f);
    assert.deepEqual(migrated.versions, [saved.id]);
    assert.equal(migrated.fingerprint, before.fingerprint);
    assert.deepEqual(await readFile(path.join(f.dataDir, 'project.json')), oldProject);
    assert.deepEqual(await readFile(path.join(f.dataDir, 'source-bindings.json')), oldBinding);
    assert.equal(await resolveDataDirectory('.local', { pointer: f.pointer, directory: '' }), migrated.dataDir);
    await assert.rejects(migrateWork(f), /已存在/);
    app = await createServer({ dataDir: migrated.dataDir, port: 0, folderOpener: async dir => opened.push(dir) });
    assert.deepEqual((await read('/api/project')).project, before.project);
    assert.deepEqual(await read('/api/snapshots'), snapshots);
    assert.equal((await read('/api/build')).paused, true);
    const info = await read('/api/artworks'); assert.equal(info.managed, true); assert.equal(info.changedSinceLatest, false);
    await ok({ action: 'open', target: 'work' }); await ok({ action: 'open', target: 'source' }); await ok({ action: 'open', target: 'version', id: saved.id });
    assert.equal(opened.length, 3); assert.equal(opened[0], info.root);
    assert.equal((await post({ action: 'open', target: 'arbitrary', root: f.root })).status, 400);
    assert.equal((await post({ action: 'open', target: 'version', id: '../outside' })).status, 400);
    assert.match((await read(`/api/artworks/theme?id=${saved.id}`)).custom_css, /padding: 29px/);
    await ok({ route: '/api/commands', command: { type: 'set', target: 'assistant', property: 'padding', value: '31px' } });
    assert.equal((await read('/api/artworks')).changedSinceLatest, true);
    const next = await ok({ action: 'save', name: 'second final' });
    assert.equal((await read('/api/artworks')).changedSinceLatest, false);
    assert.match((await read(`/api/artworks/theme?id=${saved.id}`)).custom_css, /padding: 29px/);
    assert.match((await read(`/api/artworks/theme?id=${next.id}`)).custom_css, /padding: 31px/);
    assert.equal((await post({ action: 'configure', root: path.join(f.root, 'unrelated') })).status, 400);
    assert.equal((await post({ route: '/api/commands', command: { type: 'import-project', project: createProject({ name: 'other' }) } })).status, 400);
    assert.equal((await read('/api/project')).project.rules.base.assistant.padding, '31px');
    await writeFile(path.join(f.destination, 'source/theme.css'), 'body{color:blue}');
    assert.equal((await read('/api/artworks')).changedSinceLatest, true);
    assert.equal((await post({ action: 'save', name: 'unsynced source' })).status, 409);
    // Restart uses the exact editable project, not a freshly built baseline.
    const expected = projectFingerprint((await read('/api/project')).project);
    await app.close(); app = await createServer({ dataDir: migrated.dataDir, port: 0 });
    assert.equal((await read('/api/project')).fingerprint, expected);
  } finally { await app?.close(); await cleanup(f.root); }
});

test('new themes get independent works; switching and restart retain edits, snapshots, sources and archives', async () => {
  const f = await fixture(); let app;
  try {
    app = await createServer({ dataDir: f.dataDir, artworkHome: path.join(f.root, 'archives'), port: 0 });
    const { read, post, ok } = client(() => app);
    const command = value => ok({ route: '/api/commands', command: value });
    await ok({ route: '/api/build/configure', bindingVersion: 0, autoSync: true, config: { root: f.source, program: '$STUDIO_THEME', args: [], watch: ['theme.css', 'theme-fields.json', 'assets.manifest.json', 'test.gif'], debounceMs: 50 } });
    const end = Date.now() + 15000;
    while ((await read('/api/build')).status.state !== 'succeeded') { assert.ok(Date.now() < end); await new Promise(r => setTimeout(r, 50)); }
    await command({ type: 'set', target: 'assistant', property: 'padding', value: '29px' });
    const saved = await ok({ action: 'save', name: 'original work' });
    const before = await read('/api/project');
    await app.close(); app = null;
    const migrated = await migrateWork(f);
    const options = { dataDir: migrated.dataDir, port: 0, workHome: f.root, pointer: f.pointer };
    app = await createServer(options);
    const originalBytes = await readFile(path.join(migrated.dataDir, 'project.json'));
    const originalVersions = (await read('/api/artworks')).versions;
    assert.equal(originalVersions.length, 1);
    const imported = [];
    for (let index = 0; index < 2; index++) {
      const type = 'work-create-theme';
      const theme = { name: '接入宿主主题', custom_css: 'body{color:blue;background:url("data:image/gif;base64,R0lGODlhAQABAAAAAA==")}' };
      const stale = await post({ route: '/api/commands', command: { type, theme, scanFingerprint: 'stale' } });
      assert.equal(stale.status, 409);
      assert.equal((await read('/api/project')).fingerprint, before.fingerprint);
      const staleSession = await read('/api/session');
      const switched = await command({ type, theme, scanFingerprint: before.fingerprint });
      assert.notEqual(switched.projectId, before.projectId);
      assert.notEqual(switched.sessionId, staleSession.sessionId);
      assert.notEqual(switched.dataDir, migrated.dataDir);
      assert.notEqual(switched.projectId, imported[0]?.projectId);
      assert.equal(switched.project.name, theme.name);
      assert.deepEqual(switched.project.rules, { base: {}, mobile: {} });
      assert.match(switched.project.baseTheme.custom_css, /tts-asset:\/\/[a-f0-9]{64}\.gif/);
      assert.deepEqual(JSON.parse(await readFile(path.join(migrated.dataDir, 'snapshots', switched.snapshotCreated.id + '.json'))).project, before.project);
      assert.deepEqual(await readFile(path.join(migrated.dataDir, 'project.json')), originalBytes);
      assert.equal((await read('/api/build')).bound, false);
      assert.deepEqual((await read('/api/artworks')).versions, []);
      assert.deepEqual(await read('/api/snapshots'), []);
      const staleResponse = await fetch(app.address + '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': staleSession.token }, body: JSON.stringify({ ...staleSession, command: { type: 'rename', name: 'must not apply' } }) });
      assert.equal(staleResponse.status, 403);
      const edited = await command({ type: 'set', target: 'assistant', property: 'padding', value: `${33 + index}px` });
      const finalized = await ok({ action: 'save', name: '新作品第一版' });
      imported.push(edited);
      assert.equal(await resolveDataDirectory('.local', { pointer: f.pointer, directory: '' }), switched.dataDir);
      await app.close(); app = await createServer({ ...options, dataDir: switched.dataDir });
      assert.equal((await read('/api/project')).fingerprint, edited.fingerprint);
      assert.equal((await read('/api/artworks')).versions[0].id, finalized.id);
      assert.equal((await command({ type: 'work-switch', projectId: before.projectId })).fingerprint, before.fingerprint);
      assert.equal((await read('/api/build')).paused, true);
      assert.deepEqual((await read('/api/artworks')).versions, originalVersions);
      assert.match((await read(`/api/artworks/theme?id=${saved.id}`)).custom_css, /padding: 29px/);
      assert.deepEqual((await read('/api/snapshots/' + switched.snapshotCreated.id)).project, before.project);
    }
    assert.equal((await read('/api/works')).works.length, 3);
    for (const work of imported) assert.equal((await command({ type: 'work-switch', projectId: work.projectId })).fingerprint, work.fingerprint);
    await command({ type: 'work-switch', projectId: before.projectId });
    const snapshots = await read('/api/snapshots'), build = await read('/api/build');
    for (const type of ['import-project', 'restore-files', 'import-theme']) {
      const rejected = await post({ route: '/api/commands', command: { type, project: createProject({ name: '另一作品' }), theme: { name: '另一作品' } } });
      assert.equal(rejected.status, 400);
      assert.match(rejected.data.error, /不能用其他工程覆盖/);
      assert.equal((await read('/api/project')).fingerprint, before.fingerprint);
      assert.deepEqual(await read('/api/snapshots'), snapshots);
      assert.deepEqual(await read('/api/build'), build);
    }
  } finally { await app?.close(); await cleanup(f.root); }
});

test('failed switch preparation preserves the active work and pointer', async () => {
  const f = await fixture(); let app, occupied;
  try {
    app = await createServer({ dataDir: f.dataDir, port: 0, artworkHome: path.join(f.root, 'archives'), workHome: f.root, pointer: f.pointer });
    const { read, post } = client(() => app);
    const before = await read('/api/project');
    await writeFile(path.join(f.dataDir, 'snapshots'), 'block recovery snapshot');
    const rejected = await post({ route: '/api/commands', command: { type: 'work-create-theme', theme: { name: 'blocked' }, scanFingerprint: before.fingerprint } });
    assert.equal(rejected.status, 400);
    assert.equal((await read('/api/project')).fingerprint, before.fingerprint);
    assert.deepEqual((await read('/api/works')).works, []);
    await assert.rejects(access(f.pointer));
    assert.equal((await post({ route: '/api/commands', command: { type: 'work-switch', projectId: '../outside' } })).status, 400);
    await rm(path.join(f.dataDir, 'snapshots'));
    const target = await createWorkLibrary({ home: f.root, pointer: f.pointer }).create({ name: '已在其他服务打开' });
    occupied = await createServer({ dataDir: target.dataDir, port: 0 });
    const blocked = await post({ route: '/api/commands', command: { type: 'work-switch', projectId: target.projectId } });
    assert.equal(blocked.status, 400); assert.match(blocked.data.error, /占用/);
    assert.equal((await read('/api/project')).fingerprint, before.fingerprint);
    await assert.rejects(access(f.pointer));
    assert.equal((await post({ route: '/api/commands', command: { type: 'set', target: 'assistant', property: 'padding', value: '20px' } })).status, 200);
  } finally { await occupied?.close(); await app?.close(); await cleanup(f.root); }
});

test('corrupt archives abort migration before switching the launch location', async () => {
  const f = await fixture(); let app;
  try {
    app = await createServer({ dataDir: f.dataDir, artworkHome: path.join(f.root, 'archives'), port: 0 });
    const { ok } = client(() => app); const saved = await ok({ action: 'save', name: 'corrupted' });
    await app.close(); app = null;
    await writeFile(path.join(saved.directory, 'theme.css'), 'corrupted');
    await assert.rejects(migrateWork(f), /校验失败/);
    await assert.rejects(access(f.pointer)); await assert.rejects(access(f.destination));
    await access(path.join(f.dataDir, 'project.json'));
  } finally { await app?.close(); await cleanup(f.root); }
});

test('missing work pointers fail closed; built-in themes reject escaping paths and unresolved placeholders', async () => {
  const f = await fixture();
  try {
    await writeFile(f.pointer, JSON.stringify({ version: 1, root: f.destination, projectId: 'missing' }));
    await assert.rejects(resolveDataDirectory('.local', { pointer: f.pointer, directory: '' }));
    await assert.rejects(access(f.destination));
    const output = path.join(f.root, 'candidate');
    await buildThemeSource(f.source, output);
    const theme = JSON.parse(await readFile(path.join(output, 'theme.json')));
    assert.match(theme.custom_css, /tts-asset:\/\/[a-f0-9]{64}\.gif/);
    await writeFile(path.join(f.source, 'assets.manifest.json'), JSON.stringify({ version: 1, assets: [{ placeholder: '__TEST_ART__', file: '../outside.gif' }] }));
    await assert.rejects(buildThemeSource(f.source, output), /路径无效/);
    await writeFile(path.join(f.source, 'assets.manifest.json'), JSON.stringify({ version: 1, assets: [] }));
    await assert.rejects(buildThemeSource(f.source, output), /未解析/);
  } finally { await cleanup(f.root); }
});
