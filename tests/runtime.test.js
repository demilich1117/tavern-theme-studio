import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.js';
import { listRuntimes, registerRuntime, stopRuntime, stopRuntimes } from '../src/runtime-service.js';
import { manageLauncher, readLauncher } from '../src/launcher-service.js';
import { exists } from '../src/install-service.js';
import { findLegacyRuntimes } from '../src/legacy-runtime.js';

async function temp(fn) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tts-runtime-')));
  try { await fn(root); } finally {
    assert.equal(path.dirname(root).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(root).startsWith('tts-runtime-')); await rm(root, { recursive: true, force: true });
  }
}
const options = (root, name) => ({ dataDir: path.join(root, name), runtimeHome: path.join(root, 'registry'), port: 0, pointer: null, workHome: path.join(root, 'works') });
const json = async (app, route) => (await fetch(app.address + route)).json();
const post = (app, session, route, input) => fetch(app.address + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': session.token }, body: JSON.stringify(input) });

test('all createServer launches are discoverable; authenticated stop preserves saves, releases locks and closes launcher', () => temp(async root => {
  const a = await createServer(options(root, 'a')), b = await createServer(options(root, 'b'));
  let manager;
  try {
    manager = await manageLauncher({ root, app: b, url: b.address, version: 'test' });
    const s = await json(a, '/api/session');
    assert.equal((await post(a, s, '/api/commands', { ...s, command: { type: 'rename', name: 'Saved before shutdown' } })).status, 200);
    const rows = await json(a, '/api/instances');
    assert.equal(rows.instances.length, 2); assert.ok(rows.currentId);
    assert.equal(rows.instances.find(r => r.id === rows.currentId).name, 'Saved before shutdown');
    assert.ok(rows.instances.every(r => !('token' in r) && r.dataDir && r.pid === process.pid));
    assert.equal((await fetch(a.address + '/__tts_runtime/stop', { method: 'POST' })).status, 403);
    assert.equal((await fetch(a.address + '/api/instances/stop', { method: 'POST', body: '{}' })).status, 403);
    const other = rows.instances.find(r => r.id !== rows.currentId);
    const single = await post(a, s, '/api/instances/stop', { ids: [other.id] });
    assert.equal(single.status, 200); assert.equal((await single.json()).results[0].status, 'stopped');
    assert.equal(await readLauncher(root), null); assert.equal(manager.record.pid, process.pid);
    assert.equal(await exists(path.join(root, 'b/.studio-lock')), false);
    const all = await post(a, s, '/api/instances/stop', { ids: [rows.currentId] });
    assert.equal((await all.json()).currentStopping, true);
    await a.close();
    assert.deepEqual(await listRuntimes({ home: path.join(root, 'registry') }), []);
    const reopened = await createServer(options(root, 'a'));
    try { assert.equal((await json(reopened, '/api/project')).project.name, 'Saved before shutdown'); } finally { await reopened.close(); }
  } finally { await a.close(); await b.close(); await manager?.close(); }
}));

test('registry control checks tokens, origins and instance identity; foreign services never receive stop', () => temp(async root => {
  const home = path.join(root, 'registry'), app = await createServer(options(root, 'data'));
  let stranger;
  try {
    const [file] = await readdir(home), record = JSON.parse(await readFile(path.join(home, file)));
    assert.equal((await fetch(app.address + '/__tts_runtime/stop', { method: 'POST', headers: { Origin: 'http://evil.invalid', 'X-Studio-Runtime': record.token } })).status, 403);
    let stopCalls = 0;
    stranger = http.createServer((req, res) => { if (req.method === 'POST') stopCalls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...record, id: randomUUID() })); });
    await new Promise(resolve => stranger.listen(0, '127.0.0.1', resolve));
    const forged = { ...record, id: randomUUID(), address: `http://127.0.0.1:${stranger.address().port}` };
    await writeFile(path.join(home, `${forged.id}.json`), JSON.stringify(forged));
    await assert.rejects(stopRuntime(forged.id, { home }), /身份已变化/);
    assert.equal((await listRuntimes({ home })).find(r => r.id === forged.id).status, 'unverified');
    assert.equal(stopCalls, 0); assert.equal((await fetch(app.address + '/api/health')).status, 200);
    const failed = await stopRuntimes({ home, ids: [forged.id] }); assert.equal(failed[0].status, 'failed');
    assert.equal(stopCalls, 0);
  } finally { await app.close(); if (stranger) await new Promise(resolve => stranger.close(resolve)); }
}));

test('shutdown drains an already accepted command behind a slow operation instead of rejecting its saved state', () => temp(async root => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const app = await createServer({ ...options(root, 'data'), artworkHome: path.join(root, 'archives'), folderOpener: async () => { entered(); await gate; } });
  try {
    const s = await json(app, '/api/session');
    assert.equal((await post(app, s, '/api/artworks', { ...s, action: 'save', name: 'Before' })).status, 200);
    const opening = post(app, s, '/api/artworks', { ...s, action: 'open', target: 'work' });
    await started;
    const accepted = new Promise(resolve => app.server.once('request', req => req.once('end', () => setImmediate(resolve))));
    const saving = post(app, s, '/api/commands', { ...s, command: { type: 'rename', name: 'Queued and saved' } });
    await accepted;
    let finished = false; const closing = app.close().then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
    release(); assert.equal((await opening).status, 200); assert.equal((await saving).status, 200); await closing;
    assert.equal(JSON.parse(await readFile(path.join(root, 'data/project.json'))).name, 'Queued and saved');
    assert.equal(await exists(path.join(root, 'data/.studio-lock')), false);
  } finally { release(); await app.close(); }
}));

test('runtime identity stays stable while its occupied work directory follows work switching', () => temp(async root => {
  const app = await createServer({ ...options(root, 'data'), pointer: path.join(root, 'pointer.json') });
  try {
    const before = await json(app, '/api/instances'), s = await json(app, '/api/session');
    const response = await post(app, s, '/api/commands', { ...s, command: { type: 'work-create-theme', theme: { name: 'New work', custom_css: '' }, scanFingerprint: s.fingerprint } });
    assert.equal(response.status, 200);
    const next = await response.json(), after = await json(app, '/api/instances');
    assert.equal(after.currentId, before.currentId); assert.equal(after.instances[0].dataDir, next.dataDir);
    assert.equal(after.instances[0].projectId, next.projectId); assert.equal(after.instances[0].name, 'New work');
    await stopRuntime(after.currentId, { home: path.join(root, 'registry') });
    assert.equal(await exists(path.join(next.dataDir, '.studio-lock')), false);
    assert.equal(await exists(path.join(root, 'data/.studio-lock')), false);
  } finally { await app.close(); }
}));

test('installation-scoped stop leaves another installation running and waits for cleanup acknowledgement', () => temp(async root => {
  const home = path.join(root, 'registry'), live = [];
  async function instance(name) {
    const dir = path.join(root, name); await mkdir(dir); let runtime;
    const server = http.createServer((req, res) => runtime.handle(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let closed; const close = () => closed ||= (async () => {
      await new Promise(resolve => setTimeout(resolve, 80));
      await new Promise(resolve => server.close(resolve)); await runtime.dispose();
    })();
    runtime = await registerRuntime({ home, root: dir, address: `http://127.0.0.1:${server.address().port}`, version: 'test', state: () => ({ name }), close });
    live.push(close); return { id: runtime.id, root: await realpath(dir) };
  }
  try {
    const a = await instance('one'), b = await instance('two');
    assert.deepEqual((await stopRuntimes({ home, root: a.root })).map(r => r.id), [a.id]);
    assert.deepEqual((await listRuntimes({ home })).map(r => r.id), [b.id]);
  } finally { await Promise.all(live.map(close => close())); }
}));

test('legacy live PID with an unreachable endpoint remains visible instead of being treated as stopped', () => temp(async root => {
  await mkdir(path.join(root, '.local'));
  await writeFile(path.join(root, '.local/runtime.json'), JSON.stringify({ address: 'http://127.0.0.1:1', pid: process.pid }));
  const rows = await findLegacyRuntimes(root);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'unverified'); assert.equal(rows[0].pid, process.pid);
}));
